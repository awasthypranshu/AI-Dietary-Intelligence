// AGENT 2 - Food Variant Agent
// Finds the real-world variants of the uploaded food (for example pizza:
// thin crust, whole-wheat base, thick base, Chicago deep-dish ...), with
// the ingredient differences and a rough nutrition direction for each.

const { generateValidatedJson } = require("../geminiJson");
const { cleanString, cleanConfidence, cleanNumber } = require("../foodAnalysisValidator");

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

async function runVariantAgent({ gemini, foodAnalysis }) {
  const prompt = `
You are the Food Variant Agent in a dietary-intelligence system.

The user uploaded: "${foodAnalysis.foodName}"
Identified style: "${foodAnalysis.foodStyle || "unknown"}"
Cuisine: "${foodAnalysis.cuisine || "unknown"}"
Visible ingredients: ${foodAnalysis.ingredients.visible.map((i) => i.name).join(", ") || "none"}

List ALL realistic variants of this SAME food, covering:
- crust / base / bread / dough differences (for pizza: thin crust,
  whole-wheat base, thick base, ...)
- regional or national styles (for pizza: Neapolitan, New York,
  Chicago deep-dish, ...)
- common healthier or restricted-diet versions (whole grain, gluten-free,
  low-fat, vegan, baked instead of fried, ...)
- common preparation differences (fried vs baked, cream vs tomato base).
Only include variants of the same food. Do not drift into different dishes.
Mark exactly one variant (the closest match to what was uploaded) with
matches_uploaded_food = true.
For each variant describe how it differs from the uploaded food:
"lower", "similar", "higher" or "unknown" for calories, carbohydrates,
fat, sodium and fiber. approx_calories_per_serving may be null.
Give 5 to 10 variants.

Return one JSON object:
{
  "variants": [
    {
      "name": "string",
      "region_or_style": "string",
      "description": "string",
      "matches_uploaded_food": false,
      "ingredient_changes": {"added": ["string"], "removed": ["string"], "substituted": ["string"]},
      "nutrition_vs_uploaded": {"calories": "lower|similar|higher|unknown", "carbohydrates": "...", "fat": "...", "sodium": "...", "fiber": "..."},
      "approx_calories_per_serving": null,
      "confidence": 0
    }
  ]
}
All nutrition information is approximate.
`;

  return generateValidatedJson({
    gemini,
    contents: [{ text: prompt }],
    validate: validateVariants,
    temperature: 0.3,
  });
}

module.exports = { runVariantAgent, validateVariants };