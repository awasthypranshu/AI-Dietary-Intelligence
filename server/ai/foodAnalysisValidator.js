// Validates and normalizes the JSON Gemini returns for a food image.
// Anything missing or malformed is either fixed safely or rejected,
// so the rest of the app never has to trust raw model output.

const NUTRIENT_KEYS = [
  "calories",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
  "saturated_fat_g",
  "fiber_g",
  "sugar_g",
  "sodium_mg",
  "cholesterol_mg",
];

function fail(message) {
  const error = new Error(message);
  error.code = "AI_INVALID_OUTPUT";
  throw error;
}

function cleanString(value, max = 200) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().slice(0, max);
}

function cleanConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.round(number * 10) / 10;
}

function cleanIngredientList(list, category) {
  if (!Array.isArray(list)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of list) {
    const isString = typeof item === "string";
    const name = cleanString(isString ? item : item?.name, 120);

    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      name,
      category,
      confidence: isString ? null : cleanConfidence(item?.confidence),
      role: isString ? "" : cleanString(item?.role, 120),
    });
  }

  return result.slice(0, 40);
}

function cleanStringList(list, max = 20) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item) => cleanString(item, 300))
    .filter(Boolean)
    .slice(0, max);
}

function validateFoodAnalysis(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("Food analysis must be a JSON object.");
  }

  const isFood = raw.is_food !== false;
  const foodName = cleanString(raw.food_name);

  if (isFood && !foodName) {
    fail("Food analysis is missing food_name.");
  }

  const serving = raw.estimated_serving || {};
  const nutrition = raw.nutrition_estimate || {};

  const nutritionValues = {};
  for (const key of NUTRIENT_KEYS) {
    nutritionValues[key] = cleanNumber(nutrition[key]);
  }

  const otherNutrients = Array.isArray(nutrition.other_nutrients)
    ? nutrition.other_nutrients
        .map((entry) => ({
          name: cleanString(entry?.name, 60),
          amount: cleanNumber(entry?.amount),
          unit: cleanString(entry?.unit, 12),
        }))
        .filter((entry) => entry.name && entry.amount !== null)
        .slice(0, 12)
    : [];

  const limitations = cleanStringList(raw.limitations);

  // Honesty guard: estimates must always carry at least one limitation.
  if (limitations.length === 0) {
    limitations.push(
      "Serving size and nutrition values are estimates made from a single photo and may be inaccurate.",
      "Hidden ingredients (oil, sugar, salt, sauces) cannot be confirmed from an image."
    );
  }

  return {
    isFood,
    foodName: isFood ? foodName : "",
    cuisine: cleanString(raw.cuisine, 80),
    foodStyle: cleanString(raw.food_style, 120),
    confidence: {
      food: cleanConfidence(raw.food_confidence),
      style: cleanConfidence(raw.style_confidence),
    },
    ingredients: {
      visible: cleanIngredientList(raw.visible_ingredients, "visible"),
      suspected: cleanIngredientList(raw.suspected_ingredients, "suspected"),
      traditional: cleanIngredientList(raw.traditional_ingredients, "traditional"),
    },
    estimatedServing: {
      description: cleanString(serving.description, 160),
      grams: cleanNumber(serving.grams),
      confidence: cleanConfidence(serving.confidence),
      isEstimate: true,
    },
    nutritionEstimate: {
      ...nutritionValues,
      otherNutrients,
      basis: "per estimated serving",
      isEstimate: true,
      confidence: cleanConfidence(nutrition.confidence),
    },
    limitations,
    notes: cleanString(raw.notes, 500),
  };
}

module.exports = {
  NUTRIENT_KEYS,
  validateFoodAnalysis,
  cleanString,
  cleanConfidence,
  cleanNumber,
};