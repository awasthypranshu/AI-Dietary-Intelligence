// AGENT 1 - Personal Context Agent (the "agentic RAG" agent)
//
// It does NOT decide good/bad. Its job is to gather evidence about THIS
// user. It decides for itself which retrieval tools to call (profile,
// medical report/prescription, food history, similar foods by ingredient,
// Food Genome, Digital Twin), reads the results, and then writes a
// structured evidence report for the Verdict Agent.

const { generateValidatedJson, getModelName } = require("../geminiJson");
const { cleanString, cleanConfidence } = require("../foodAnalysisValidator");
const { createRetrievalTools, TOOL_DECLARATIONS } = require("./retrievalTools");

const MAX_TOOL_STEPS = 6;

function describeFood(foodAnalysis) {
  const names = (list) => list.map((item) => item.name).join(", ") || "none";
  return [
    `Food: ${foodAnalysis.foodName}`,
    `Style: ${foodAnalysis.foodStyle || "unknown"}`,
    `Visible ingredients: ${names(foodAnalysis.ingredients.visible)}`,
    `Suspected ingredients: ${names(foodAnalysis.ingredients.suspected)}`,
    `Traditional ingredients: ${names(foodAnalysis.ingredients.traditional)}`,
    `Estimated nutrition (estimate only): ${JSON.stringify(
      foodAnalysis.nutritionEstimate
    )}`,
  ].join("\n");
}

function list(value, max = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, 300))
    .filter(Boolean)
    .slice(0, max);
}

function objects(value, shape, max = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const out = {};
      for (const key of shape) {
        out[key] = cleanString(item?.[key], 300);
      }
      return out;
    })
    .filter((item) => Object.values(item).some(Boolean))
    .slice(0, max);
}

function validatePersonalContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const error = new Error("Personal context must be a JSON object.");
    error.code = "AI_INVALID_OUTPUT";
    throw error;
  }

  return {
    evidenceSummary: cleanString(raw.evidence_summary, 800),
    relevantConditions: objects(raw.relevant_conditions, ["condition", "why_relevant"]),
    allergyConflicts: objects(raw.allergy_conflicts, ["allergen", "ingredient", "note"]),
    medicationOrReportNotes: list(raw.medication_or_report_notes),
    pastReactionsToThisFood: objects(raw.past_reactions_to_this_food, ["reaction", "note"]),
    similarFoodEvidence: objects(raw.similar_food_evidence, ["food", "shared_ingredients", "past_reaction"]),
    ingredientsOfConcern: objects(raw.ingredients_of_concern, ["ingredient", "reason", "source"]),
    missingInformation: list(raw.missing_information),
    evidenceConfidence: cleanConfidence(raw.evidence_confidence),
  };
}

async function runPersonalContextAgent({
  gemini,
  db,
  userId,
  patient,
  personalization,
  learning,
  foodAnalysis,
}) {
  const tools = createRetrievalTools({
    db,
    userId,
    patient,
    personalization,
    learning,
    foodAnalysis,
  });

  const toolTrace = [];

  const instruction = `
You are the Personal Context Agent in a dietary-intelligence system.
Collect evidence about whether this food could matter for THIS patient.
Use the tools to look at the patient's profile, medical report /
prescription, food history, similar foods by ingredient, Food Genome and
Digital Twin. Call every tool that could help (at least the profile,
the medical report and the food history). Do not guess: only report what
the tools return. When you have enough evidence, reply with a short plain
text list of your findings. You are NOT making the final decision.

FOOD BEING ANALYZED
${describeFood(foodAnalysis)}
`;

  const contents = [{ role: "user", parts: [{ text: instruction }] }];
  let finalNotes = "";

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const response = await gemini.models.generateContent({
      model: getModelName(),
      contents,
      config: {
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: 0.1,
      },
    });

    const calls = response.functionCalls || [];

    if (calls.length === 0) {
      finalNotes = response.text || "";
      break;
    }

    contents.push({
      role: "model",
      parts: calls.map((call) => ({ functionCall: call })),
    });

    const responseParts = [];

    for (const call of calls) {
      let result;
      const handler = tools[call.name];

      if (!handler) {
        result = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          result = await handler(call.args || {});
        } catch (error) {
          result = { error: "Tool failed: " + error.message };
        }
      }

      toolTrace.push({ tool: call.name, args: call.args || {} });
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      });
    }

    contents.push({ role: "user", parts: responseParts });
  }

  // Phase 2: turn everything gathered into a validated JSON report.
  const evidenceText = contents
    .map((entry) =>
      entry.parts
        .map((part) => {
          if (part.text) return part.text;
          if (part.functionCall)
            return `TOOL CALL: ${part.functionCall.name} ${JSON.stringify(part.functionCall.args || {})}`;
          if (part.functionResponse)
            return `TOOL RESULT (${part.functionResponse.name}): ${JSON.stringify(part.functionResponse.response)}`;
          return "";
        })
        .join("\n")
    )
    .join("\n\n");

  const report = await generateValidatedJson({
    gemini,
    contents: [
      {
        text: `${evidenceText}

AGENT NOTES:
${finalNotes || "(none)"}

Using ONLY the tool results above, return one JSON object:
{
  "evidence_summary": "string",
  "relevant_conditions": [{"condition": "string", "why_relevant": "string"}],
  "allergy_conflicts": [{"allergen": "string", "ingredient": "string", "note": "string"}],
  "medication_or_report_notes": ["string"],
  "past_reactions_to_this_food": [{"reaction": "string", "note": "string"}],
  "similar_food_evidence": [{"food": "string", "shared_ingredients": "string", "past_reaction": "string"}],
  "ingredients_of_concern": [{"ingredient": "string", "reason": "string", "source": "profile | medical_report | history | genome | general"}],
  "missing_information": ["string"],
  "evidence_confidence": 0
}
Rules: never invent history or lab values that are not in the tool results.
Use empty lists when nothing was found. Lower evidence_confidence when data is thin.`,
      },
    ],
    validate: validatePersonalContext,
    temperature: 0.1,
  });

  return { ...report, toolsUsed: toolTrace };
}

module.exports = {
  runPersonalContextAgent,
  validatePersonalContext,
  MAX_TOOL_STEPS,
};