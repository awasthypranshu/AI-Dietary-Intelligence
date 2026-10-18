// AGENT 3 - Verdict Agent
// Reads the food analysis, the Personal Context Agent's evidence and the
// Variant Agent's variants, then decides whether the food (and each
// variant) is good for the patient. A deterministic allergy guard runs
// AFTER the model so an allergy match can never be reported as "good".
//
// UPDATED: now supports per-variant personalized verdicts that use each
// variant's own documented ingredients (from the knowledge base) for
// allergy checking. Distinguishes confirmed vs possible ingredient presence.

const { generateValidatedJson } = require("../geminiJson");
const { cleanString, cleanConfidence } = require("../foodAnalysisValidator");

const VERDICTS = ["good", "caution", "avoid", "insufficient_data"];
const SEVERITIES = ["low", "medium", "high"];

const DISCLAIMER =
  "This is dietary guidance based on an AI estimate from a photo and the information you provided. It is not medical advice. Check with your doctor or dietitian, especially for allergies, medications or medical conditions.";

function verdict(value, fallback = "insufficient_data") {
  const text = String(value || "").toLowerCase().trim();
  return VERDICTS.includes(text) ? text : fallback;
}

function validateVerdict(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const error = new Error("Verdict must be a JSON object.");
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }

  const overall = String(raw.overall_verdict || "").toLowerCase().trim();
  if (!VERDICTS.includes(overall)) {
    const error = new Error(
      `overall_verdict must be one of: ${VERDICTS.join(", ")}.`
    );
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }

  const strings = (value, max = 10) =>
    Array.isArray(value)
      ? value.map((v) => cleanString(v, 300)).filter(Boolean).slice(0, max)
      : [];

  return {
    overallVerdict: overall,
    headline: cleanString(raw.headline, 250),
    confidence: cleanConfidence(raw.confidence),
    reasons: (Array.isArray(raw.reasons) ? raw.reasons : [])
      .map((item) => {
        const severity = String(item?.severity || "").toLowerCase();
        return {
          point: cleanString(item?.point, 300),
          severity: SEVERITIES.includes(severity) ? severity : "low",
          evidenceSource: cleanString(item?.evidence_source, 80),
        };
      })
      .filter((item) => item.point)
      .slice(0, 12),
    ingredientsOfConcern: strings(raw.ingredients_of_concern),
    recommendedPortion: cleanString(raw.recommended_portion, 250),
    variantVerdicts: (Array.isArray(raw.variant_verdicts) ? raw.variant_verdicts : [])
      .map((item) => ({
        variantName: cleanString(item?.variant_name, 150),
        verdict: verdict(item?.verdict),
        reason: cleanString(item?.reason, 300),
      }))
      .filter((item) => item.variantName)
      .slice(0, 12),
    saferAlternatives: strings(raw.safer_alternatives, 6),
    missingInformation: strings(raw.missing_information, 6),
    disclaimer: DISCLAIMER,
  };
}

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

// Deterministic safety net: compare patient allergies with every
// ingredient (visible, suspected AND traditional) in the analysis.
function findAllergyMatches(patient, foodAnalysis) {
  const allergies = Array.isArray(patient?.allergies) ? patient.allergies : [];
  const ingredients = [
    ...foodAnalysis.ingredients.visible,
    ...foodAnalysis.ingredients.suspected,
    ...foodAnalysis.ingredients.traditional,
  ];

  const matches = [];

  for (const allergy of allergies) {
    const allergyWords = normalizeWords(allergy);
    if (allergyWords.length === 0) continue;

    for (const ingredient of ingredients) {
      const name = typeof ingredient === "string" ? ingredient : ingredient.name;
      const notes = typeof ingredient === "object" ? (ingredient.notes || "") : "";
      const role = typeof ingredient === "object" ? (ingredient.role || "") : "";
      const textToSearch = `${name} ${notes} ${role}`;
      const ingredientWords = normalizeWords(textToSearch);
      const hit = allergyWords.some(
        (word) =>
          ingredientWords.includes(word) ||
          ingredientWords.some((w) => w.startsWith(word) || word.startsWith(w))
      );

      if (hit) {
        matches.push({
          allergy: String(allergy),
          ingredient: name,
          category: ingredient.category,
        });
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Per-variant allergy checking using documented ingredients
// ---------------------------------------------------------------------------

function findVariantAllergyMatches(patient, variant) {
  const allergies = Array.isArray(patient?.allergies) ? patient.allergies : [];
  if (allergies.length === 0) return [];

  // Use documented ingredients if available, otherwise fall back to
  // ingredient_changes data.
  const ingredients = variant.documentedIngredients || [];
  const matches = [];

  for (const allergy of allergies) {
    const allergyWords = normalizeWords(allergy);
    if (allergyWords.length === 0) continue;

    for (const ingredient of ingredients) {
      const name = typeof ingredient === "string" ? ingredient : ingredient.name;
      const notes = typeof ingredient === "object" ? (ingredient.notes || "") : "";
      const role = typeof ingredient === "object" ? (ingredient.role || "") : "";
      const textToSearch = `${name} ${notes} ${role}`;
      const ingredientWords = normalizeWords(textToSearch);
      const hit = allergyWords.some(
        (word) =>
          ingredientWords.includes(word) ||
          ingredientWords.some((w) => w.startsWith(word) || word.startsWith(w))
      );

      if (hit) {
        const classification = ingredient.classification || "typical";
        // required and typical = confirmed presence; optional/regional/substitution = possible
        const presence = ["required", "typical"].includes(classification)
          ? "confirmed"
          : "possible";

        matches.push({
          allergy: String(allergy),
          ingredient: name,
          classification,
          presence,
        });
      }
    }
  }

  return matches;
}

function applyAllergyGuard(result, matches) {
  if (matches.length === 0) return result;

  const guarded = { ...result };
  const hasConfirmed = matches.some((m) => m.category === "visible");

  const rank = { good: 0, insufficient_data: 0, caution: 1, avoid: 2 };
  const floor = hasConfirmed ? "avoid" : "caution";

  if (rank[guarded.overallVerdict] < rank[floor]) {
    guarded.overallVerdict = floor;
  }

  guarded.reasons = [
    ...matches.map((match) => ({
      point: `Allergy alert: you list "${match.allergy}" and this food contains or may contain "${match.ingredient}" (${match.category} ingredient).`,
      severity: "high",
      evidenceSource: "allergy_guard",
    })),
    ...guarded.reasons,
  ];

  guarded.allergyGuardTriggered = true;
  return guarded;
}

// ---------------------------------------------------------------------------
// Apply per-variant allergy guard using documented ingredient lists
// ---------------------------------------------------------------------------

function applyPerVariantAllergyGuards(result, patient, variantsData) {
  const list = Array.isArray(variantsData)
    ? variantsData
    : Array.isArray(variantsData?.variants)
    ? variantsData.variants
    : [];

  if (list.length === 0) return result;

  const guarded = { ...result };
  const existingMap = new Map(
    (guarded.variantVerdicts || []).map((vv) => [vv.variantName.toLowerCase().trim(), vv])
  );

  const perVariantVerdicts = [];

  for (const v of list) {
    const vName = (v.name || "").trim();
    if (!vName) continue;
    const vv = existingMap.get(vName.toLowerCase()) || {
      variantName: vName,
      verdict: "good",
      reason: v.description || "Alternative preparation.",
    };

    const matches = findVariantAllergyMatches(patient, v);

    if (matches.length === 0) {
      perVariantVerdicts.push(vv);
      continue;
    }

    const hasConfirmedAllergy = matches.some((m) => m.presence === "confirmed");
    const rank = { good: 0, insufficient_data: 0, caution: 1, avoid: 2 };
    const floor = hasConfirmedAllergy ? "avoid" : "caution";
    let newVerdict = vv.verdict;

    if (rank[newVerdict] < rank[floor]) {
      newVerdict = floor;
    }

    const allergyNotes = matches
      .map((m) => {
        const pNote =
          m.presence === "confirmed"
            ? "required recipe ingredient"
            : "optional/possible ingredient";
        return `Allergy "${m.allergy}" matches ${pNote} "${m.ingredient}" (${m.classification}).`;
      })
      .join(" ");

    perVariantVerdicts.push({
      ...vv,
      verdict: newVerdict,
      reason: allergyNotes + (vv.reason ? " " + vv.reason : ""),
      allergyConflicts: matches,
      allergyGuardTriggered: true,
    });
  }

  guarded.variantVerdicts = perVariantVerdicts;
  return guarded;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runVerdictAgent({
  gemini,
  patient,
  foodAnalysis,
  personalContext,
  variants,
}) {
  // Extract variant list from the new structured format or the old array.
  const variantList = variants?.variants || (Array.isArray(variants) ? variants : null);

  const prompt = `
You are the Verdict Agent in a dietary-intelligence system. Decide whether
this food is good for this specific patient.

PATIENT:
${JSON.stringify(
  {
    age: patient.age,
    gender: patient.gender,
    diseases: patient.diseases,
    allergies: patient.allergies,
    foodPreferences: patient.foodPreferences,
  },
  null,
  2
)}

FOOD ANALYSIS (nutrition values are estimates from a photo):
${JSON.stringify(
  {
    foodName: foodAnalysis.foodName,
    foodStyle: foodAnalysis.foodStyle,
    ingredients: foodAnalysis.ingredients,
    estimatedServing: foodAnalysis.estimatedServing,
    nutritionEstimate: foodAnalysis.nutritionEstimate,
    limitations: foodAnalysis.limitations,
  },
  null,
  2
)}

EVIDENCE FROM THE PERSONAL CONTEXT AGENT (profile, medical report /
prescription, food history):
${personalContext ? JSON.stringify(personalContext, null, 2) : "NOT AVAILABLE - the evidence agent failed. Say so and lower your confidence."}

POSSIBLE VARIANTS FROM THE VARIANT AGENT:
${variantList ? JSON.stringify(variantList.map((v) => ({
  name: v.name,
  description: v.description,
  ingredientChanges: v.ingredientChanges,
  nutritionVsUploaded: v.nutritionVsUploaded,
  documentedIngredients: v.documentedIngredients
    ? v.documentedIngredients.map((i) => ({ name: i.name, classification: i.classification }))
    : undefined,
  dataSource: v.dataSource,
})), null, 2) : "NOT AVAILABLE"}

RULES
- overall_verdict is one of: good, caution, avoid, insufficient_data.
- Base every reason on the evidence above. Do not invent medical facts,
  history or lab values. If evidence is thin, use "insufficient_data" or
  "caution" and list what is missing.
- Treat suspected ingredients as possible, not certain.
- When a variant has documented ingredients from the knowledge base, use
  those for your analysis. Distinguish confirmed (required/typical) vs
  possible (optional/regional/substitution) ingredient presence.
- Do NOT give an unconditional "good" verdict when an allergy conflict or
  material uncertainty exists.
- Give a verdict for EACH variant (same schema) so the patient can see
  which version is better or worse for them.
- Never diagnose, never change medication, and always recommend
  confirming with a doctor for serious conditions.

Return one JSON object:
{
  "overall_verdict": "good|caution|avoid|insufficient_data",
  "headline": "one short sentence",
  "confidence": 0,
  "reasons": [{"point": "string", "severity": "low|medium|high", "evidence_source": "profile|medical_report|history|ingredients|nutrition|variants"}],
  "ingredients_of_concern": ["string"],
  "recommended_portion": "string",
  "variant_verdicts": [{"variant_name": "string", "verdict": "good|caution|avoid|insufficient_data", "reason": "string"}],
  "safer_alternatives": ["string"],
  "missing_information": ["string"]
}
`;

  const modelResult = await generateValidatedJson({
    gemini,
    contents: [{ text: prompt }],
    validate: validateVerdict,
    temperature: 0.1,
  });

  // Apply the overall allergy guard (original food ingredients).
  let guarded = applyAllergyGuard(
    modelResult,
    findAllergyMatches(patient, foodAnalysis)
  );

  // Apply per-variant allergy guards using documented ingredients.
  if (variantList) {
    guarded = applyPerVariantAllergyGuards(guarded, patient, { variants: variantList });
  }

  return guarded;
}

module.exports = {
  runVerdictAgent,
  validateVerdict,
  findAllergyMatches,
  findVariantAllergyMatches,
  applyAllergyGuard,
  applyPerVariantAllergyGuards,
  DISCLAIMER,
};