// Small JSON helper used by the AI modules (MySQL JSON columns may
// come back as strings or already-parsed objects).
function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

module.exports = { parseJsonValue };