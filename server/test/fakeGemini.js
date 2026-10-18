// A fake Gemini client for tests. No network, no API key.
// It answers based on what the code asks for, like the real model would.

const FOOD_JSON = {
  is_food: true,
  food_name: "Chole Bhature",
  cuisine: "Indian",
  food_style: "Punjabi",
  food_confidence: 92,
  style_confidence: 78,
  visible_ingredients: [
    { name: "Chickpeas", confidence: 95, role: "curry base" },
    { name: "Bhature (maida dough)", confidence: 90, role: "fried bread" },
  ],
  suspected_ingredients: [
    { name: "Oil", confidence: 85, role: "deep frying" },
    { name: "Peanut oil", confidence: 30, role: "possible frying oil" },
  ],
  traditional_ingredients: [
    { name: "Maida", confidence: 90, role: "bhatura dough" },
    { name: "Onion", confidence: 70, role: "gravy" },
  ],
  estimated_serving: { description: "1 plate (2 bhature + curry)", grams: 350, confidence: 40 },
  nutrition_estimate: {
    calories: 720, protein_g: 18, carbohydrates_g: 90, fat_g: 32,
    saturated_fat_g: 6, fiber_g: 12, sugar_g: 8, sodium_mg: 1100,
    cholesterol_mg: 0, other_nutrients: [{ name: "Iron", amount: 5, unit: "mg" }],
    confidence: 35,
  },
  limitations: ["Portion size is a guess from one photo."],
  notes: "",
};

const CONTEXT_JSON = {
  evidence_summary: "Patient has type 2 diabetes; no past reactions recorded.",
  relevant_conditions: [{ condition: "Type 2 diabetes", why_relevant: "High refined-carb meal" }],
  allergy_conflicts: [],
  medication_or_report_notes: [],
  past_reactions_to_this_food: [],
  similar_food_evidence: [],
  ingredients_of_concern: [{ ingredient: "Maida", reason: "Refined flour", source: "general" }],
  missing_information: ["No HbA1c on file"],
  evidence_confidence: 60,
};

const VARIANTS_JSON = {
  variants: [
    {
      name: "Chole Bhature (classic Punjabi)", region_or_style: "Punjab",
      description: "Deep-fried maida bread with spiced chickpeas.",
      matches_uploaded_food: true,
      ingredient_changes: { added: [], removed: [], substituted: [] },
      nutrition_vs_uploaded: { calories: "similar", carbohydrates: "similar", fat: "similar", sodium: "similar", fiber: "similar" },
      approx_calories_per_serving: 720, confidence: 70,
    },
    {
      name: "Whole-wheat Chole Kulche", region_or_style: "Healthier version",
      description: "Baked whole-wheat kulcha instead of fried bhatura.",
      matches_uploaded_food: false,
      ingredient_changes: { added: ["whole wheat flour"], removed: ["maida"], substituted: ["baked instead of fried"] },
      nutrition_vs_uploaded: { calories: "lower", carbohydrates: "lower", fat: "lower", sodium: "similar", fiber: "higher" },
      approx_calories_per_serving: 480, confidence: 60,
    },
  ],
};

const VERDICT_JSON = {
  overall_verdict: "good",
  headline: "Fine in small amounts.",
  confidence: 60,
  reasons: [{ point: "Chickpeas give fiber and protein.", severity: "low", evidence_source: "ingredients" }],
  ingredients_of_concern: [],
  recommended_portion: "Half plate",
  variant_verdicts: [
    { variant_name: "Whole-wheat Chole Kulche", verdict: "good", reason: "More fiber." },
  ],
  safer_alternatives: ["Chole with brown rice"],
  missing_information: [],
};

function reply(object) {
  return { text: JSON.stringify(object), functionCalls: undefined };
}

function createFakeGemini(overrides = {}) {
  const calls = [];

  return {
    calls,
    models: {
      async generateContent(request) {
        calls.push(request);
        const contents = request.contents;
        const flat = JSON.stringify(contents);

        if (overrides.throwError) throw overrides.throwError;

        // Image recognition call
        if (Array.isArray(contents) && contents.some((c) => c.inlineData)) {
          if (overrides.foodText !== undefined) return { text: overrides.foodText };
          return reply(overrides.food || FOOD_JSON);
        }

        // Agent 1 tool loop (function calling enabled)
        if (request.config?.tools) {
          const answered = flat.includes('"functionResponse"');
          if (!answered) {
            return {
              text: "",
              functionCalls: [
                { name: "get_patient_profile", args: {} },
                { name: "get_medical_report", args: {} },
                { name: "search_food_history", args: { query: "chole bhature" } },
                { name: "find_similar_by_ingredients", args: {} },
              ],
            };
          }
          return { text: "Findings: diabetes, refined flour.", functionCalls: undefined };
        }

        if (flat.includes("Using ONLY the tool results")) {
          return reply(overrides.context || CONTEXT_JSON);
        }
        if (flat.includes("Food Variant")) {
          if (overrides.variantsText !== undefined) return { text: overrides.variantsText };
          return reply(overrides.variants || VARIANTS_JSON);
        }
        if (flat.includes("Verdict Agent")) {
          return reply(overrides.verdict || VERDICT_JSON);
        }

        throw new Error("FakeGemini: unexpected request");
      },
    },
  };
}

module.exports = {
  createFakeGemini,
  FOOD_JSON,
  CONTEXT_JSON,
  VARIANTS_JSON,
  VERDICT_JSON,
};