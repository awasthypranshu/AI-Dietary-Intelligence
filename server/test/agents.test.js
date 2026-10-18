const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeGemini, FOOD_JSON } = require("./fakeGemini");
const { validateFoodAnalysis } = require("../ai/foodAnalysisValidator");
const { generateValidatedJson } = require("../ai/geminiJson");
const { runFoodAgents } = require("../ai/agents/orchestrator");

const foodAnalysis = validateFoodAnalysis(FOOD_JSON);

// Minimal fake db: returns empty history / ingredient rows.
const fakeDb = { async query() { return [[]]; } };

const patient = {
  name: "Test", age: 50, gender: "male", diseases: ["type 2 diabetes"],
  allergies: [], foodPreferences: [], medicalReportData: { medications: ["metformin"] },
};

function baseInput(gemini) {
  return {
    gemini, db: fakeDb, userId: "u1", patient,
    personalization: { digitalTwin: {}, foodGenome: {} },
    learning: { preferences: [], learnedPatterns: [], recentExperiences: [] },
    foodAnalysis,
  };
}

test("agents run end to end and Agent 1 actually calls its tools", async () => {
  const gemini = createFakeGemini();
  const result = await runFoodAgents(baseInput(gemini));
  assert.deepEqual(result.agentErrors, {});
  assert.equal(result.verdict.overallVerdict, "good");
  assert.equal(result.variants.length, 2);
  const used = result.personalContext.toolsUsed.map((t) => t.tool);
  assert.ok(used.includes("get_patient_profile"));
  assert.ok(used.includes("get_medical_report"));
  assert.ok(used.includes("search_food_history"));
  assert.ok(used.includes("find_similar_by_ingredients"));
});

test("if the variant agent fails, verdict still runs and the error is reported", async () => {
  const gemini = createFakeGemini({ variantsText: "garbage, not json" });
  const result = await runFoodAgents(baseInput(gemini));
  assert.equal(result.variants, null);
  assert.ok(result.agentErrors.variantAgent);
  assert.ok(result.verdict);
});

test("generateValidatedJson retries once then gives up with AI_INVALID_OUTPUT", async () => {
  let count = 0;
  const gemini = { models: { async generateContent() { count += 1; return { text: "nope" }; } } };
  await assert.rejects(
    generateValidatedJson({ gemini, contents: [{ text: "x" }], validate: (r) => r }),
    (error) => error.code === "AI_INVALID_OUTPUT"
  );
  assert.equal(count, 2);
});

test("generateValidatedJson recovers when the retry is valid", async () => {
  let count = 0;
  const gemini = { models: { async generateContent() { count += 1; return { text: count === 1 ? "bad" : '{"ok":true}' }; } } };
  const out = await generateValidatedJson({ gemini, contents: [{ text: "x" }], validate: (r) => r });
  assert.deepEqual(out, { ok: true });
});