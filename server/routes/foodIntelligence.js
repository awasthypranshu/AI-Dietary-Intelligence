// Routes for the Gemini-powered food intelligence flow:
//   POST /recognize-food          image -> Gemini analysis -> saved in MySQL
//   GET  /food-images/:id         read one saved analysis (owner only)
//   POST /food-agents/analyze     run the 3 agents on a saved analysis
//
// This replaces the old Hugging Face + USDA flow.

const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const { analyzeFoodImage } = require("../ai/foodRecognition");
const { getModelName } = require("../ai/geminiJson");
const { validateFoodAnalysis } = require("../ai/foodAnalysisValidator");
const { runFoodAgents } = require("../ai/agents/orchestrator");
const { parseJsonValue } = require("../ai/jsonUtils");
const { normalizeIngredientKey } = require("../ai/normalization");

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

function newId() {
  return crypto.randomBytes(24).toString("hex");
}

function removeFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

// Rebuild the validated analysis object from a saved food_images row.
function rowToAnalysis(row) {
  const stored = parseJsonValue(row.analysis_json, null);
  if (stored) {
    return stored;
  }
  // Legacy rows (created before the Gemini upgrade) only have a name.
  return validateFoodAnalysis({
    is_food: true,
    food_name: row.food_name || "Unknown food",
    food_confidence:
      row.recognition_score !== null && row.recognition_score !== undefined
        ? Number(row.recognition_score) * 100
        : null,
  });
}

function registerFoodIntelligenceRoutes({
  app,
  db,
  requireAuth,
  storage,
  gemini,
  getAuthenticatedPatient,
  getPersonalizationData,
  buildFoodGenomeLearning,
  getGeminiErrorMessage,
}) {
  const foodUpload = multer({
    storage,
    limits: { fileSize: MAX_IMAGE_BYTES },
    fileFilter(req, file, cb) {
      if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        const error = new Error("Only JPG, PNG or WEBP food images are allowed.");
        error.code = "BAD_FILE_TYPE";
        cb(error);
      }
    },
  });

  function handleFoodUpload(req, res, next) {
    foodUpload.single("foodImage")(req, res, (error) => {
      if (!error) return next();

      const tooBig = error.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        message: tooBig
          ? "The image is too large. Please upload an image under 8 MB."
          : error.message || "Could not read the uploaded image.",
      });
    });
  }

  // ------------------------------------------------------------------
  // POST /recognize-food
  // ------------------------------------------------------------------
  app.post("/recognize-food", requireAuth, handleFoodUpload, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No food image uploaded." });
    }

    try {
      const analysis = await analyzeFoodImage({
        gemini,
        filePath: req.file.path,
        mimeType: req.file.mimetype,
      });

      const userId = req.authUserId;
      const foodImageId = newId();
      const now = new Date();
      const modelName = getModelName();

      await db.query(
        `INSERT INTO food_images (
           id, user_id, original_name, file_name, file_path, mime_type,
           uploaded_at, food_name, recognition_score, cuisine, food_style,
           food_confidence, style_confidence, visible_ingredients,
           suspected_ingredients, traditional_ingredients,
           estimated_serving, nutrition_estimate, limitations,
           analysis_json, analysis_model, analyzed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          foodImageId,
          userId,
          req.file.originalname,
          req.file.filename,
          req.file.path,
          req.file.mimetype,
          now,
          analysis.foodName,
          analysis.confidence.food === null ? null : analysis.confidence.food / 100,
          analysis.cuisine || null,
          analysis.foodStyle || null,
          analysis.confidence.food,
          analysis.confidence.style,
          JSON.stringify(analysis.ingredients.visible),
          JSON.stringify(analysis.ingredients.suspected),
          JSON.stringify(analysis.ingredients.traditional),
          JSON.stringify(analysis.estimatedServing),
          JSON.stringify(analysis.nutritionEstimate),
          JSON.stringify(analysis.limitations),
          JSON.stringify(analysis),
          modelName,
          now,
        ]
      );

      const ingredientRows = [
        ...analysis.ingredients.visible,
        ...analysis.ingredients.suspected,
        ...analysis.ingredients.traditional,
      ].map((item) => [
        newId(),
        foodImageId,
        userId,
        item.name,
        normalizeIngredientKey(item.name) || item.name.trim().toLowerCase(),
        item.category,
        item.confidence,
        item.role || null,
      ]);

      if (ingredientRows.length > 0) {
        await db.query(
          `INSERT INTO food_ingredients
             (id, food_image_id, user_id, ingredient_name, ingredient_key,
              category, confidence, role)
           VALUES ?`,
          [ingredientRows]
        );
      }

      return res.json({
        foodImageId,
        foodName: analysis.foodName,
        // 0-1 value kept so older screens that read "score" still work.
        score:
          analysis.confidence.food === null ? null : analysis.confidence.food / 100,
        analysis,
        model: modelName,
        disclaimer:
          "Serving size and nutrition values are AI estimates from a photo, not exact measurements.",
      });
    } catch (error) {
      removeFile(req.file.path);
      console.error("Food recognition error:", error);

      if (error.code === "NOT_FOOD") {
        return res.status(422).json({ message: error.message });
      }

      const quotaMessage = getGeminiErrorMessage(error);
      if (quotaMessage) {
        return res.status(429).json({ message: quotaMessage });
      }

      if (error.code === "AI_INVALID_OUTPUT" || error.code === "AI_BAD_JSON") {
        return res.status(502).json({
          message:
            "The AI returned an unreadable result. Please try again with a clearer photo.",
        });
      }

      return res.status(500).json({ message: "Food recognition failed." });
    }
  });

  // ------------------------------------------------------------------
  // GET /food-images/:id  (owner only)
  // ------------------------------------------------------------------
  app.get("/food-images/:id", requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT * FROM food_images WHERE id = ? AND user_id = ? LIMIT 1",
        [req.params.id, req.authUserId]
      );

      if (!rows[0]) {
        return res.status(404).json({ message: "Food analysis not found." });
      }

      return res.json({
        foodImageId: rows[0].id,
        analysis: rowToAnalysis(rows[0]),
      });
    } catch (error) {
      console.error("Food image read error:", error);
      return res.status(500).json({ message: "Could not read the food analysis." });
    }
  });

  // ------------------------------------------------------------------
  // POST /food-agents/analyze   body: { foodImageId }
  // ------------------------------------------------------------------
  app.post("/food-agents/analyze", requireAuth, async (req, res) => {
    try {
      const foodImageId = String(req.body?.foodImageId || "").trim();

      if (!foodImageId) {
        return res.status(400).json({ message: "foodImageId is required." });
      }

      const userId = req.authUserId;

      const [rows] = await db.query(
        "SELECT * FROM food_images WHERE id = ? AND user_id = ? LIMIT 1",
        [foodImageId, userId]
      );

      if (!rows[0]) {
        return res.status(404).json({ message: "Food analysis not found." });
      }

      const patient = await getAuthenticatedPatient(userId);

      if (!patient) {
        return res.status(404).json({
          message: "Health profile not found. Please complete your profile first.",
        });
      }

      const personalization = await getPersonalizationData(userId);
      const learning = buildFoodGenomeLearning(personalization.foodGenome);
      const foodAnalysis = rowToAnalysis(rows[0]);

      const result = await runFoodAgents({
        gemini,
        db,
        userId,
        patient,
        personalization,
        learning,
        foodAnalysis,
      });

      if (!result.verdict && !result.personalContext && !result.variants) {
        const first = Object.values(result.agentErrors).join(" ");
        const quotaMessage = getGeminiErrorMessage({ message: first });
        return res.status(quotaMessage ? 429 : 502).json({
          message: quotaMessage || "The AI agents could not complete the analysis.",
        });
      }

      const reportId = newId();

      await db.query(
        `INSERT INTO food_agent_reports
           (id, user_id, food_image_id, verdict, verdict_json,
            personal_context_json, variants_json, knowledge_json, agent_errors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          userId,
          foodImageId,
          result.verdict?.overallVerdict || null,
          JSON.stringify(result.verdict),
          JSON.stringify(result.personalContext),
          JSON.stringify(result.variants),
          JSON.stringify(result.knowledge),
          JSON.stringify(result.agentErrors),
        ]
      );

      return res.json({
        reportId,
        foodImageId,
        verdict: result.verdict,
        personalContext: result.personalContext,
        variants: result.variants,
        knowledge: result.knowledge,
        agentErrors: result.agentErrors,
      });
    } catch (error) {
      console.error("Food agents error:", error);
      const quotaMessage = getGeminiErrorMessage(error);
      return res.status(quotaMessage ? 429 : 500).json({
        message: quotaMessage || "Could not run the food agents.",
      });
    }
  });
}

module.exports = { registerFoodIntelligenceRoutes };