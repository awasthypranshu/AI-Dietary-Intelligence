// Dedicated Food-Variant Retriever
//
// Retrieves source-backed food variants and their documented ingredients from
// the shared knowledge catalog.
//
// Design:
// - Deterministic SQL reads; no model hallucinations.
// - Canonical resolution via normalized keys and verified aliases.
// - Full ingredient-level provenance with presence types:
//     "required"     - Mandatory in documented recipe (confirmed allergen presence)
//     "typical"      - Standard in traditional recipe (confirmed allergen presence)
//     "optional"     - User/cook preference (possible allergen presence)
//     "regional"     - Region-specific adaptation (possible allergen presence)
//     "substitution" - Dietary substitute (e.g. whole-wheat, low-fat)
// - Includes complete source citations (title, publisher, URL, type).
// - Transparently supports relational catalog tables (food_variants, food_variant_ingredients,
//   food_sources) as well as the food_knowledge table.

const { normalizeFoodName, normalizeIngredientKey, cleanText } = require("../normalization");
const { parseJsonValue } = require("../jsonUtils");

/**
 * Normalizes presence classification to one of the standardized values.
 */
function standardizePresenceType(val) {
  const s = String(val || "").toLowerCase().trim();
  if (["required", "typical", "optional", "regional", "substitution"].includes(s)) {
    return s;
  }
  return "typical";
}

/**
 * Retrieve verified food variants from the catalog.
 *
 * @param {object} db - Database connection/pool
 * @param {string} foodName - Dish name detected from the image
 * @param {object} context - Optional context (cuisine, foodStyle) for ranking
 * @returns {Promise<{ status: string, canonicalFood: string|null, variants: Array, sources: Array }>}
 */
async function retrieveVariantsFromCatalog(db, foodName, context = {}) {
  const normalizedInput = cleanText(foodName);
  const canonicalKey = normalizeFoodName(foodName);

  if (!db || !canonicalKey) {
    return { status: "no_match", canonicalFood: null, variants: [], sources: [] };
  }

  // 1. Check if the database has any food variants at all
  let hasVariantsTable = true;
  let totalCount = 0;

  try {
    const [countRows] = await db.query(
      "SELECT COUNT(*) AS total FROM food_variants WHERE is_active = 1"
    );
    totalCount = countRows[0]?.total ?? 0;
  } catch (_e) {
    hasVariantsTable = false;
  }

  // If food_variants is not available or empty, check legacy food_knowledge
  if (!hasVariantsTable || totalCount === 0) {
    try {
      const [legacyCount] = await db.query(
        "SELECT COUNT(*) AS total FROM food_knowledge"
      );
      if ((legacyCount[0]?.total ?? 0) === 0) {
        return { status: "empty_kb", canonicalFood: null, variants: [], sources: [] };
      }
      return retrieveFromLegacyTable(db, foodName);
    } catch (_e) {
      return { status: "empty_kb", canonicalFood: null, variants: [], sources: [] };
    }
  }

  // 2. Resolve to canonical_name_key
  // Priority: (a) exact canonical_name_key match, (b) alias match, (c) variant_name_key match
  let targetCanonicalKey = null;

  // Exact canonical match
  const [exactMatch] = await db.query(
    `SELECT canonical_name_key FROM food_variants
      WHERE canonical_name_key = ? AND is_active = 1
      LIMIT 1`,
    [canonicalKey]
  );

  if (exactMatch.length > 0) {
    targetCanonicalKey = exactMatch[0].canonical_name_key;
  } else {
    // Try alias resolution
    try {
      const [aliasMatch] = await db.query(
        `SELECT fka.canonical_name_key, fk.canonical_name_key AS fk_canonical_key
           FROM food_knowledge_aliases fka
           LEFT JOIN food_knowledge fk ON fk.id = fka.food_knowledge_id
          WHERE fka.alias_key = ?
          LIMIT 1`,
        [normalizedInput]
      );
      if (aliasMatch.length > 0) {
        targetCanonicalKey = aliasMatch[0].canonical_name_key || aliasMatch[0].fk_canonical_key;
      }
    } catch (_e) {
      try {
        const [aliasMatch] = await db.query(
          `SELECT canonical_name_key FROM food_knowledge_aliases
            WHERE alias_key = ?
            LIMIT 1`,
          [normalizedInput]
        );
        if (aliasMatch.length > 0) {
          targetCanonicalKey = aliasMatch[0].canonical_name_key;
        }
      } catch (_e2) {}
    }
  }

  // Try substring / variant name match if still not found
  if (!targetCanonicalKey) {
    const likeKey = `%${canonicalKey}%`;
    const [likeMatch] = await db.query(
      `SELECT canonical_name_key FROM food_variants
        WHERE (canonical_name_key LIKE ? OR variant_name_key LIKE ?)
          AND is_active = 1
        LIMIT 1`,
      [likeKey, likeKey]
    );
    if (likeMatch.length > 0) {
      targetCanonicalKey = likeMatch[0].canonical_name_key;
    }
  }

  if (!targetCanonicalKey) {
    return { status: "no_match", canonicalFood: foodName, variants: [], sources: [] };
  }

  // 3. Retrieve all active variants for this canonical food
  const [variantRows] = await db.query(
    `SELECT v.*, s.title AS source_title, s.publisher AS source_publisher,
            s.url AS source_url, s.source_type, s.publication_date
       FROM food_variants v
       LEFT JOIN food_sources s ON s.id = v.source_id
      WHERE v.canonical_name_key = ?
        AND v.is_active = 1
      ORDER BY v.variant_name ASC`,
    [targetCanonicalKey]
  );

  if (variantRows.length === 0) {
    return { status: "no_match", canonicalFood: foodName, variants: [], sources: [] };
  }

  const canonicalName = variantRows[0].canonical_name;
  const variantIds = variantRows.map((r) => r.id);

  // 4. Retrieve ingredients for all matching variants
  let ingredientRows = [];
  try {
    const [rows] = await db.query(
      `SELECT vi.*, s.title AS ingredient_source_title, s.url AS ingredient_source_url
         FROM food_variant_ingredients vi
         LEFT JOIN food_sources s ON s.id = vi.source_id
        WHERE vi.variant_id IN (?)
        ORDER BY vi.variant_id, vi.role, vi.ingredient_name`,
      [variantIds]
    );
    ingredientRows = rows;
  } catch (_e) {}

  const ingredientsByVariant = new Map();
  for (const row of ingredientRows) {
    if (!ingredientsByVariant.has(row.variant_id)) {
      ingredientsByVariant.set(row.variant_id, []);
    }
    ingredientsByVariant.get(row.variant_id).push({
      name: row.ingredient_name,
      key: row.ingredient_key || normalizeIngredientKey(row.ingredient_name),
      role: row.role || "ingredient",
      presenceType: standardizePresenceType(row.presence_type),
      source: row.ingredient_source_title || null,
      sourceUrl: row.ingredient_source_url || null,
      notes: row.notes || null,
      confidence: row.confidence ?? null,
    });
  }

  const sourcesMap = new Map();
  const variants = [];

  for (const row of variantRows) {
    const vSources = [];
    if (row.source_id && row.source_title) {
      const src = {
        id: row.source_id,
        title: row.source_title,
        publisher: row.source_publisher || null,
        url: row.source_url || null,
        sourceType: row.source_type || "culinary_literature",
      };
      vSources.push(src);
      sourcesMap.set(row.source_id, src);
    }

    const ingredients = ingredientsByVariant.get(row.id) || [];

    // Also collect any source cited on ingredients
    for (const ing of ingredients) {
      if (ing.source && !sourcesMap.has(ing.source)) {
        sourcesMap.set(ing.source, {
          title: ing.source,
          url: ing.sourceUrl,
          sourceType: "recipe_documentation",
        });
      }
    }

    variants.push({
      id: row.id,
      canonicalName: row.canonical_name,
      variantName: row.variant_name,
      regionOrStyle: row.region_or_style || null,
      preparationMethod: row.preparation_method || null,
      description: row.description || null,
      documentedIngredients: ingredients,
      sources: vSources,
      isVerified: Boolean(row.is_verified),
      isFixture: false,
      dataSource: "knowledge_base",
    });
  }

  // Rank variants: prioritize variants matching style or cuisine from image analysis
  const styleKeywords = [context.foodStyle, context.cuisine]
    .map(cleanText)
    .filter(Boolean);

  if (styleKeywords.length > 0) {
    variants.sort((a, b) => {
      const aText = cleanText(`${a.variantName} ${a.regionOrStyle} ${a.description}`);
      const bText = cleanText(`${b.variantName} ${b.regionOrStyle} ${b.description}`);
      const aMatches = styleKeywords.filter((k) => aText.includes(k)).length;
      const bMatches = styleKeywords.filter((k) => bText.includes(k)).length;
      return bMatches - aMatches;
    });
  }

  return {
    status: "found",
    canonicalFood: canonicalName,
    variants,
    sources: [...sourcesMap.values()],
  };
}

/**
 * Fallback to legacy `food_knowledge` table if relational tables haven't been populated.
 */
async function retrieveFromLegacyTable(db, foodName) {
  const { retrieveFoodKnowledge } = require("../agents/knowledgeRetriever");
  const result = await retrieveFoodKnowledge(db, foodName);

  if (result.status !== "found") {
    return {
      status: result.status,
      canonicalFood: result.food,
      variants: [],
      sources: [],
    };
  }

  const variants = result.variants.map((v) => ({
    id: v.id,
    canonicalName: v.canonicalName,
    variantName: v.variantName,
    regionOrStyle: v.regionOrStyle,
    preparationMethod: null,
    description: v.description,
    documentedIngredients: v.ingredients.map((i) => ({
      name: i.name,
      key: normalizeIngredientKey(i.name),
      role: i.notes || "ingredient",
      presenceType: standardizePresenceType(i.classification),
      source: i.source,
      notes: i.notes,
      confidence: i.confidence,
    })),
    sources: v.sources.map((s) => (typeof s === "string" ? { title: s, url: null } : s)),
    isVerified: Boolean(v.isVerified),
    isFixture: Boolean(v.isFixture),
    dataSource: "knowledge_base",
  }));

  return {
    status: "found",
    canonicalFood: result.food,
    variants,
    sources: result.sources.map((s) => ({ title: s, url: null })),
  };
}

module.exports = {
  retrieveVariantsFromCatalog,
  standardizePresenceType,
};
