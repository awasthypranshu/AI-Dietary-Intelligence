// Runs the three agents:
//
//   Agent 1 (Personal Context, agentic RAG) ─┐
//                                            ├─> Agent 3 (Verdict)
//   Agent 2 (Variants) ──────────────────────┘
//
// Agents 1 and 2 are independent, so they run in parallel. Agent 3 needs
// both, but still runs with whatever succeeded if one of them fails.

const { runPersonalContextAgent } = require("./personalContextAgent");
const { runVariantAgent } = require("./variantAgent");
const { runVerdictAgent } = require("./verdictAgent");

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
    runVariantAgent({ gemini, foodAnalysis }),
  ]);

  const personalContext =
    contextResult.status === "fulfilled" ? contextResult.value : null;
  const variants =
    variantResult.status === "fulfilled" ? variantResult.value : null;

  if (contextResult.status === "rejected") {
    agentErrors.personalContextAgent = String(contextResult.reason?.message || contextResult.reason);
    console.error("Personal Context Agent failed:", contextResult.reason);
  }
  if (variantResult.status === "rejected") {
    agentErrors.variantAgent = String(variantResult.reason?.message || variantResult.reason);
    console.error("Variant Agent failed:", variantResult.reason);
  }

  let verdict = null;
  try {
    verdict = await runVerdictAgent({
      gemini,
      patient,
      foodAnalysis,
      personalContext,
      variants,
    });
  } catch (error) {
    agentErrors.verdictAgent = String(error?.message || error);
    console.error("Verdict Agent failed:", error);
  }

  return { personalContext, variants, verdict, agentErrors };
}

module.exports = { runFoodAgents };