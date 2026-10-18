// CLI script to safely and idempotently backfill/reindex ingredient_key
// in the food_ingredients table using the updated normalization rules.
//
// Usage:
//   node ai/reindexIngredients.js             # Apply updates
//   node ai/reindexIngredients.js --dry-run   # Preview updates without writing

const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
} catch (_e) {}

const pool = require("../db/connection");
const { backfillIngredientKeys } = require("./normalization");

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`Starting ingredient key reindexing (dryRun=${isDryRun})...`);

  try {
    const stats = await backfillIngredientKeys(pool, { dryRun: isDryRun });
    console.log("Reindexing completed:", stats);
  } catch (err) {
    console.error("Reindexing failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
