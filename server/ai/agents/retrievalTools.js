// "Retrieval" layer for agentic RAG.
//
// All patient-specific retrieval is strictly scoped to `userId` taken from the
// authenticated session, ensuring complete patient data isolation.
//
// Key enhancements:
// - Uses `normalizeIngredientKey` for canonical matching.
// - Calculates Jaccard similarity (|A ∩ B| / |A ∪ B|) for similar-ingredient candidate ranking.
// - Groups historical candidates by `food_image_id` (real analysis identifier), NOT just food name.
// - Excludes the current food analysis from its own history.
// - Separates exact-food history from partial/similar food history.
// - Filters Food Genome experiences to relevant food/ingredient context.
// - Safe handling of empty ingredient sets and zero-result queries.

const { parseJsonValue } = require("../jsonUtils");
const {
  normalizeFoodName,
  normalizeIngredientKey,
  jaccardSimilarity,
} = require("../normalization");

function keyOf(text) {
  return normalizeFoodName(text);
}

function createRetrievalTools({
  db,
  userId,
  patient,
  personalization,
  learning,
  foodAnalysis,
  currentFoodImageId = null,
}) {
  const currentCanonicalName = normalizeFoodName(foodAnalysis.foodName);

  const currentIngredientList = [
    ...foodAnalysis.ingredients.visible,
    ...foodAnalysis.ingredients.suspected,
    ...foodAnalysis.ingredients.traditional,
  ];

  const currentIngredientKeys = [
    ...new Set(
      currentIngredientList
        .map((item) => normalizeIngredientKey(item.name))
        .filter(Boolean)
    ),
  ];

  const currentIngredientSet = new Set(currentIngredientKeys);

  async function loadHistoryRows(limit = 300) {
    if (!db) return [];
    try {
      const [rows] = await db.query(
        `SELECT id, food_name, status, source, context, feedback_data, created_at
           FROM food_history
          WHERE user_id = ?
            AND food_name IS NOT NULL
            AND food_name <> ''
          ORDER BY created_at DESC
          LIMIT ?`,
        [userId, limit]
      );

      return rows.map((row) => {
        const feedback = parseJsonValue(row.feedback_data, {}) || {};
        return {
          id: row.id,
          foodName: row.food_name,
          canonicalName: normalizeFoodName(row.food_name),
          status: row.status || feedback.status || "",
          reaction: feedback.reaction || "",
          notes: feedback.notes || "",
          source: row.source,
          recordedAt: row.created_at,
        };
      });
    } catch (_error) {
      return [];
    }
  }

  const tools = {
    get_patient_profile() {
      return {
        name: patient.name,
        age: patient.age,
        gender: patient.gender,
        height: patient.height,
        weight: patient.weight,
        bloodPressure: patient.bloodPressure,
        bloodSugar: patient.bloodSugar,
        diseases: patient.diseases || [],
        allergies: patient.allergies || [],
        foodPreferences: patient.foodPreferences || [],
      };
    },

    get_medical_report() {
      if (!patient.medicalReportData) {
        return { available: false };
      }
      return { available: true, data: patient.medicalReportData };
    },

    /**
     * Search patient's past food feedback.
     * Distinguishes exact food name matches from related/partial matches.
     */
    async search_food_history({ query } = {}) {
      const searchKey = query ? normalizeFoodName(query) : currentCanonicalName;
      const rows = await loadHistoryRows();

      const exactMatches = [];
      const partialMatches = [];

      for (const row of rows) {
        const rowKey = row.canonicalName;
        if (rowKey === searchKey) {
          exactMatches.push({
            foodName: row.foodName,
            status: row.status,
            reaction: row.reaction,
            notes: row.notes,
            recordedAt: row.recordedAt,
          });
        } else if (
          searchKey &&
          (rowKey.includes(searchKey) || searchKey.includes(rowKey))
        ) {
          partialMatches.push({
            foodName: row.foodName,
            status: row.status,
            reaction: row.reaction,
            notes: row.notes,
            recordedAt: row.recordedAt,
          });
        }
      }

      return {
        query: searchKey,
        exactMatchCount: exactMatches.length,
        exactMatches: exactMatches.slice(0, 10),
        relatedMatchCount: partialMatches.length,
        relatedMatches: partialMatches.slice(0, 10),
        // For backwards compatibility
        matches: [...exactMatches, ...partialMatches].slice(0, 15),
      };
    },

    /**
     * Finds previous foods analyzed by this authenticated patient that share
     * ingredients with the current food.
     *
     * Evaluates Jaccard similarity and groups candidates by their real
     * `food_image_id` so distinct food analyses remain separate.
     */
    async find_similar_by_ingredients({ ingredients } = {}) {
      const asked = Array.isArray(ingredients)
        ? ingredients.map(normalizeIngredientKey).filter(Boolean)
        : [];

      const lookFor = asked.length ? asked : currentIngredientKeys;

      if (!db || lookFor.length === 0) {
        return { ingredientsChecked: lookFor, similarFoods: [] };
      }

      try {
        // Retrieve all ingredients for any food_image of this user that contains at least one target ingredient
        const [candidateImageRows] = await db.query(
          `SELECT DISTINCT fi.food_image_id
             FROM food_ingredients fi
            WHERE fi.user_id = ?
              AND fi.ingredient_key IN (?)
            LIMIT 100`,
          [userId, lookFor]
        );

        const candidateIds = candidateImageRows
          .map((r) => r.food_image_id)
          .filter((id) => id && id !== currentFoodImageId);

        if (candidateIds.length === 0) {
          return { ingredientsChecked: lookFor, similarFoods: [] };
        }

        // Fetch complete ingredient sets for these candidate food analyses
        const [allIngredientRows] = await db.query(
          `SELECT fi.food_image_id, fi.ingredient_name, fi.ingredient_key,
                  img.food_name, img.uploaded_at
             FROM food_ingredients fi
             JOIN food_images img ON img.id = fi.food_image_id
            WHERE fi.user_id = ?
              AND fi.food_image_id IN (?)
            ORDER BY fi.food_image_id, fi.created_at ASC`,
          [userId, candidateIds]
        );

        const history = await loadHistoryRows();

        // Group by food_image_id (real distinct food-analysis identifier)
        const analysisMap = new Map();
        for (const row of allIngredientRows) {
          const fid = row.food_image_id;
          if (!analysisMap.has(fid)) {
            analysisMap.set(fid, {
              foodImageId: fid,
              foodName: row.food_name || "Unknown food",
              canonicalName: normalizeFoodName(row.food_name),
              uploadedAt: row.uploaded_at,
              allIngredients: new Set(),
              ingredientNames: [],
            });
          }
          const item = analysisMap.get(fid);
          const ikey = row.ingredient_key || normalizeIngredientKey(row.ingredient_name);
          if (ikey) {
            item.allIngredients.add(ikey);
            item.ingredientNames.push(row.ingredient_name);
          }
        }

        // Score each candidate analysis using Jaccard similarity and shared ingredient count
        const querySet = new Set(lookFor);
        const candidates = [];

        for (const [fid, entry] of analysisMap.entries()) {
          // Exclude exact matches to current food if it's the same food name
          if (entry.canonicalName === currentCanonicalName && fid === currentFoodImageId) {
            continue;
          }

          const shared = [];
          for (const ing of entry.allIngredients) {
            if (querySet.has(ing)) {
              shared.push(ing);
            }
          }

          if (shared.length === 0) continue;

          const jaccard = jaccardSimilarity(querySet, entry.allIngredients);
          const jaccardPercent = Math.round(jaccard * 100);

          // Find past reaction/feedback matching this food's name
          const pastReactions = history
            .filter((h) => h.canonicalName === entry.canonicalName)
            .map((h) => ({
              status: h.status,
              reaction: h.reaction,
              notes: h.notes,
              recordedAt: h.recordedAt,
            }))
            .slice(0, 3);

          candidates.push({
            foodImageId: fid,
            foodName: entry.foodName,
            sharedIngredients: shared,
            sharedIngredientCount: shared.length,
            totalIngredients: entry.allIngredients.size,
            similarityScore: jaccardPercent,
            pastReactions,
            selectionReason: `Shares ${shared.length} ingredient${shared.length > 1 ? "s" : ""} (${shared.slice(0, 4).join(", ")}); Jaccard similarity: ${jaccardPercent}%`,
          });
        }

        // Sort by Jaccard similarity descending, then shared ingredient count descending
        candidates.sort((a, b) => {
          if (b.similarityScore !== a.similarityScore) {
            return b.similarityScore - a.similarityScore;
          }
          return b.sharedIngredientCount - a.sharedIngredientCount;
        });

        return {
          ingredientsChecked: lookFor,
          similarFoods: candidates.slice(0, 8),
        };
      } catch (_error) {
        return { ingredientsChecked: lookFor, similarFoods: [] };
      }
    },

    /**
     * Retrieves Food Genome summary.
     * Prevents unrelated recent experiences from polluting evidence for this food.
     */
    get_food_genome_summary() {
      const preferences = (learning.preferences || []).filter(
        (item) => normalizeFoodName(item.foodName) === currentCanonicalName
      );
      const patterns = (learning.learnedPatterns || []).filter(
        (item) => normalizeFoodName(item.foodName) === currentCanonicalName
      );

      // Only include recent experiences that share relevance to the current food
      const relevantExperiences = (learning.recentExperiences || [])
        .filter((item) => {
          const itemKey = normalizeFoodName(item.foodName);
          return itemKey === currentCanonicalName;
        })
        .slice(0, 5);

      return {
        thisFoodPreferences: preferences,
        thisFoodLearnedPatterns: patterns,
        relevantRecentExperiences: relevantExperiences,
        // Kept for backward compatibility
        recentExperiences: relevantExperiences,
        totalFeedback: personalization.foodGenome?.totalFeedback ?? 0,
      };
    },

    get_digital_twin_summary() {
      const twin = personalization.digitalTwin || {};
      return {
        healthProfile: twin.healthProfile || {},
        dietaryFeedback: twin.dietaryFeedback || {},
        feedbackCount: twin.feedbackCount ?? 0,
      };
    },
  };

  return tools;
}

// Declarations the model sees (function calling).
const TOOL_DECLARATIONS = [
  {
    name: "get_patient_profile",
    description:
      "Get the patient's age, body measurements, diseases, allergies and food preferences.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_medical_report",
    description:
      "Get data extracted from the patient's uploaded medical report / prescription (conditions, lab values, medications, dietary restrictions).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_food_history",
    description:
      "Search this patient's past food feedback (reactions, notes) for a food name. Leave query empty to search for the food being analyzed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Food name to search for.",
        },
      },
    },
  },
  {
    name: "find_similar_by_ingredients",
    description:
      "Find other foods the patient has eaten before that share ingredients with this food, ranked by Jaccard similarity and shared ingredient counts, with past reactions.",
    parameters: {
      type: "object",
      properties: {
        ingredients: {
          type: "array",
          items: { type: "string" },
          description:
            "Ingredient names to match. Leave empty to use the current food's ingredients.",
        },
      },
    },
  },
  {
    name: "get_food_genome_summary",
    description:
      "Get the patient's Food Genome learning: preferences and learned reaction patterns relevant to this food.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_digital_twin_summary",
    description:
      "Get the patient's Digital Twin health profile and dietary feedback summary.",
    parameters: { type: "object", properties: {} },
  },
];

module.exports = { createRetrievalTools, TOOL_DECLARATIONS };