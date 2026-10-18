// Reusable Food and Ingredient Normalization Utilities
//
// Ensures consistent keys across:
// - Food recognition writes
// - Food ingredients table
// - Food history queries
// - Shared food-knowledge catalog and alias resolution
// - Jaccard ingredient similarity matching

/**
 * Normalizes text: trims, lowercases, strips diacritics, and collapses whitespace.
 */
function cleanText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Normalizes food names. Handles known dish aliases while preserving distinction
 * between genuinely different dishes.
 */
const FOOD_ALIASES = new Map([
  ["chhole bhature", "chole bhature"],
  ["chole bhatura", "chole bhature"],
  ["chana bhatura", "chole bhature"],
  ["khaman", "dhokla"],
  ["khaman dhokla", "dhokla"],
  ["rava dhokla", "dhokla"],
  ["sooji dhokla", "dhokla"],
  ["suji dhokla", "dhokla"],
  ["nylon dhokla", "dhokla"],
  ["white dhokla", "dhokla"],
  ["khatta dhokla", "dhokla"],
  ["kulche chole", "chole bhature"],
  ["pizza margherita", "margherita pizza"],
]);

function normalizeFoodName(name) {
  const base = cleanText(name);
  if (!base) return "";
  return FOOD_ALIASES.get(base) || base;
}

/**
 * Known ingredient synonyms.
 * CRITICAL: Never equate distinct ingredients (e.g., maida vs whole wheat flour,
 * mustard oil vs peanut oil). Only equate true linguistic synonyms.
 */
const INGREDIENT_SYNONYMS = new Map([
  ["all purpose flour", "maida"],
  ["all-purpose flour", "maida"],
  ["refined wheat flour", "maida"],
  ["refined flour", "maida"],
  ["gram flour", "besan"],
  ["chickpea flour", "besan"],
  ["bengal gram flour", "besan"],
  ["semolina", "rava"],
  ["sooji", "rava"],
  ["coriander leaves", "cilantro"],
  ["fresh coriander leaves", "cilantro"],
  ["fresh coriander leaf", "cilantro"],
  ["coriander leaf", "cilantro"],
  ["fresh coriander", "cilantro"],
  ["fresh cilantro", "cilantro"],
  ["dhaniya", "cilantro"],
  ["garbanzo bean", "chickpea"],
  ["garbanzo beans", "chickpea"],
  ["chana", "chickpea"],
  ["kabuli chana", "chickpea"],
  ["curd", "yogurt"],
  ["yoghurt", "yogurt"],
  ["dahi", "yogurt"],
  ["capsicum", "bell pepper"],
  ["green capsicum", "green bell pepper"],
  ["spring onion", "scallion"],
  ["green onion", "scallion"],
  ["aubergine", "eggplant"],
  ["brinjal", "eggplant"],
  ["groundnut oil", "peanut oil"],
]);

/**
 * Safe plural / suffix reduction for ingredients.
 */
function singularizeIngredient(text) {
  let s = text;
  // Common irregular / specific culinary plurals
  s = s.replace(/\btomatoes\b/g, "tomato");
  s = s.replace(/\bpotatoes\b/g, "potato");
  s = s.replace(/\bchillies\b/g, "chili");
  s = s.replace(/\bchilies\b/g, "chili");
  s = s.replace(/\bchiles\b/g, "chili");
  s = s.replace(/\bleaves\b/g, "leaf");
  s = s.replace(/\bseeds\b/g, "seed");
  s = s.replace(/\bcloves\b/g, "clove");
  s = s.replace(/\bberries\b/g, "berry");
  s = s.replace(/\bbeans\b/g, "bean");
  s = s.replace(/\blentils\b/g, "lentil");
  s = s.replace(/\bpeppers\b/g, "pepper");
  s = s.replace(/\bonions\b/g, "onion");
  s = s.replace(/\bherbs\b/g, "herb");
  s = s.replace(/\bspices\b/g, "spice");
  s = s.replace(/\bchickpeas\b/g, "chickpea");
  return s;
}

/**
 * Normalizes an ingredient name into a canonical search key.
 *
 * Examples:
 *   "Besan (gram flour)" -> "besan"
 *   "Mustard seeds" -> "mustard seed"
 *   "Maida (all-purpose flour)" -> "maida"
 *   "Fresh Coriander Leaves" -> "cilantro"
 *   "Curry leaves" -> "curry leaf"
 */
function normalizeIngredientKey(name) {
  let text = cleanText(name);
  if (!text) return "";

  // Check synonym before stripping parentheses in case the full text is a known synonym
  if (INGREDIENT_SYNONYMS.has(text)) {
    return INGREDIENT_SYNONYMS.get(text);
  }

  // Remove parenthetical notes e.g. " (gram flour)" or " (for tempering)"
  const withoutParens = cleanText(text.replace(/\([^)]*\)/g, ""));
  if (withoutParens && INGREDIENT_SYNONYMS.has(withoutParens)) {
    return INGREDIENT_SYNONYMS.get(withoutParens);
  }

  // Fallback to text inside parentheses if main text was generic
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = cleanText(parenMatch[1]);
    if (INGREDIENT_SYNONYMS.has(inside)) {
      return INGREDIENT_SYNONYMS.get(inside);
    }
  }

  let result = withoutParens || text;
  result = singularizeIngredient(result);
  result = result.replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, " ");

  if (INGREDIENT_SYNONYMS.has(result)) {
    return INGREDIENT_SYNONYMS.get(result);
  }

  return result;
}

/**
 * Clean user-facing ingredient name (title-cased, trimmed).
 */
function normalizeIngredientName(name) {
  const cleaned = cleanText(name);
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Jaccard similarity index: |A ∩ B| / |A ∪ B|.
 * Returns a float between 0.0 and 1.0.
 */
function jaccardSimilarity(setA, setB) {
  if (!setA || !setB) return 0;
  const a = setA instanceof Set ? setA : new Set(setA);
  const b = setB instanceof Set ? setB : new Set(setB);

  if (a.size === 0 && b.size === 0) return 0;

  let intersectionCount = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersectionCount += 1;
    }
  }

  const unionSize = a.size + b.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

/**
 * Idempotent migration helper: backfills normalized ingredient_key in food_ingredients table.
 */
async function backfillIngredientKeys(db, { dryRun = false } = {}) {
  const [rows] = await db.query(
    "SELECT id, ingredient_name, ingredient_key FROM food_ingredients"
  );

  let updatedCount = 0;
  for (const row of rows) {
    const expectedKey = normalizeIngredientKey(row.ingredient_name);
    if (expectedKey && expectedKey !== row.ingredient_key) {
      if (!dryRun) {
        await db.query(
          "UPDATE food_ingredients SET ingredient_key = ? WHERE id = ?",
          [expectedKey, row.id]
        );
      }
      updatedCount += 1;
    }
  }

  return { totalChecked: rows.length, updatedCount, dryRun };
}

module.exports = {
  cleanText,
  normalizeFoodName,
  normalizeIngredientKey,
  normalizeIngredientName,
  jaccardSimilarity,
  backfillIngredientKeys,
  FOOD_ALIASES,
  INGREDIENT_SYNONYMS,
};
