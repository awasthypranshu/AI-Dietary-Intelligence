const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFoodAnalysis } = require("../ai/foodAnalysisValidator");
const { parseJsonFromText } = require("../ai/geminiJson");
const { validateVerdict, findAllergyMatches, applyAllergyGuard } = require("../ai/agents/verdictAgent");
const { validateVariants } = require("../ai/agents/variantAgent");
const { FOOD_JSON, VERDICT_JSON, VARIANTS_JSON } = require("./fakeGemini");

test("valid food JSON is normalized and marked as estimate", () => {
  const out = validateFoodAnalysis(FOOD_JSON);
  assert.equal(out.foodName, "Chole Bhature");
  assert.equal(out.confidence.food, 92);
  assert.equal(out.ingredients.visible.length, 2);
  assert.equal(out.ingredients.suspected[0].category, "suspected");
  assert.equal(out.estimatedServing.isEstimate, true);
  assert.equal(out.nutritionEstimate.isEstimate, true);
});

test("confidence is clamped to 0-100 and bad numbers become null", () => {
  const out = validateFoodAnalysis({
    ...FOOD_JSON,
    food_confidence: 250,
    style_confidence: "abc",
    nutrition_estimate: { calories: -5, protein_g: "12" },
  });
  assert.equal(out.confidence.food, 100);
  assert.equal(out.confidence.style, null);
  assert.equal(out.nutritionEstimate.calories, null);
  assert.equal(out.nutritionEstimate.protein_g, 12);
});

test("missing food_name is rejected", () => {
  assert.throws(() => validateFoodAnalysis({ is_food: true }), /food_name/);
});

test("non-object output is rejected", () => {
  assert.throws(() => validateFoodAnalysis("pizza"), /JSON object/);
  assert.throws(() => validateFoodAnalysis(null), /JSON object/);
});

test("limitations are always present", () => {
  const out = validateFoodAnalysis({ ...FOOD_JSON, limitations: [] });
  assert.ok(out.limitations.length >= 1);
});

test("duplicate ingredients are removed", () => {
  const out = validateFoodAnalysis({
    ...FOOD_JSON,
    visible_ingredients: [{ name: "Oil" }, { name: "oil" }, "Salt"],
  });
  assert.equal(out.ingredients.visible.length, 2);
});

test("parseJsonFromText handles code fences and surrounding text", () => {
  assert.deepEqual(parseJsonFromText('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonFromText('Here you go: {"a":2} thanks'), { a: 2 });
  assert.throws(() => parseJsonFromText("not json"), /malformed/);
  assert.throws(() => parseJsonFromText(""), /empty/);
});

test("verdict validation rejects unknown verdict values", () => {
  assert.throws(() => validateVerdict({ ...VERDICT_JSON, overall_verdict: "great" }), /overall_verdict/);
  const ok = validateVerdict(VERDICT_JSON);
  assert.equal(ok.overallVerdict, "good");
  assert.ok(ok.disclaimer.includes("not medical advice"));
});

test("variant validation needs at least one variant", () => {
  assert.throws(() => validateVariants({ variants: [] }), /missing or empty/);
  assert.equal(validateVariants(VARIANTS_JSON).length, 2);
});

test("allergy guard forces avoid for a visible allergen", () => {
  const food = validateFoodAnalysis(FOOD_JSON);
  const patient = { allergies: ["chickpea"] };
  const matches = findAllergyMatches(patient, food);
  assert.ok(matches.length > 0);
  const guarded = applyAllergyGuard(validateVerdict(VERDICT_JSON), matches);
  assert.equal(guarded.overallVerdict, "avoid");
  assert.equal(guarded.allergyGuardTriggered, true);
  assert.equal(guarded.reasons[0].severity, "high");
});

test("allergy guard only raises to caution for a suspected-only allergen", () => {
  const food = validateFoodAnalysis(FOOD_JSON);
  const matches = findAllergyMatches({ allergies: ["peanut"] }, food);
  assert.ok(matches.length > 0);
  assert.ok(matches.every((m) => m.category !== "visible"));
  const guarded = applyAllergyGuard(validateVerdict(VERDICT_JSON), matches);
  assert.equal(guarded.overallVerdict, "caution");
});

test("no allergy match leaves the verdict unchanged", () => {
  const food = validateFoodAnalysis(FOOD_JSON);
  const matches = findAllergyMatches({ allergies: ["shellfish"] }, food);
  assert.equal(matches.length, 0);
  const result = validateVerdict(VERDICT_JSON);
  assert.equal(applyAllergyGuard(result, matches).overallVerdict, "good");
});