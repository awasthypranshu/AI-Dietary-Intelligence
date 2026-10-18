// AGENT 2 - Food Variant Agent
// Finds the real-world variants of the uploaded food.
//
// Workflow:
// 1. First retrieves documented variants and ingredients with provenance from
//    the shared knowledge catalog (retrieveVariantsFromCatalog).
// 2. If documented variants exist:
//    - Retains all verified recipe facts and ingredient-level provenance.
//    - Prompts Gemini ONLY to compare differences (added/removed/substituted and nutrition direction).
//    - Strictly prohibits model hallucination of ingredients.
// 3. If catalog is empty or has no match:
//    - Falls back to pure AI generation.
//    - Explicitly labels results as model-generated suggestions (isUnverifiedSuggestion: true,
//      dataSource: "ai_generated", sources: []).

const { generateValidatedJson } = require("../geminiJson");
const { cleanString, cleanConfidence, cleanNumber } = require("../foodAnalysisValidator");
const { retrieveVariantsFromCatalog } = require("../foodKnowledge/variantRetriever");
const { normalizeIngredientKey } = require("../normalization");

function strList(value, max = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 120)).filter(Boolean).slice(0, max);
}

const DIRECTIONS = ["lower", "similar", "higher", "unknown"];

function direction(value) {
  const text = String(value || "").toLowerCase();
  return DIRECTIONS.includes(text) ? text : "unknown";
}

function validateVariants(raw) {
  const source = Array.isArray(raw) ? raw : raw?.variants;

  if (!Array.isArray(source) || source.length === 0) {
    const error = new Error("Variant list is missing or empty.");
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }

  const seen = new Set();
  const variants = [];

  for (const item of source) {
    const name = cleanString(item?.name, 150);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    variants.push({
      name,
      regionOrStyle: cleanString(item?.region_or_style, 150),
      description: cleanString(item?.description, 400),
      matchesUploadedFood: item?.matches_uploaded_food === true,
      ingredientChanges: {
        added: strList(item?.ingredient_changes?.added),
        removed: strList(item?.ingredient_changes?.removed),
        substituted: strList(item?.ingredient_changes?.substituted),
      },
      nutritionVsUploaded: {
        calories: direction(item?.nutrition_vs_uploaded?.calories),
        carbohydrates: direction(item?.nutrition_vs_uploaded?.carbohydrates),
        fat: direction(item?.nutrition_vs_uploaded?.fat),
        sodium: direction(item?.nutrition_vs_uploaded?.sodium),
        fiber: direction(item?.nutrition_vs_uploaded?.fiber),
        approxCalories: cleanNumber(item?.approx_calories_per_serving),
      },
      confidence: cleanConfidence(item?.confidence),
    });
  }

  if (variants.length === 0) {
    const error = new Error("No valid variants found.");
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }

  return variants.slice(0, 12);
}

/**
 * Transforms catalog variants into the structured format expected by the pipeline.
 */
function catalogVariantsToStructured(catalogVariants, foodAnalysis) {
  const uploadedName = String(foodAnalysis.foodName || "").toLowerCase().trim();

  return catalogVariants.map((v) => {
    const vName = String(v.variantName || "").toLowerCase().trim();
    const nameMatch =
      vName === uploadedName ||
      (vName.includes(uploadedName) && uploadedName.length >= 4);

    const docIngs = (v.documentedIngredients || v.ingredients || []).map((ing) => ({
      name: ing.name,
      key: ing.key || normalizeIngredientKey(ing.name),
      role: ing.role || "ingredient",
      presenceType: ing.presenceType || ing.classification || "typical",
      classification: ing.presenceType || ing.classification || "typical",
      source: ing.source || null,
      sourceUrl: ing.sourceUrl || null,
      notes: ing.notes || null,
      confidence: ing.confidence ?? null,
    }));

    return {
      variantId: v.id || null,
      canonicalName: v.canonicalName || foodAnalysis.foodName,
      name: v.variantName,
      regionOrStyle: v.regionOrStyle || "",
      preparationMethod: v.preparationMethod || null,
      description: v.description || "",
      matchesUploadedFood: Boolean(nameMatch),
      documentedIngredients: docIngs,
      ingredientChanges: { added: [], removed: [], substituted: [] },
      nutritionVsUploaded: {
        calories: "unknown",
        carbohydrates: "unknown",
        fat: "unknown",
        sodium: "unknown",
        fiber: "unknown",
        approxCalories: null,
      },
      confidence: v.confidence || 85,
      dataSource: v.dataSource || "knowledge_base",
      isVerified: Boolean(v.isVerified),
      isFixture: Boolean(v.isFixture),
      isUnverifiedSuggestion: false,
      sources: Array.isArray(v.sources) ? v.sources : [],
      uncertainties: [
        "Recipe is from documented culinary sources; exact restaurant or home preparation may vary.",
      ],
    };
  });
}

/**
 * Use Gemini to analyze differences (ingredient delta and nutrition direction)
 * between catalog variants and the uploaded food photo.
 * The model must NOT hallucinate new ingredients.
 */
async function analyzeKnowledgeVariants({ gemini, foodAnalysis, kbVariants }) {
  const variantSummaries = kbVariants.map((v) => ({
    name: v.name,
    regionOrStyle: v.regionOrStyle,
    documentedIngredients: v.documentedIngredients.map((i) => ({
      name: i.name,
      presenceType: i.presenceType,
    })),
  }));

  const prompt = `
You are the Food Variant Analysis Agent. You have been given DOCUMENTED variants
of "${foodAnalysis.foodName}" from a verified knowledge base. You must ONLY analyze these
variants — do NOT add new variants, do NOT add new ingredients that are not in
the documented lists.

UPLOADED FOOD:
  Name: "${foodAnalysis.foodName}"
  Style: "${foodAnalysis.foodStyle || "unknown"}"
  Visible ingredients: ${foodAnalysis.ingredients.visible.map((i) => i.name).join(", ") || "none"}

DOCUMENTED VARIANTS (from knowledge base):
${JSON.stringify(variantSummaries, null, 2)}

For each variant, describe how its nutrition DIRECTION compares to the uploaded
food: "lower", "similar", "higher", or "unknown" for calories, carbohydrates,
fat, sodium, and fiber. Also list ingredient_changes (added/removed/substituted)
relative to the uploaded food.

RULES:
- Do NOT add any new variants not in the list above.
- Do NOT add any new ingredients not documented above.
- Use "unknown" when you cannot determine a direction.
- Mark the variant closest to the uploaded food with matches_uploaded_food=true.

Return JSON:
{
  "variants": [
    {
      "name": "string (must match a documented variant name exactly)",
      "matches_uploaded_food": false,
      "ingredient_changes": {"added": [], "removed": [], "substituted": []},
      "nutrition_vs_uploaded": {"calories": "...", "carbohydrates": "...", "fat": "...", "sodium": "...", "fiber": "..."},
      "approx_calories_per_serving": null,
      "confidence": 0
    }
  ]
}
`;

  try {
    const aiVariants = await generateValidatedJson({
      gemini,
      contents: [{ text: prompt }],
      validate: validateVariants,
      temperature: 0.2,
    });

    const aiByName = new Map(
      aiVariants.map((v) => [v.name.toLowerCase().trim(), v])
    );

    return kbVariants.map((kbv) => {
      const ai = aiByName.get(kbv.name.toLowerCase().trim());
      if (!ai) return kbv;

      return {
        ...kbv,
        matchesUploadedFood: ai.matchesUploadedFood || kbv.matchesUploadedFood,
        ingredientChanges: ai.ingredientChanges,
        nutritionVsUploaded: ai.nutritionVsUploaded,
        confidence: ai.confidence || kbv.confidence,
      };
    });
  } catch (_error) {
    // If AI analysis fails, preserve documented variants with default direction
    return kbVariants;
  }
}

/**
 * Main entry point for Variant Agent.
 */
async function runVariantAgent({ gemini, foodAnalysis, db }) {
  // 1. Check knowledge catalog first
  let catalogResult = null;

  if (db) {
    try {
      catalogResult = await retrieveVariantsFromCatalog(db, foodAnalysis.foodName, {
        foodStyle: foodAnalysis.foodStyle,
        cuisine: foodAnalysis.cuisine,
      });
    } catch (_error) {
      catalogResult = null;
    }
  }

  // 2. If catalog has documented variants, use them
  if (catalogResult && catalogResult.status === "found" && catalogResult.variants.length > 0) {
    const structuredVariants = catalogVariantsToStructured(
      catalogResult.variants,
      foodAnalysis
    );

    const enrichedVariants = await analyzeKnowledgeVariants({
      gemini,
      foodAnalysis,
      kbVariants: structuredVariants,
    });

    return {
      variants: enrichedVariants,
      retrievalStatus: catalogResult.status,
      retrievalSources: catalogResult.sources || [],
      dataSource: "knowledge_base",
      canonicalFood: catalogResult.canonicalFood,
    };
  }

  // 3. Fall back to AI generation, clearly labeled as unverified suggestions
  const prompt = `
You are the Food Variant Agent in a dietary-intelligence system.

The user uploaded: "${foodAnalysis.foodName}"
Identified style: "${foodAnalysis.foodStyle || "unknown"}"
Cuisine: "${foodAnalysis.cuisine || "unknown"}"
Visible ingredients: ${foodAnalysis.ingredients.visible.map((i) => i.name).join(", ") || "none"}

List ALL realistic variants of this SAME food, covering:
- base / bread / dough differences
- regional or national styles
- common healthier or restricted-diet versions (whole grain, gluten-free, vegan, baked instead of fried)
- common preparation differences (fried vs baked, cream vs tomato base).
Only include variants of the same food. Do not drift into different dishes.
Mark exactly one variant (the closest match to what was uploaded) with matches_uploaded_food = true.
For each variant describe how it differs from the uploaded food:
"lower", "similar", "higher" or "unknown" for calories, carbohydrates, fat, sodium and fiber.
Give 3 to 6 variants.

Return JSON:
{
  "variants": [
    {
      "name": "string",
      "region_or_style": "string",
      "description": "string",
      "matches_uploaded_food": false,
      "ingredient_changes": {"added": ["string"], "removed": ["string"], "substituted": ["string"]},
      "nutrition_vs_uploaded": {"calories": "...", "carbohydrates": "...", "fat": "...", "sodium": "...", "fiber": "..."},
      "approx_calories_per_serving": null,
      "confidence": 0
    }
  ]
}
`;

  const aiVariants = await generateValidatedJson({
    gemini,
    contents: [{ text: prompt }],
    validate: validateVariants,
    temperature: 0.3,
  });

  return {
    variants: aiVariants.map((v) => ({
      ...v,
      dataSource: "ai_generated",
      isVerified: false,
      isUnverifiedSuggestion: true,
      documentedIngredients: [],
      sources: [],
      uncertainties: [
        "AI-generated suggestion; not backed by a verified recipe source.",
      ],
    })),
    retrievalStatus: catalogResult ? catalogResult.status : "not_available",
    retrievalSources: [],
    dataSource: "ai_generated",
    canonicalFood: foodAnalysis.foodName,
  };
}

module.exports = {
  runVariantAgent,
  validateVariants,
  catalogVariantsToStructured,
  knowledgeVariantsToStructured: catalogVariantsToStructured,
};