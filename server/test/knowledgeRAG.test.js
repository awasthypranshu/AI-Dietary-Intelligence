const test = require("node:test");
const assert = require("node:assert/strict");

const {
  retrieveFoodKnowledge,
  normalize,
  ingredientsFromJson,
} = require("../ai/agents/knowledgeRetriever");
const {
  importFoodKnowledge,
  FIXTURES,
} = require("../ai/agents/seedFoodKnowledge");
const {
  runVariantAgent,
  knowledgeVariantsToStructured,
} = require("../ai/agents/variantAgent");
const {
  runVerdictAgent,
  findVariantAllergyMatches,
  applyPerVariantAllergyGuards,
  validateVerdict,
} = require("../ai/agents/verdictAgent");
const { runFoodAgents } = require("../ai/agents/orchestrator");
const { createFakeGemini, FOOD_JSON, VERDICT_JSON } = require("./fakeGemini");
const { validateFoodAnalysis } = require("../ai/foodAnalysisValidator");

// ---------------------------------------------------------------------------
// In-Memory Test Database
// ---------------------------------------------------------------------------

function createTestDb() {
  const tables = {
    food_knowledge: [],
    food_knowledge_aliases: [],
    food_agent_reports: [],
    food_images: [],
    food_sources: [],
    food_variants: [],
    food_variant_ingredients: [],
  };

  return {
    tables,
    async query(sql, params = []) {
      const s = sql.trim();

      // COUNT(*)
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

      // Check existing food_sources
      if (/SELECT\s+id\s+FROM\s+food_sources/i.test(s)) {
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
      if (/SELECT\s+id\s+FROM\s+food_variant_ingredients/i.test(s)) {
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

      // Check existing knowledge row
      if (/SELECT\s+id\s+FROM\s+food_knowledge\s+WHERE\s+canonical_name_key\s*=\s*\?\s+AND\s+variant_name_key\s*=\s*\?/i.test(s)) {
        const found = tables.food_knowledge.filter(
          (r) => r.canonical_name_key === params[0] && r.variant_name_key === params[1]
        );
        return [found];
      }

      // Check existing alias
      if (/SELECT\s+id\s+FROM\s+food_knowledge_aliases\s+WHERE/i.test(s)) {
        const found = tables.food_knowledge_aliases.filter(
          (r) => (r.food_knowledge_id === params[0] || r.canonical_name_key === params[0]) && r.alias_key === params[1]
        );
        return [found];
      }

      // Insert alias (check before food_knowledge)
      if (/\bINSERT\s+INTO\s+food_knowledge_aliases\b/i.test(s)) {
        tables.food_knowledge_aliases.push({
          id: params[0],
          food_knowledge_id: params[1],
          alias_key: params[2],
          alias_name: params[3],
          canonical_name_key: params[4] || null,
        });
        return [{ affectedRows: 1 }];
      }

      // Insert food_knowledge
      if (/\bINSERT\s+INTO\s+food_knowledge\s*\(/i.test(s)) {
        tables.food_knowledge.push({
          id: params[0],
          canonical_name: params[1],
          canonical_name_key: params[2],
          variant_name: params[3],
          variant_name_key: params[4],
          region_or_style: params[5],
          description: params[6],
          ingredients_json: params[7],
          sources_json: params[8],
          is_verified: params[9],
          is_fixture: params[10],
        });
        return [{ affectedRows: 1 }];
      }

      // Exact canonical name lookup
      if (/\bFROM\s+food_knowledge\s+WHERE\s+canonical_name_key\s*=\s*\?/i.test(s)) {
        const rows = tables.food_knowledge
          .filter((r) => r.canonical_name_key === params[0])
          .sort((a, b) => (a.variant_name || "").localeCompare(b.variant_name || ""));
        return [rows];
      }

      // Alias lookup to canonical_name_key
      if (/\bJOIN\s+food_knowledge_aliases\b/i.test(s)) {
        const alias = tables.food_knowledge_aliases.find(
          (a) => a.alias_key === params[0]
        );
        if (!alias) return [[]];
        const fk = tables.food_knowledge.find((k) => k.id === alias.food_knowledge_id);
        if (!fk) return [[]];
        return [[{ canonical_name_key: fk.canonical_name_key }]];
      }

      // Substring / LIKE lookup
      if (/WHERE\s+canonical_name_key\s+LIKE\s+\?\s+OR\s+variant_name_key\s+LIKE/i.test(s)) {
        const raw = String(params[0] || "").replace(/%/g, "").toLowerCase();
        const found = tables.food_knowledge.find(
          (r) =>
            (r.canonical_name_key && r.canonical_name_key.includes(raw)) ||
            (r.variant_name_key && r.variant_name_key.includes(raw))
        );
        if (!found) return [[]];
        return [[{ canonical_name_key: found.canonical_name_key }]];
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
// Tests
// ---------------------------------------------------------------------------

test("Knowledge Retriever: normalize handles casing, spaces, diacritics, and punctuation", () => {
  assert.equal(normalize("  Chole  Bhature  "), "chole bhature");
  assert.equal(normalize("Dhôkla"), "dhokla");
  assert.equal(normalize("Crème Brûlée"), "creme brulee");
  assert.equal(normalize("Khaman's Dhokla"), "khamans dhokla");
  assert.equal(normalize(""), "");
  assert.equal(normalize(null), "");
});

test("Knowledge Retriever: ingredientsFromJson parses strings and structured items", () => {
  const json = JSON.stringify([
    "Besan",
    {
      name: "Mustard seeds",
      classification: "typical",
      source: "Gujarati cookbook",
      notes: "for tempering",
    },
    { name: "Sugar", classification: "optional" },
  ]);

  const items = ingredientsFromJson(json);
  assert.equal(items.length, 3);
  assert.equal(items[0].name, "Besan");
  assert.equal(items[0].classification, "typical");
  assert.equal(items[1].name, "Mustard seeds");
  assert.equal(items[1].source, "Gujarati cookbook");
  assert.equal(items[1].notes, "for tempering");
  assert.equal(items[2].classification, "optional");

  // Invalid JSON falls back to empty array
  assert.deepEqual(ingredientsFromJson("not json"), []);
  assert.deepEqual(ingredientsFromJson(null), []);
});

test("Knowledge Retriever: empty_kb status when knowledge table has zero rows", async () => {
  const db = createTestDb();
  const res = await retrieveFoodKnowledge(db, "Dhokla");
  assert.equal(res.status, "empty_kb");
  assert.equal(res.variants.length, 0);
});

test("Knowledge Retriever: no_match status when food is not found in populated KB", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const res = await retrieveFoodKnowledge(db, "Spaghetti Bolognese");
  assert.equal(res.status, "no_match");
  assert.equal(res.variants.length, 0);
});

test("Knowledge Retriever: exact canonical name match retrieves all documented variants with provenance", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const res = await retrieveFoodKnowledge(db, "Dhokla");
  assert.equal(res.status, "found");
  assert.equal(res.food, "Dhokla");
  assert.equal(res.variants.length, 3);

  const khaman = res.variants.find((v) => v.variantName === "Khaman Dhokla");
  assert.ok(khaman);
  assert.equal(khaman.isFixture, true);
  assert.equal(khaman.isVerified, false);

  const reqBesan = khaman.ingredients.find((i) => i.name.includes("Besan"));
  assert.ok(reqBesan);
  assert.equal(reqBesan.classification, "required");
  assert.ok(reqBesan.source);
});

test("Knowledge Retriever: alias resolution retrieves all variants of the canonical food", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  // "khaman" is an alias of Khaman Dhokla -> resolves to Dhokla
  const res = await retrieveFoodKnowledge(db, "khaman");
  assert.equal(res.status, "found");
  assert.equal(res.variants.length, 3);
  assert.ok(res.variants.some((v) => v.variantName === "Rava Dhokla"));
});

test("Knowledge Retriever: partial/substring match resolves to canonical food", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const res = await retrieveFoodKnowledge(db, "Bhature");
  assert.equal(res.status, "found");
  assert.equal(res.food, "Chole Bhature");
  assert.equal(res.variants.length, 2);
});

test("Seed Tooling: importFoodKnowledge is idempotent and clearly labels test fixtures", async () => {
  const db = createTestDb();

  const firstRun = await importFoodKnowledge(db, FIXTURES, { isFixture: true });
  assert.equal(firstRun.inserted, FIXTURES.length);
  assert.ok(firstRun.aliases > 0);

  // All inserted rows must be labeled as fixtures
  assert.ok(db.tables.food_knowledge.every((r) => r.is_fixture === 1));
  assert.ok(db.tables.food_knowledge.every((r) => r.is_verified === 0));

  // Second run must be skipped idempotently
  const secondRun = await importFoodKnowledge(db, FIXTURES, { isFixture: true });
  assert.equal(secondRun.inserted, 0);
  assert.equal(secondRun.skipped, FIXTURES.length);
});

test("Variant Agent: uses documented KB variants when available", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const foodAnalysis = validateFoodAnalysis({
    ...FOOD_JSON,
    food_name: "Dhokla",
  });

  const gemini = createFakeGemini();
  const res = await runVariantAgent({ gemini, foodAnalysis, db });

  assert.equal(res.dataSource, "knowledge_base");
  assert.equal(res.retrievalStatus, "found");
  assert.equal(res.variants.length, 3);
  assert.ok(res.variants[0].documentedIngredients.length > 0);
  assert.ok(res.variants[0].isFixture);
});

test("Variant Agent: falls back to AI generation when KB has no match", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const foodAnalysis = validateFoodAnalysis({
    ...FOOD_JSON,
    food_name: "Sushi roll",
  });

  const gemini = createFakeGemini();
  const res = await runVariantAgent({ gemini, foodAnalysis, db });

  assert.equal(res.dataSource, "ai_generated");
  assert.equal(res.retrievalStatus, "no_match");
  assert.equal(res.variants.length, 2); // from fakeGemini VARIANTS_JSON
});

test("Verdict Agent: finds variant allergy matches distinguishing confirmed vs possible presence", () => {
  const patient = { allergies: ["semolina", "sesame"] };
  const variant = {
    name: "Rava Dhokla",
    documentedIngredients: [
      { name: "Semolina (rava/sooji)", classification: "required" },
      { name: "Sesame seeds", classification: "optional" },
    ],
  };

  const matches = findVariantAllergyMatches(patient, variant);
  assert.equal(matches.length, 2);

  const semolinaMatch = matches.find((m) => m.allergy === "semolina");
  assert.equal(semolinaMatch.presence, "confirmed");

  const sesameMatch = matches.find((m) => m.allergy === "sesame");
  assert.equal(sesameMatch.presence, "possible");
});

test("Verdict Agent: per-variant allergy guard overrides variant verdict appropriately", () => {
  const patient = { allergies: ["maida"] };
  const variants = [
    {
      name: "Chole Bhature (classic Punjabi)",
      documentedIngredients: [
        { name: "Maida (all-purpose flour)", classification: "required" },
        { name: "Chickpeas", classification: "required" },
      ],
    },
    {
      name: "Whole-wheat Chole Kulche",
      documentedIngredients: [
        { name: "Whole wheat flour", classification: "required" },
        { name: "Chickpeas", classification: "required" },
      ],
    },
  ];

  const initialVerdict = {
    overallVerdict: "caution",
    headline: "Be careful.",
    variantVerdicts: [
      { variantName: "Chole Bhature (classic Punjabi)", verdict: "good", reason: "Standard version." },
      { variantName: "Whole-wheat Chole Kulche", verdict: "good", reason: "Whole grains." },
    ],
  };

  const guarded = applyPerVariantAllergyGuards(initialVerdict, patient, variants);

  const classic = guarded.variantVerdicts.find(
    (v) => v.variantName === "Chole Bhature (classic Punjabi)"
  );
  assert.equal(classic.verdict, "avoid");
  assert.equal(classic.allergyGuardTriggered, true);
  assert.ok(classic.reason.includes("Maida"));

  const wholeWheat = guarded.variantVerdicts.find(
    (v) => v.variantName === "Whole-wheat Chole Kulche"
  );
  assert.equal(wholeWheat.verdict, "good");
  assert.equal(wholeWheat.allergyGuardTriggered, undefined);
});

test("Orchestrator: includes knowledge summary and passes db to agents", async () => {
  const db = createTestDb();
  await importFoodKnowledge(db, FIXTURES, { isFixture: true });

  const foodAnalysis = validateFoodAnalysis({
    ...FOOD_JSON,
    food_name: "Chole Bhature",
  });

  const gemini = createFakeGemini();
  const patient = {
    name: "Patient",
    age: 45,
    gender: "female",
    diseases: [],
    allergies: ["maida"],
    foodPreferences: [],
  };

  const res = await runFoodAgents({
    gemini,
    db,
    userId: "u1",
    patient,
    personalization: { digitalTwin: {}, foodGenome: {} },
    learning: { preferences: [], learnedPatterns: [], recentExperiences: [] },
    foodAnalysis,
  });

  assert.deepEqual(res.agentErrors, {});
  assert.ok(res.knowledge);
  assert.equal(res.knowledge.dataSource, "knowledge_base");
  assert.equal(res.knowledge.retrievalStatus, "found");
  assert.ok(res.knowledge.retrievalSources.length > 0);
  assert.equal(res.variants.length, 2);

  // Check per-variant allergy guard triggered on classic maida variant
  const classic = res.verdict.variantVerdicts.find(
    (v) => v.variantName === "Chole Bhature (classic Punjabi)"
  );
  if (classic) {
    assert.equal(classic.verdict, "avoid");
  }
});
