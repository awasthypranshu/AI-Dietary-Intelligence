// Shared helpers for talking to Gemini and reading JSON back safely.

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash";

function getModelName() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

// Gemini sometimes wraps JSON in ```json fences or adds text around it.
// Returns a parsed object, or throws an Error with code AI_BAD_JSON.
function parseJsonFromText(text) {
  let cleaned = String(text || "").trim();

  if (!cleaned) {
    const error = new Error("Gemini returned an empty response.");
    error.code = "AI_BAD_JSON";
    throw error;
  }

  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (secondError) {
        // fall through
      }
    }

    const error = new Error(
      "Gemini returned malformed JSON."
    );
    error.code = "AI_BAD_JSON";
    throw error;
  }
}

// Ask Gemini for JSON. `validate(raw)` must return a cleaned object
// or throw. One automatic retry is made if the output is malformed
// or fails validation (the retry tells the model what went wrong).
async function generateValidatedJson({
  gemini,
  contents,
  validate,
  temperature = 0.2,
  retries = 1,
}) {
  let lastError = null;
  let currentContents = contents;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await gemini.models.generateContent({
      model: getModelName(),
      contents: currentContents,
      config: {
        responseMimeType: "application/json",
        temperature,
      },
    });

    try {
      const raw = parseJsonFromText(response.text);
      return validate(raw);
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const note = {
          text:
            "Your previous answer was rejected: " +
            error.message +
            " Return ONLY valid JSON that follows the required schema exactly.",
        };

        currentContents = Array.isArray(contents)
          ? [...contents, note]
          : [{ text: String(contents) }, note];
      }
    }
  }

  const error = new Error(
    "Gemini output could not be validated: " +
      (lastError ? lastError.message : "unknown error")
  );
  error.code = "AI_INVALID_OUTPUT";
  throw error;
}

module.exports = {
  getModelName,
  parseJsonFromText,
  generateValidatedJson,
};