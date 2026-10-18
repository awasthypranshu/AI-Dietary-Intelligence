// Food Knowledge Retriever
//
// Queries the food_knowledge table for documented food variants,
// ingredients (with provenance), and aliases. All queries are pure
// database reads — no AI generation.
//
// Design:
// - Normalized name matching (lowercase, trimmed, diacritics stripped).
// - Alias resolution (e.g. "chole bhature" -> "chhole bhature").
// - Multiple variants per food (e.g. Punjabi dhokla, Khaman dhokla).
// - Per-ingredient provenance: source, classification
//   (required / typical / optional / regional / substitution).
// - Clear empty-KB vs no-match distinction.

const { parseJsonValue } = require("../jsonUtils");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ");
}

function ingredientsFromJson(json) {
  const raw = parseJsonValue(json, []);
  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    if (typeof item === "string") {
      return {
        name: item,
        classification: "typical",
        presenceType: "typical",
        confidence: null,
        source: null,
        notes: null,
      };
    }
    const classification = item.presence_type || item.classification || "typical";
    return {
      name: String(item.name || ""),
      classification: String(classification),
      presenceType: String(classification),
      confidence: item.confidence != null ? Number(item.confidence) : null,
      source: item.source || null,
      notes: item.notes || null,
    };
  }).filter((i) => i.name);
}

// ---------------------------------------------------------------------------
// Main retriever
// ---------------------------------------------------------------------------

/**
 * Look up a food by name in the knowledge base.
 *
 * Returns:
 *   { status, food, variants, sources }
 *
 * status is one of:
 *   "found"       – exact or alias match with at least one variant
 *   "no_match"    – the KB has data but nothing matches this food
 *   "empty_kb"    – the food_knowledge table has zero rows
 */
async function retrieveFoodKnowledge(db, foodName) {
  const key = normalize(foodName);

  if (!key) {
    return { status: "no_match", food: null, variants: [], sources: [] };
  }

  // Check whether the KB has any rows at all.
  const [countRows] = await db.query(
    "SELECT COUNT(*) AS total FROM food_knowledge"
  );
  const kbTotal = countRows[0].total;
  if (kbTotal === 0) {
    return { status: "empty_kb", food: null, variants: [], sources: [] };
  }

  // Try exact canonical-name match first.
  let [rows] = await db.query(
    `SELECT * FROM food_knowledge
      WHERE canonical_name_key = ?
      ORDER BY variant_name`,
    [key]
  );

  // Try alias match if no exact hit.
  if (rows.length === 0) {
    const [aliasRows] = await db.query(
      `SELECT fk.canonical_name_key FROM food_knowledge fk
        JOIN food_knowledge_aliases fka ON fka.food_knowledge_id = fk.id
       WHERE fka.alias_key = ?
       LIMIT 1`,
      [key]
    );

    if (aliasRows.length > 0) {
      [rows] = await db.query(
        `SELECT * FROM food_knowledge
          WHERE canonical_name_key = ?
          ORDER BY variant_name`,
        [aliasRows[0].canonical_name_key]
      );
    }
  }

  // Try substring / partial match.
  if (rows.length === 0) {
    const likeKey = `%${key}%`;
    const [matchRows] = await db.query(
      `SELECT canonical_name_key FROM food_knowledge
        WHERE canonical_name_key LIKE ?
           OR variant_name_key LIKE ?
        LIMIT 1`,
      [likeKey, likeKey]
    );

    if (matchRows.length > 0) {
      [rows] = await db.query(
        `SELECT * FROM food_knowledge
          WHERE canonical_name_key = ?
          ORDER BY variant_name`,
        [matchRows[0].canonical_name_key]
      );
    }
  }

  if (rows.length === 0) {
    return { status: "no_match", food: foodName, variants: [], sources: [] };
  }

  const canonicalName = rows[0].canonical_name;
  const sources = new Set();
  const variants = [];

  for (const row of rows) {
    const rowSources = parseJsonValue(row.sources_json, []);
    const defaultSource = Array.isArray(rowSources) && rowSources.length > 0
      ? (typeof rowSources[0] === "string" ? rowSources[0] : rowSources[0].title || rowSources[0].url)
      : null;

    const ingredients = ingredientsFromJson(row.ingredients_json).map((ing) => ({
      ...ing,
      source: ing.source || defaultSource,
    }));

    if (Array.isArray(rowSources)) {
      rowSources.forEach((s) => {
        if (typeof s === "string" && s) sources.add(s);
        else if (s && (s.title || s.name)) sources.add(s.title || s.name);
      });
    }

    variants.push({
      id: row.id,
      canonicalName: row.canonical_name,
      variantName: row.variant_name,
      regionOrStyle: row.region_or_style || null,
      description: row.description || null,
      ingredients,
      sources: Array.isArray(rowSources) ? rowSources : [],
      isVerified: Boolean(row.is_verified),
      isFixture: Boolean(row.is_fixture),
    });
  }

  return {
    status: "found",
    food: canonicalName,
    variants,
    sources: [...sources],
  };
}

module.exports = { retrieveFoodKnowledge, normalize, ingredientsFromJson };
