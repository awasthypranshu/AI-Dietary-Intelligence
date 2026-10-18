const test = require("node:test");
const assert = require("node:assert/strict");

const { validateFoodAnalysis } = require("../ai/foodAnalysisValidator");
const { retrieveVariantsFromCatalog } = require("../ai/foodKnowledge/variantRetriever");
const { importFoodKnowledge, FIXTURES, VERIFIED_STARTER_DATA } = require("../ai/agents/seedFoodKnowledge");
const { runFoodAgents } = require("../ai/agents/orchestrator");
const { createRetrievalTools } = require("../ai/agents/retrievalTools");
const { createFakeGemini } = require("./fakeGemini");
const { normalizeFoodName, normalizeIngredientKey, jaccardSimilarity } = require("../ai/normalization");

// ---------------------------------------------------------------------------
// In-Memory Database for Whole Flow Test
// ---------------------------------------------------------------------------
function createFullFlowDb() {
  const tables = {
    food_sources: [],
    food_variants: [],
    food_variant_ingredients: [],
    food_knowledge: [],
    food_knowledge_aliases: [],
    food_images: [],
    food_ingredients: [],
    food_history: [],
    food_agent_reports: [],
  };

  return {
    tables,
    async query(sql, params = []) {
      const s = sql.trim();

      // COUNT(*) on food_variants
      if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+food_variants/i.test(s)) {
        return [[{ total: tables.food_variants.length }]];
      }

      // COUNT(*) on food_knowledge
      if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+food_knowledge/i.test(s)) {
        return [[{ total: tables.food_knowledge.length }]];
      }

      // Check existing food_variants
      if (/SELECT\s+id\s+FROM\s+food_variants\s+WHERE\s+canonical_name_key\s*=\s*\?\s+AND\s+variant_name_key\s*=\s*\?/i.test(s)) {
        const found = tables.food_variants.filter(
          (r) => r.canonical_name_key === params[0] && r.variant_name_key === params[1]
        );
        return [found];
      }

      // Exact or like lookup in food_variants
      if (/SELECT\s+canonical_name_key\s+FROM\s+food_variants\s+WHERE\s+canonical_name_key\s*=\s*\?/i.test(s)) {
        const found = tables.food_variants.filter((r) => r.canonical_name_key === params[0]);
        return [found];
      }

      // Insert food_variants
      if (/\bINSERT\s+INTO\s+food_variants\b/i.test(s)) {
        tables.food_variants.push({
          id: params[0],
          canonical_name: params[1],
          canonical_name_key: params[2],
          variant_name: params[3],
          variant_name_key: params[4],
          region_or_style: params[5],
          preparation_method: params[6],
          description: params[7],
          is_verified: params[8],
          is_active: 1,
          source_id: params[9],
        });
        return [{ affectedRows: 1 }];
      }

      // Select variants with sources
      if (/FROM\s+food_variants\s+v\s+LEFT\s+JOIN\s+food_sources\s+s/i.test(s)) {
        const key = params[0];
        const matched = tables.food_variants.filter((v) => v.canonical_name_key === key);
        const rows = matched.map((v) => {
          const src = tables.food_sources.find((s) => s.id === v.source_id);
          return {
            ...v,
            source_title: src?.title || null,
            source_publisher: src?.publisher || null,
            source_url: src?.url || null,
            source_type: src?.source_type || null,
            publication_date: src?.publication_date || null,
          };
        });
        return [rows];
      }

      // Check existing food_sources
      if (/SELECT\s+id\s+FROM\s+food_sources\s+WHERE/i.test(s)) {
        const found = tables.food_sources.filter(
          (r) => r.id === params[0] || (params[1] && r.url === params[1])
        );
        return [found];
      }

      // Insert food_sources
      if (/\bINSERT\s+INTO\s+food_sources\b/i.test(s)) {
        tables.food_sources.push({
          id: params[0],
          title: params[1],
          publisher: params[2],
          url: params[3],
          source_type: params[4],
          publication_date: params[5],
          is_verified: params[6],
          notes: params[7],
        });
        return [{ affectedRows: 1 }];
      }

      // Check existing food_variant_ingredients
      if (/SELECT\s+id\s+FROM\s+food_variant_ingredients\s+WHERE/i.test(s)) {
        const found = tables.food_variant_ingredients.filter(
          (r) => r.variant_id === params[0] && r.ingredient_key === params[1] && r.presence_type === params[2]
        );
        return [found];
      }

      // Insert food_variant_ingredients
      if (/\bINSERT\s+INTO\s+food_variant_ingredients\b/i.test(s)) {
        tables.food_variant_ingredients.push({
          id: params[0],
          variant_id: params[1],
          ingredient_name: params[2],
          ingredient_key: params[3],
          role: params[4],
          presence_type: params[5],
          source_id: params[6],
          notes: params[7],
          confidence: params[8],
        });
        return [{ affectedRows: 1 }];
      }

      // Select ingredients by variant_id IN (?)
      if (/FROM\s+food_variant_ingredients\s+vi\s+LEFT\s+JOIN\s+food_sources\s+s/i.test(s)) {
        const vIds = Array.isArray(params[0]) ? params[0] : [params[0]];
        const rows = tables.food_variant_ingredients
          .filter((vi) => vIds.includes(vi.variant_id))
          .map((vi) => {
            const src = tables.food_sources.find((s) => s.id === vi.source_id);
            return {
              ...vi,
              ingredient_source_title: src?.title || null,
              ingredient_source_url: src?.url || null,
            };
          });
        return [rows];
      }

      // Alias lookup
      if (/FROM\s+food_knowledge_aliases/i.test(s)) {
        const found = tables.food_knowledge_aliases.filter((a) => a.alias_key === params[0]);
        return [found];
      }

      // Insert alias
      if (/\bINSERT\s+INTO\s+food_knowledge_aliases\b/i.test(s)) {
        tables.food_knowledge_aliases.push({
          id: params[0],
          food_knowledge_id: params[1],
          alias_key: params[2],
          alias_name: params[3],
          canonical_name_key: normalizeFoodName(params[3]),
        });
        return [{ affectedRows: 1 }];
      }

      // Food history lookup
      if (/FROM\s+food_history\b/i.test(s)) {
        const uId = params[0];
        const rows = tables.food_history.filter((h) => h.user_id === uId);
        return [rows];
      }

      // Candidate image rows in find_similar_by_ingredients
      if (/FROM\s+food_ingredients\s+fi\s+WHERE\s+fi\.user_id\s*=\s*\?\s+AND\s+fi\.ingredient_key\s+IN/i.test(s)) {
        const uId = params[0];
        const keys = Array.isArray(params[1]) ? params[1] : [params[1]];
        const matched = tables.food_ingredients.filter(
          (fi) => fi.user_id === uId && keys.includes(fi.ingredient_key)
        );
        const unique = [...new Set(matched.map((m) => m.food_image_id))].map((id) => ({
          food_image_id: id,
        }));
        return [unique];
      }

      // All ingredient rows in find_similar_by_ingredients
      if (/FROM\s+food_ingredients\s+fi\s+JOIN\s+food_images\s+img/i.test(s)) {
        const uId = params[0];
        const ids = Array.isArray(params[1]) ? params[1] : [params[1]];
        const matched = tables.food_ingredients
          .filter((fi) => fi.user_id === uId && ids.includes(fi.food_image_id))
          .map((fi) => {
            const img = tables.food_images.find((i) => i.id === fi.food_image_id);
            return {
              food_image_id: fi.food_image_id,
              ingredient_name: fi.ingredient_name,
              ingredient_key: fi.ingredient_key,
              food_name: img?.food_name || "Unknown food",
              uploaded_at: img?.uploaded_at || new Date(),
            };
          });
        return [matched];
      }

      // Insert food_agent_reports
      if (/INSERT\s+INTO\s+food_agent_reports/i.test(s)) {
        tables.food_agent_reports.push({
          id: params[0],
          user_id: params[1],
          food_image_id: params[2],
          verdict: params[3],
          verdict_json: params[4],
          personal_context_json: params[5],
          variants_json: params[6],
          knowledge_json: params[7],
          agent_errors: params[8],
        });
        return [{ affectedRows: 1 }];
      }

      return [[]];
    },
  };
}

// ---------------------------------------------------------------------------
// Whole Flow End-to-End Tests
// ---------------------------------------------------------------------------

test("Whole Flow: Recognized Dhokla -> Knowledge Catalog -> Patient RAG -> Multi-Variant Safety Assessment", async () => {
  const db = createFullFlowDb();

  // 1. Seed verified starter culinary knowledge (Dhokla variants: Khaman and Rava)
  const seedResult = await importFoodKnowledge(db, VERIFIED_STARTER_DATA);
  assert.ok(seedResult.inserted > 0);
  assert.ok(db.tables.food_variants.length >= 2);
  assert.ok(db.tables.food_variant_ingredients.length >= 10);
  assert.ok(db.tables.food_sources.length >= 2);

  // 2. Validate Food Recognition pipeline for uploaded image
  const rawRecognitionOutput = {
    is_food: true,
    food_name: "Dhokla",
    cuisine: "Gujarati",
    food_style: "Steamed Snack",
    food_confidence: 94,
    style_confidence: 88,
    visible_ingredients: [
      { name: "Mustard seeds", confidence: 90, role: "tempering" },
      { name: "Curry leaves", confidence: 85, role: "tempering" },
    ],
    suspected_ingredients: [
      { name: "Besan (gram flour)", confidence: 85, role: "batter" },
      { name: "Eno fruit salt", confidence: 80, role: "leavening" },
    ],
    traditional_ingredients: [
      { name: "Citric acid", confidence: 75, role: "souring" },
      { name: "Sugar", confidence: 70, role: "seasoning" },
    ],
    estimated_serving: { description: "2 pieces", grams: 120, confidence: 50 },
    nutrition_estimate: {
      calories: 160,
      protein_g: 6,
      carbohydrates_g: 24,
      fat_g: 5,
      saturated_fat_g: 1,
      fiber_g: 3,
      sugar_g: 4,
      sodium_mg: 380,
      cholesterol_mg: 0,
      confidence: 45,
    },
    limitations: ["Oil and sugar in tempering cannot be precisely measured from photo."],
  };

  const foodAnalysis = validateFoodAnalysis(rawRecognitionOutput);
  assert.equal(foodAnalysis.foodName, "Dhokla");
  assert.equal(foodAnalysis.ingredients.visible.length, 2);
  assert.equal(foodAnalysis.nutritionEstimate.isEstimate, true);

  // 3. Verify Direct Knowledge Retrieval resolves canonical Dhokla and its variants
  const catalogRetrieval = await retrieveVariantsFromCatalog(db, "Dhokla");
  assert.equal(catalogRetrieval.status, "found");
  assert.equal(catalogRetrieval.canonicalFood, "Dhokla");
  assert.ok(catalogRetrieval.variants.length >= 2);

  const khaman = catalogRetrieval.variants.find((v) => v.variantName === "Khaman Dhokla");
  const rava = catalogRetrieval.variants.find((v) => v.variantName === "Rava Dhokla");
  assert.ok(khaman, "Khaman Dhokla should be in catalog");
  assert.ok(rava, "Rava Dhokla should be in catalog");

  // Check ingredient presence types in catalog
  const semolinaIng = rava.documentedIngredients.find((i) => i.name.toLowerCase().includes("semolina"));
  assert.ok(semolinaIng);
  assert.equal(semolinaIng.presenceType, "required");

  // 4. Setup Patient Profile with a specific Wheat/Gluten allergy and Type 2 Diabetes
  const userId = "patient_user_42";
  const patient = {
    name: "Ramesh Patel",
    age: 48,
    gender: "male",
    diseases: ["Type 2 Diabetes"],
    allergies: ["wheat", "gluten"],
    foodPreferences: ["Vegetarian"],
    medicalReportData: {
      conditions: ["Type 2 Diabetes Mellitus"],
      medications: ["Metformin 500mg"],
      dietaryRestrictions: ["Avoid refined grains, limit high glycemic index foods"],
    },
  };

  // 5. Populate Historical Meals with User Isolation Check
  // Patient 42 ate Dhokla before and had good tolerance
  db.tables.food_images.push({
    id: "img_hist_1",
    user_id: userId,
    food_name: "Dhokla",
    uploaded_at: new Date(Date.now() - 7 * 86400000),
  });
  db.tables.food_ingredients.push(
    { id: "fi_1", food_image_id: "img_hist_1", user_id: userId, ingredient_name: "Besan", ingredient_key: "gram flour" },
    { id: "fi_2", food_image_id: "img_hist_1", user_id: userId, ingredient_name: "Mustard seeds", ingredient_key: "mustard seed" }
  );
  db.tables.food_history.push({
    id: "hist_1",
    user_id: userId,
    food_name: "Dhokla",
    status: "enjoyed",
    source: "app",
    feedback_data: JSON.stringify({ reaction: "mild fullness", status: "good" }),
  });

  // Another user (User 99) had a severe reaction to Dhokla - MUST NOT BE LEAKED TO USER 42
  db.tables.food_history.push({
    id: "hist_leak",
    user_id: "patient_user_99_other",
    food_name: "Dhokla",
    status: "reaction",
    source: "app",
    feedback_data: JSON.stringify({ reaction: "severe allergic anaphylaxis", status: "avoid" }),
  });

  // Verify retrieval tool isolation
  const tools = createRetrievalTools({
    db,
    userId,
    patient,
    personalization: { foodGenome: {}, digitalTwin: {} },
    learning: {},
    foodAnalysis,
    currentFoodImageId: "current_img_123",
  });
  const historyResult = await tools.search_food_history({ query: "Dhokla" });
  assert.equal(historyResult.exactMatchCount, 1);
  assert.equal(historyResult.exactMatches[0].reaction, "mild fullness");
  assert.ok(!historyResult.exactMatches.some((m) => m.reaction.includes("anaphylaxis")), "Foreign user records must be excluded");

  // 6. Run Orchestrator with Fake Gemini
  const fakeGemini = createFakeGemini({
    food: rawRecognitionOutput,
    context: {
      evidence_summary: "Patient has Type 2 Diabetes and wheat allergy. Prior besan dhokla was well-tolerated.",
      relevant_conditions: [{ condition: "Type 2 Diabetes", why_relevant: "Watch portion" }],
      allergy_conflicts: [],
      medication_or_report_notes: ["Metformin on file"],
      past_reactions_to_this_food: [{ reaction: "mild fullness", note: "well tolerated" }],
      similar_food_evidence: [],
      ingredients_of_concern: [{ ingredient: "Sugar", reason: "Diabetes control", source: "profile" }],
      missing_information: [],
      evidence_confidence: 85,
    },
    variants: {
      variants: [
        {
          name: "Khaman Dhokla",
          region_or_style: "Gujarati",
          description: "Steamed savory besan cake.",
          matches_uploaded_food: true,
          ingredient_changes: { added: [], removed: [], substituted: [] },
          nutrition_vs_uploaded: { calories: "similar", carbohydrates: "similar", fat: "similar", sodium: "similar", fiber: "similar" },
          approx_calories_per_serving: 160,
          confidence: 90,
        },
        {
          name: "Rava Dhokla",
          region_or_style: "Gujarati instant",
          description: "Steamed cake made from semolina/sooji.",
          matches_uploaded_food: false,
          ingredient_changes: { added: ["semolina"], removed: ["besan"], substituted: ["semolina for besan"] },
          nutrition_vs_uploaded: { calories: "similar", carbohydrates: "similar", fat: "lower", sodium: "similar", fiber: "lower" },
          approx_calories_per_serving: 170,
          confidence: 85,
        },
      ],
    },
    verdict: {
      overall_verdict: "good",
      headline: "Steamed preparation is moderate in carbs and provides protein.",
      confidence: 85,
      reasons: [{ point: "Steamed with besan protein; no wheat detected.", severity: "low", evidence_source: "ingredients" }],
      ingredients_of_concern: [],
      recommended_portion: "2-3 pieces",
      variant_verdicts: [
        { variant_name: "Khaman Dhokla", verdict: "good", reason: "Besan base is safe from wheat." },
        { variant_name: "Rava Dhokla", verdict: "good", reason: "Model initially assumed safe." },
      ],
      safer_alternatives: [],
      missing_information: [],
    },
  });

  const agentResponse = await runFoodAgents({
    gemini: fakeGemini,
    db,
    userId,
    patient,
    personalization: { foodGenome: {}, digitalTwin: {} },
    learning: {},
    foodAnalysis,
  });

  // 7. Verify Whole Flow Output & Safety Assertions
  assert.ok(agentResponse);
  assert.ok(agentResponse.verdict);
  assert.ok(agentResponse.variants);
  assert.ok(agentResponse.personalContext);
  assert.ok(agentResponse.knowledge);

  // Original food verdict
  assert.equal(agentResponse.verdict.overallVerdict, "good");

  // Knowledge retrieval metadata
  assert.equal(agentResponse.knowledge.dataSource, "knowledge_base");
  assert.equal(agentResponse.knowledge.retrievalStatus, "found");
  assert.equal(agentResponse.knowledge.canonicalFood, "Dhokla");
  assert.ok(agentResponse.knowledge.retrievalSources.length > 0);

  // Variant Safety Guard Assertion:
  // Patient is allergic to wheat. Rava Dhokla requires semolina (wheat derivative).
  // The deterministic per-variant allergy guard MUST downgrade Rava Dhokla to "avoid"!
  const ravaVerdict = agentResponse.verdict.variantVerdicts.find((vv) => vv.variantName === "Rava Dhokla");
  assert.ok(ravaVerdict, "Rava Dhokla verdict must exist");
  assert.equal(ravaVerdict.verdict, "avoid", "Rava Dhokla must be forced to avoid due to required wheat/semolina allergen!");
  assert.ok(ravaVerdict.allergyGuardTriggered === true);
  assert.ok(ravaVerdict.reason.toLowerCase().includes("wheat") || ravaVerdict.reason.toLowerCase().includes("semolina"));

  // Khaman Dhokla (made of besan/gram flour) has no wheat allergen -> stays "good"
  const khamanVerdict = agentResponse.verdict.variantVerdicts.find((vv) => vv.variantName === "Khaman Dhokla");
  assert.ok(khamanVerdict);
  assert.equal(khamanVerdict.verdict, "good");

  // Verify variant documented ingredients and citations are preserved
  const khamanVariant = agentResponse.variants.find((v) => v.name === "Khaman Dhokla");
  assert.ok(khamanVariant);
  assert.ok(khamanVariant.documentedIngredients.length >= 6);
  assert.ok(khamanVariant.sources.length >= 1);
  assert.ok(khamanVariant.sources[0].url.startsWith("http"));
});

test("Whole Flow: Dish Not in Knowledge Base -> Explicit AI Fallback -> Unverified Badges & Transparent Uncertainty", async () => {
  const db = createFullFlowDb();
  // Knowledge base seeded with Dhokla only
  await importFoodKnowledge(db, VERIFIED_STARTER_DATA);

  // Food analyzed is Spaghetti Carbonara (not in catalog)
  const rawSpaghettiOutput = {
    is_food: true,
    food_name: "Spaghetti Carbonara",
    cuisine: "Italian",
    food_style: "Pasta",
    food_confidence: 90,
    style_confidence: 85,
    visible_ingredients: [
      { name: "Spaghetti pasta", confidence: 95, role: "carb base" },
      { name: "Pancetta", confidence: 80, role: "cured meat" },
    ],
    suspected_ingredients: [
      { name: "Egg yolks", confidence: 85, role: "sauce" },
      { name: "Pecorino Romano cheese", confidence: 75, role: "cheese" },
    ],
    traditional_ingredients: [
      { name: "Black pepper", confidence: 80, role: "seasoning" },
    ],
    estimated_serving: { description: "1 bowl", grams: 280, confidence: 60 },
    nutrition_estimate: {
      calories: 580,
      protein_g: 22,
      carbohydrates_g: 65,
      fat_g: 26,
      saturated_fat_g: 10,
      fiber_g: 3,
      sugar_g: 3,
      sodium_mg: 850,
      cholesterol_mg: 140,
      confidence: 50,
    },
    limitations: ["Exact pasta portion and cheese quantity cannot be determined."],
  };

  const foodAnalysis = validateFoodAnalysis(rawSpaghettiOutput);

  const fakeGemini = createFakeGemini({
    food: rawSpaghettiOutput,
    context: {
      evidence_summary: "Patient has lactose intolerance.",
      relevant_conditions: [],
      allergy_conflicts: [],
      medication_or_report_notes: [],
      past_reactions_to_this_food: [],
      similar_food_evidence: [],
      ingredients_of_concern: [{ ingredient: "Cheese", reason: "Dairy content", source: "profile" }],
      missing_information: [],
      evidence_confidence: 80,
    },
    variants: {
      variants: [
        {
          name: "Dairy-Free Spaghetti Carbonara",
          region_or_style: "Dietary adaptation",
          description: "Made with nutritional yeast instead of Pecorino.",
          matches_uploaded_food: false,
          ingredient_changes: { added: ["nutritional yeast"], removed: ["pecorino cheese"], substituted: [] },
          nutrition_vs_uploaded: { calories: "lower", carbohydrates: "similar", fat: "lower", sodium: "lower", fiber: "higher" },
          approx_calories_per_serving: 490,
          confidence: 70,
        },
      ],
    },
    verdict: {
      overall_verdict: "caution",
      headline: "Contains dairy cheese which may trigger lactose intolerance.",
      confidence: 75,
      reasons: [{ point: "Pecorino cheese contains lactose.", severity: "medium", evidence_source: "ingredients" }],
      ingredients_of_concern: ["Pecorino Romano cheese"],
      recommended_portion: "Small bowl",
      variant_verdicts: [
        { variant_name: "Dairy-Free Spaghetti Carbonara", verdict: "good", reason: "Uses nutritional yeast instead of dairy." },
      ],
      safer_alternatives: ["Dairy-Free Spaghetti Carbonara"],
      missing_information: [],
    },
  });

  const agentResponse = await runFoodAgents({
    gemini: fakeGemini,
    db,
    userId: "patient_lactose_user",
    patient: {
      name: "Alex",
      allergies: [],
      diseases: ["Lactose Intolerance"],
      foodPreferences: [],
    },
    personalization: { foodGenome: {}, digitalTwin: {} },
    learning: {},
    foodAnalysis,
  });

  // Assertions for catalog fallback
  assert.equal(agentResponse.knowledge.retrievalStatus, "no_match");
  assert.equal(agentResponse.knowledge.dataSource, "ai_generated");
  assert.equal(agentResponse.knowledge.retrievalSources.length, 0, "No sources should be fabricated when dish is missing from catalog");

  // Variant must be clearly flagged as unverified AI suggestion
  const variant = agentResponse.variants[0];
  assert.equal(variant.dataSource, "ai_generated");
  assert.equal(variant.isVerified, false);
  assert.equal(variant.isUnverifiedSuggestion, true);
  assert.ok(variant.uncertainties[0].includes("AI-generated suggestion"));
});

