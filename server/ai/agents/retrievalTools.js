// "Retrieval" layer for the agentic RAG. These are plain, safe database
// readers. Every query is scoped to ONE user id taken from the logged-in
// session, so an agent can never read another user's data.

const { parseJsonValue } = require("../jsonUtils");

function keyOf(text) {
  return String(text || "").trim().toLowerCase();
}

function createRetrievalTools({
  db,
  userId,
  patient,
  personalization,
  learning,
  foodAnalysis,
}) {
  const currentKey = keyOf(foodAnalysis.foodName);

  const currentIngredientKeys = [
    ...foodAnalysis.ingredients.visible,
    ...foodAnalysis.ingredients.suspected,
    ...foodAnalysis.ingredients.traditional,
  ].map((item) => keyOf(item.name));

  async function loadHistoryRows(limit = 300) {
    const [rows] = await db.query(
      `SELECT food_name, status, source, context, feedback_data, created_at
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
        foodName: row.food_name,
        status: row.status || feedback.status || "",
        reaction: feedback.reaction || "",
        notes: feedback.notes || "",
        source: row.source,
        recordedAt: row.created_at,
      };
    });
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
        diseases: patient.diseases,
        allergies: patient.allergies,
        foodPreferences: patient.foodPreferences,
      };
    },

    get_medical_report() {
      // This is the "prescription" / report data the user uploaded.
      if (!patient.medicalReportData) {
        return { available: false };
      }
      return { available: true, data: patient.medicalReportData };
    },

    async search_food_history({ query } = {}) {
      const wanted = keyOf(query) || currentKey;
      const rows = await loadHistoryRows();

      const matches = rows.filter((row) => {
        const name = keyOf(row.foodName);
        return (
          name === wanted ||
          name.includes(wanted) ||
          wanted.includes(name)
        );
      });

      return {
        query: wanted,
        totalMatches: matches.length,
        matches: matches.slice(0, 15),
      };
    },

    async find_similar_by_ingredients({ ingredients } = {}) {
      const asked = Array.isArray(ingredients)
        ? ingredients.map(keyOf).filter(Boolean)
        : [];
      const lookFor = asked.length ? asked : currentIngredientKeys;

      if (lookFor.length === 0) {
        return { ingredientsChecked: [], similarFoods: [] };
      }

      // Past foods this user analyzed that share ingredients.
      const [ingredientRows] = await db.query(
        `SELECT fi.food_image_id, fi.ingredient_key, img.food_name
           FROM food_ingredients fi
           JOIN food_images img ON img.id = fi.food_image_id
          WHERE fi.user_id = ?
            AND fi.ingredient_key IN (?)
            AND img.food_name IS NOT NULL
          ORDER BY fi.created_at DESC
          LIMIT 300`,
        [userId, lookFor]
      );

      const history = await loadHistoryRows();
      const byFood = new Map();

      for (const row of ingredientRows) {
        const name = keyOf(row.food_name);
        if (name === currentKey) continue;
        if (!byFood.has(name)) {
          byFood.set(name, {
            foodName: row.food_name,
            sharedIngredients: new Set(),
          });
        }
        byFood.get(name).sharedIngredients.add(row.ingredient_key);
      }

      const similarFoods = [...byFood.entries()]
        .map(([name, entry]) => {
          const reactions = history
            .filter((h) => keyOf(h.foodName) === name)
            .slice(0, 5);
          return {
            foodName: entry.foodName,
            sharedIngredients: [...entry.sharedIngredients],
            pastReactions: reactions,
          };
        })
        .sort(
          (a, b) =>
            b.sharedIngredients.length - a.sharedIngredients.length
        )
        .slice(0, 8);

      return { ingredientsChecked: lookFor, similarFoods };
    },

    get_food_genome_summary() {
      const preferences = (learning.preferences || []).filter(
        (item) => keyOf(item.foodName) === currentKey
      );
      const patterns = (learning.learnedPatterns || []).filter(
        (item) => keyOf(item.foodName) === currentKey
      );

      return {
        thisFoodPreferences: preferences,
        thisFoodLearnedPatterns: patterns,
        recentExperiences: (learning.recentExperiences || []).slice(0, 8),
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
      "Find other foods the patient has eaten before that share ingredients with this food, together with the reactions they had.",
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
      "Get the patient's Food Genome learning: preferences and learned reaction patterns.",
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