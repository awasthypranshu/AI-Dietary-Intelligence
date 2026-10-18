// Gemini-based food image analysis. Replaces the old Hugging Face model
// and the USDA lookup: one call identifies the food, its style,
// ingredients, serving size and estimated nutrition.

const fs = require("fs");
const { generateValidatedJson } = require("./geminiJson");
const { validateFoodAnalysis } = require("./foodAnalysisValidator");

const FOOD_ANALYSIS_PROMPT = `
You are a careful food-image analyst for a dietary-intelligence app.
Look at the food in the image and return ONE JSON object only.

RULES
1. Identify the MOST SPECIFIC food and style you can
   (example: "Pizza" with style "Chicago-style deep-dish", or
   "Chole Bhature" with style "Punjabi"). If you cannot tell the
   style, say so and use a low style_confidence.
2. Keep three ingredient lists strictly separate:
   - visible_ingredients: clearly seen in the photo.
   - suspected_ingredients: not clearly seen but likely present
     (for example oil used for frying, flour in the dough).
   - traditional_ingredients: ingredients normally used in THIS exact
     food and style only. NEVER add ingredients that belong to an
     unrelated food or style (no Neapolitan toppings for a Chicago
     deep-dish, no pasta ingredients for a pizza).
3. Give a confidence (0-100) for the food, the style and every
   ingredient. Be honest: use lower numbers when unsure.
4. Estimate the serving size shown in the photo and the nutrition for
   that serving. These are ESTIMATES from a picture, never exact.
5. List limitations that could make the analysis wrong
   (hidden ingredients, unclear portion, mixed dishes, lighting, etc).
6. If the image does not contain food, set is_food to false and leave
   the other fields empty or null.
7. Use null for any number you cannot reasonably estimate.
   Do not invent precise-looking numbers.

Return JSON with exactly this shape:
{
  "is_food": true,
  "food_name": "string",
  "cuisine": "string",
  "food_style": "string",
  "food_confidence": 0,
  "style_confidence": 0,
  "visible_ingredients": [{"name": "string", "confidence": 0, "role": "string"}],
  "suspected_ingredients": [{"name": "string", "confidence": 0, "role": "string"}],
  "traditional_ingredients": [{"name": "string", "confidence": 0, "role": "string"}],
  "estimated_serving": {"description": "string", "grams": 0, "confidence": 0},
  "nutrition_estimate": {
    "calories": 0,
    "protein_g": 0,
    "carbohydrates_g": 0,
    "fat_g": 0,
    "saturated_fat_g": 0,
    "fiber_g": 0,
    "sugar_g": 0,
    "sodium_mg": 0,
    "cholesterol_mg": 0,
    "other_nutrients": [{"name": "string", "amount": 0, "unit": "string"}],
    "confidence": 0
  },
  "limitations": ["string"],
  "notes": "string"
}
`;

async function analyzeFoodImage({ gemini, filePath, mimeType }) {
  const imageBase64 = fs.readFileSync(filePath).toString("base64");

  const analysis = await generateValidatedJson({
    gemini,
    contents: [
      { inlineData: { mimeType, data: imageBase64 } },
      { text: FOOD_ANALYSIS_PROMPT },
    ],
    validate: validateFoodAnalysis,
    temperature: 0.2,
  });

  if (!analysis.isFood) {
    const error = new Error(
      "No food could be identified in this image."
    );
    error.code = "NOT_FOOD";
    throw error;
  }

  return analysis;
}

module.exports = {
  FOOD_ANALYSIS_PROMPT,
  analyzeFoodImage,
};