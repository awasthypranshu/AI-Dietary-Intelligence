const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanText,
  normalizeFoodName,
  normalizeIngredientKey,
  jaccardSimilarity,
  backfillIngredientKeys,
} = require("../ai/normalization");

const { createRetrievalTools } = require("../ai/agents/retrievalTools");

// ---------------------------------------------------------------------------
// Normalization Unit Tests
// ---------------------------------------------------------------------------

test("Normalization: cleanText handles diacritics, whitespace, and punctuation", () => {
  assert.equal(cleanText("  Crème   Brûlée  "), "creme brulee");
  assert.equal(cleanText("Dhôkla"), "dhokla");
  assert.equal(cleanText("Khaman's"), "khamans");
});

test("Normalization: normalizeFoodName resolves aliases correctly", () => {
  assert.equal(normalizeFoodName("Chhole Bhature"), "chole bhature");
  assert.equal(normalizeFoodName("chana bhatura"), "chole bhature");
  assert.equal(normalizeFoodName("khaman"), "dhokla");
  assert.equal(normalizeFoodName("sooji dhokla"), "dhokla");
  assert.equal(normalizeFoodName("Biryani"), "biryani");
});

test("Normalization: normalizeIngredientKey resolves synonyms and singularizes correctly", () => {
  // Synonym mappings
  assert.equal(normalizeIngredientKey("Besan (gram flour)"), "besan");
  assert.equal(normalizeIngredientKey("Gram flour"), "besan");
  assert.equal(normalizeIngredientKey("Chickpea flour"), "besan");
  assert.equal(normalizeIngredientKey("All-purpose flour"), "maida");
  assert.equal(normalizeIngredientKey("Refined wheat flour"), "maida");
  assert.equal(normalizeIngredientKey("Semolina (rava/sooji)"), "rava");
  assert.equal(normalizeIngredientKey("Fresh coriander leaves"), "cilantro");
  assert.equal(normalizeIngredientKey("Curd"), "yogurt");

  // Singularization
  assert.equal(normalizeIngredientKey("Mustard seeds"), "mustard seed");
  assert.equal(normalizeIngredientKey("Curry leaves"), "curry leaf");
  assert.equal(normalizeIngredientKey("Tomatoes"), "tomato");
  assert.equal(normalizeIngredientKey("Green chillies"), "green chili");
  assert.equal(normalizeIngredientKey("Chickpeas"), "chickpea");

  // Distinct ingredients must NOT collide
  assert.notEqual(normalizeIngredientKey("Whole wheat flour"), normalizeIngredientKey("Maida"));
  assert.notEqual(normalizeIngredientKey("Mustard oil"), normalizeIngredientKey("Peanut oil"));
  assert.notEqual(normalizeIngredientKey("Olive oil"), normalizeIngredientKey("Butter"));
});

test("Normalization: jaccardSimilarity returns correct mathematical ratio", () => {
  // Identical sets -> 1.0
  const setA = new Set(["besan", "mustard seed", "chili"]);
  const setB = new Set(["besan", "mustard seed", "chili"]);
  assert.equal(jaccardSimilarity(setA, setB), 1.0);

  // Disjoint sets -> 0.0
  const setC = new Set(["rice", "sugar"]);
  assert.equal(jaccardSimilarity(setA, setC), 0.0);

  // Partial overlap: intersection = 2 (besan, chili), union = 4 (besan, mustard seed, chili, yogurt)
  // Jaccard = 2/4 = 0.5
  const setD = new Set(["besan", "chili", "yogurt"]);
  assert.equal(jaccardSimilarity(setA, setD), 0.5);

  // Empty sets -> 0
  assert.equal(jaccardSimilarity(new Set(), new Set()), 0);
});

test("Normalization: backfillIngredientKeys updates mismatched keys idempotently", async () => {
  const mockRows = [
    { id: "1", ingredient_name: "Gram flour", ingredient_key: "gram flour" },
    { id: "2", ingredient_name: "Besan", ingredient_key: "besan" },
  ];

  const updates = [];
  const mockDb = {
    async query(sql, params) {
      if (sql.startsWith("SELECT")) {
        return [mockRows];
      }
      if (sql.startsWith("UPDATE")) {
        updates.push(params);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };

  // Run dry run
  const dryStats = await backfillIngredientKeys(mockDb, { dryRun: true });
  assert.equal(dryStats.totalChecked, 2);
  assert.equal(dryStats.updatedCount, 1);
  assert.equal(updates.length, 0);

  // Run actual apply
  const applyStats = await backfillIngredientKeys(mockDb, { dryRun: false });
  assert.equal(applyStats.updatedCount, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], ["besan", "1"]);
});

// ---------------------------------------------------------------------------
// Retrieval Tools Unit Tests
// ---------------------------------------------------------------------------

function createMockPatientDb({ userId = "user_123", candidateRows = [], historyRows = [] } = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.trim();

      // Similar food image IDs query
      if (/SELECT\s+DISTINCT\s+fi\.food_image_id/i.test(s)) {
        const queryUserId = params[0];
        // Enforce user isolation: if query is for another user, return nothing
        if (queryUserId !== userId) {
          return [[]];
        }
        const ids = [...new Set(candidateRows.map((r) => ({ food_image_id: r.food_image_id })))];
        return [ids];
      }

      // Complete ingredient rows query
      if (/\bFROM\s+food_ingredients\s+fi\b/i.test(s) && /\bJOIN\s+food_images\b/i.test(s)) {
        const queryUserId = params[0];
        if (queryUserId !== userId) {
          return [[]];
        }
        return [candidateRows];
      }

      // History query
      if (/\bFROM\s+food_history\b/i.test(s)) {
        const queryUserId = params[0];
        if (queryUserId !== userId) {
          return [[]];
        }
        return [historyRows];
      }

      return [[]];
    },
  };
}

test("RetrievalTools: find_similar_by_ingredients computes Jaccard similarity and enforces user isolation", async () => {
  const currentFood = {
    foodName: "Khaman Dhokla",
    ingredients: {
      visible: [{ name: "Besan" }, { name: "Mustard seeds" }],
      suspected: [{ name: "Curry leaves" }],
      traditional: [{ name: "Green chili" }],
    },
  };

  const candidateRows = [
    // Image 1: Pakora (shares besan and green chili)
    { food_image_id: "img_pakora_1", food_name: "Vegetable Pakora", ingredient_name: "Besan", ingredient_key: "besan" },
    { food_image_id: "img_pakora_1", food_name: "Vegetable Pakora", ingredient_name: "Green chili", ingredient_key: "green chili" },
    { food_image_id: "img_pakora_1", food_name: "Vegetable Pakora", ingredient_name: "Onion", ingredient_key: "onion" },
    { food_image_id: "img_pakora_1", food_name: "Vegetable Pakora", ingredient_name: "Oil", ingredient_key: "oil" },
    // Image 2: Poha (shares mustard seeds and curry leaves)
    { food_image_id: "img_poha_1", food_name: "Poha", ingredient_name: "Mustard seeds", ingredient_key: "mustard seed" },
    { food_image_id: "img_poha_1", food_name: "Poha", ingredient_name: "Curry leaves", ingredient_key: "curry leaf" },
    { food_image_id: "img_poha_1", food_name: "Poha", ingredient_name: "Poha (flattened rice)", ingredient_key: "poha" },
  ];

  const historyRows = [
    {
      id: "h1",
      food_name: "Vegetable Pakora",
      status: "mild_indigestion",
      source: "manual",
      context: "",
      feedback_data: JSON.stringify({ reaction: "mild bloating from fried food" }),
      created_at: new Date(),
    },
  ];

  const db = createMockPatientDb({ userId: "patient_alice", candidateRows, historyRows });

  const tools = createRetrievalTools({
    db,
    userId: "patient_alice",
    patient: { name: "Alice", allergies: [] },
    personalization: {},
    learning: {},
    foodAnalysis: currentFood,
    currentFoodImageId: "img_current_dhokla",
  });

  const res = await tools.find_similar_by_ingredients();
  assert.equal(res.similarFoods.length, 2);

  // Top candidate has highest Jaccard or shared count
  const pakora = res.similarFoods.find((f) => f.foodName === "Vegetable Pakora");
  assert.ok(pakora);
  assert.equal(pakora.foodImageId, "img_pakora_1");
  assert.ok(pakora.similarityScore > 0);
  assert.equal(pakora.pastReactions.length, 1);
  assert.equal(pakora.pastReactions[0].reaction, "mild bloating from fried food");

  // User isolation test: requesting for a different user must return empty results
  const otherUserTools = createRetrievalTools({
    db,
    userId: "patient_bob", // Bob querying Alice's database
    patient: { name: "Bob", allergies: [] },
    personalization: {},
    learning: {},
    foodAnalysis: currentFood,
  });

  const bobRes = await otherUserTools.find_similar_by_ingredients();
  assert.equal(bobRes.similarFoods.length, 0);
});

test("RetrievalTools: search_food_history separates exact matches from partial matches", async () => {
  const historyRows = [
    {
      id: "h1",
      food_name: "Dhokla",
      status: "enjoyed",
      feedback_data: JSON.stringify({ reaction: "Felt great, light snack." }),
      created_at: new Date(),
    },
    {
      id: "h2",
      food_name: "Khaman Dhokla with Sev",
      status: "caution",
      feedback_data: JSON.stringify({ reaction: "Too much sodium from sev." }),
      created_at: new Date(),
    },
  ];

  const db = createMockPatientDb({ userId: "u1", historyRows });

  const tools = createRetrievalTools({
    db,
    userId: "u1",
    patient: { name: "Charlie" },
    personalization: {},
    learning: {},
    foodAnalysis: { foodName: "Dhokla", ingredients: { visible: [], suspected: [], traditional: [] } },
  });

  const res = await tools.search_food_history({ query: "Dhokla" });
  assert.equal(res.exactMatchCount, 1);
  assert.equal(res.exactMatches[0].foodName, "Dhokla");
  assert.equal(res.relatedMatchCount, 1);
  assert.equal(res.relatedMatches[0].foodName, "Khaman Dhokla with Sev");
});

test("RetrievalTools: get_food_genome_summary filters unrelated recent experiences", () => {
  const learning = {
    preferences: [{ foodName: "Dhokla", preference: "likes" }],
    learnedPatterns: [{ foodName: "Dhokla", pattern: "good breakfast energy" }],
    recentExperiences: [
      { foodName: "Dhokla", outcome: "positive" },
      { foodName: "Pizza", outcome: "spiked glucose" }, // Unrelated food!
      { foodName: "Burger", outcome: "fatigue" },        // Unrelated food!
    ],
  };

  const tools = createRetrievalTools({
    db: null,
    userId: "u1",
    patient: {},
    personalization: { foodGenome: { totalFeedback: 15 } },
    learning,
    foodAnalysis: { foodName: "Dhokla", ingredients: { visible: [], suspected: [], traditional: [] } },
  });

  const genome = tools.get_food_genome_summary();
  assert.equal(genome.thisFoodPreferences.length, 1);
  assert.equal(genome.thisFoodLearnedPatterns.length, 1);
  // Unrelated Pizza and Burger experiences must be excluded from this food's relevant experiences
  assert.equal(genome.relevantRecentExperiences.length, 1);
  assert.equal(genome.relevantRecentExperiences[0].foodName, "Dhokla");
});

test("RetrievalTools: handles empty ingredients and zero results safely", async () => {
  const tools = createRetrievalTools({
    db: null,
    userId: "u1",
    patient: { name: "Test" },
    personalization: {},
    learning: {},
    foodAnalysis: { foodName: "Mystery Food", ingredients: { visible: [], suspected: [], traditional: [] } },
  });

  const similar = await tools.find_similar_by_ingredients();
  assert.deepEqual(similar.similarFoods, []);

  const history = await tools.search_food_history();
  assert.deepEqual(history.exactMatches, []);
});
