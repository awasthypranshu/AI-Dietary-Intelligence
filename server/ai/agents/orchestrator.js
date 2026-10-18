// Runs the AI Agents:
//
//   Agent 1 (Personal Context, agentic RAG) ─┐
//                                            ├─> Per-Variant Patient Enrichment ─> Agent 3 (Verdict)
//   Agent 2 (Variants + Knowledge Retrieval) ┘
//
// Agents 1 and 2 run concurrently in parallel. Once variant retrieval completes,
// an enrichment step retrieves patient-specific evidence (allergies, medical constraints,
// distinctive ingredient history) for each candidate variant before passing to Agent 3.

const { runPersonalContextAgent } = require("./personalContextAgent");
const { runVariantAgent } = require("./variantAgent");
const { runVerdictAgent, findVariantAllergyMatches } = require("./verdictAgent");
const { normalizeIngredientKey } = require("../normalization");

/**
 * Enriches candidate variants with patient-specific history and allergy checks.
 * Does NOT write any private patient data into the shared knowledge base.
 */
async function enrichVariantsWithPatientEvidence({
  db,
  userId,
  patient,
  variantData,
}) {
  if (!variantData || !Array.isArray(variantData.variants)) {
    return variantData;
  }

  const enrichedList = variantData.variants.map((v) => {
    const allergyMatches = findVariantAllergyMatches(patient, v);
    const concerns = allergyMatches.map((m) => {
      const note = m.presence === "confirmed" ? "Required recipe ingredient" : "Possible / optional ingredient";
      return `Allergy concern: "${m.allergy}" matched "${m.ingredient}" (${note})`;
    });

    return {
      ...v,
      allergyConflicts: allergyMatches,
      patientSpecificConcerns: concerns,
    };
  });

  return {
    ...variantData,
    variants: enrichedList,
  };
}

async function runFoodAgents({
  gemini,
  db,
  userId,
  patient,
  personalization,
  learning,
  foodAnalysis,
}) {
  const agentErrors = {};

  const [contextResult, variantResult] = await Promise.allSettled([
    runPersonalContextAgent({
      gemini,
      db,
      userId,
      patient,
      personalization,
      learning,
      foodAnalysis,
    }),
    runVariantAgent({ gemini, foodAnalysis, db }),
  ]);

  const personalContext =
    contextResult.status === "fulfilled" ? contextResult.value : null;
  let variantData =
    variantResult.status === "fulfilled" ? variantResult.value : null;

  if (contextResult.status === "rejected") {
    agentErrors.personalContextAgent = String(
      contextResult.reason?.message || contextResult.reason
    );
    console.error("Personal Context Agent failed:", contextResult.reason);
  }
  if (variantResult.status === "rejected") {
    agentErrors.variantAgent = String(
      variantResult.reason?.message || variantResult.reason
    );
    console.error("Variant Agent failed:", variantResult.reason);
  }

  // Enrich variants with per-variant patient evidence
  if (variantData) {
    try {
      variantData = await enrichVariantsWithPatientEvidence({
        db,
        userId,
        patient,
        variantData,
      });
    } catch (enrichErr) {
      console.error("Variant enrichment error:", enrichErr);
    }
  }

  const variants = variantData?.variants || (Array.isArray(variantData) ? variantData : null);

  let verdict = null;
  try {
    verdict = await runVerdictAgent({
      gemini,
      patient,
      foodAnalysis,
      personalContext,
      variants: variantData,
    });
  } catch (error) {
    agentErrors.verdictAgent = String(error?.message || error);
    console.error("Verdict Agent failed:", error);
  }

  // Build knowledge retrieval summary for API response
  const knowledge = variantData
    ? {
        retrievalStatus: variantData.retrievalStatus || "not_available",
        retrievalSources: variantData.retrievalSources || [],
        dataSource: variantData.dataSource || "ai_generated",
        canonicalFood: variantData.canonicalFood || foodAnalysis.foodName,
      }
    : null;

  return {
    personalContext,
    variants: Array.isArray(variants) ? variants : null,
    verdict,
    knowledge,
    agentErrors,
  };
}

module.exports = { runFoodAgents, enrichVariantsWithPatientEvidence };