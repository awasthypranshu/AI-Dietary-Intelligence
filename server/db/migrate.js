// Safe, repeatable database migration for the Gemini food-intelligence upgrade.
//
// Run from the server folder:   npm run migrate
//
// It only ADDS things (columns / tables) and skips anything that already
// exists, so it is safe to run more than once. It never deletes data.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const pool = require("./connection");

const FOOD_IMAGE_COLUMNS = [
  ["original_name", "VARCHAR(255) NULL"],
  ["uploaded_at", "DATETIME NULL"],
  ["cuisine", "VARCHAR(100) NULL"],
  ["food_style", "VARCHAR(150) NULL"],
  ["food_confidence", "TINYINT UNSIGNED NULL"],
  ["style_confidence", "TINYINT UNSIGNED NULL"],
  ["visible_ingredients", "JSON NULL"],
  ["suspected_ingredients", "JSON NULL"],
  ["traditional_ingredients", "JSON NULL"],
  ["estimated_serving", "JSON NULL"],
  ["nutrition_estimate", "JSON NULL"],
  ["limitations", "JSON NULL"],
  ["analysis_json", "JSON NULL"],
  ["analysis_model", "VARCHAR(100) NULL"],
  ["analyzed_at", "DATETIME NULL"],
];

// Columns the existing backend code already reads/writes but that the old
// schema.sql never created. Real databases usually have them already (then
// they are skipped); a database built fresh from schema.sql does not, and
// login/profile/report features would fail without them.
const LEGACY_COLUMNS = {
  users: [["last_login_at", "DATETIME NULL"]],
  sessions: [["remember_me", "TINYINT(1) NOT NULL DEFAULT 0"]],
  patients: [
    ["medical_report_id", "VARCHAR(64) NULL"],
    ["medical_report_analyzed", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["medical_report_updated_at", "DATETIME NULL"],
    ["medical_report_data", "JSON NULL"],
  ],
  digital_twins: [
    ["patient_name", "VARCHAR(255) NULL"],
    ["medical_report_analyzed", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["medical_report_updated_at", "DATETIME NULL"],
    ["medical_report_data", "JSON NULL"],
  ],
  food_genomes: [
    ["patient_name", "VARCHAR(255) NULL"],
    ["last_feedback", "JSON NULL"],
    ["last_meal_plan_feedback", "JSON NULL"],
  ],
  food_history: [
    ["patient_name", "VARCHAR(255) NULL"],
    ["reaction", "TEXT NULL"],
    ["notes", "TEXT NULL"],
    ["recorded_at", "DATETIME NULL"],
  ],
  meal_plans: [
    ["patient_name", "VARCHAR(255) NULL"],
    ["feedback_history", "JSON NULL"],
  ],
  medical_reports: [
    ["patient_name", "VARCHAR(255) NULL"],
    ["original_name", "VARCHAR(255) NULL"],
    ["file_path", "TEXT NULL"],
    ["uploaded_at", "DATETIME NULL"],
    ["extracted_data", "JSON NULL"],
    ["ai_analyzed", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["ai_analyzed_at", "DATETIME NULL"],
  ],
  food_agent_reports: [
    ["knowledge_json", "JSON NULL"],
  ],
  food_knowledge_aliases: [
    ["canonical_name_key", "VARCHAR(150) NULL"],
  ],
};

const NEW_TABLES = [
  `
  CREATE TABLE IF NOT EXISTS food_ingredients (
    id VARCHAR(64) PRIMARY KEY,
    food_image_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    ingredient_name VARCHAR(150) NOT NULL,
    ingredient_key VARCHAR(150) NOT NULL,
    category VARCHAR(20) NOT NULL,
    confidence TINYINT UNSIGNED NULL,
    role VARCHAR(150) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_image_id) REFERENCES food_images(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_food_ingredients_image (food_image_id),
    INDEX idx_food_ingredients_user_key (user_id, ingredient_key)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_agent_reports (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    food_image_id VARCHAR(64) NOT NULL,
    verdict VARCHAR(30) NULL,
    verdict_json JSON NULL,
    personal_context_json JSON NULL,
    variants_json JSON NULL,
    knowledge_json JSON NULL,
    agent_errors JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (food_image_id) REFERENCES food_images(id) ON DELETE CASCADE,
    INDEX idx_food_agent_reports_user (user_id),
    INDEX idx_food_agent_reports_image (food_image_id)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_sources (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    publisher VARCHAR(255) NULL,
    url TEXT NULL,
    source_type VARCHAR(50) NOT NULL,
    publication_date VARCHAR(50) NULL,
    access_date VARCHAR(50) NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_variants (
    id VARCHAR(64) PRIMARY KEY,
    canonical_name VARCHAR(150) NOT NULL,
    canonical_name_key VARCHAR(150) NOT NULL,
    variant_name VARCHAR(150) NOT NULL,
    variant_name_key VARCHAR(150) NOT NULL,
    region_or_style VARCHAR(150) NULL,
    preparation_method VARCHAR(100) NULL,
    description TEXT NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    source_id VARCHAR(64) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_food_variants_canonical (canonical_name_key),
    INDEX idx_food_variants_variant (variant_name_key),
    INDEX idx_food_variants_source (source_id),
    UNIQUE KEY uq_food_variant (canonical_name_key, variant_name_key)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_variant_ingredients (
    id VARCHAR(64) PRIMARY KEY,
    variant_id VARCHAR(64) NOT NULL,
    ingredient_name VARCHAR(150) NOT NULL,
    ingredient_key VARCHAR(150) NOT NULL,
    role VARCHAR(100) NULL,
    presence_type VARCHAR(50) NOT NULL,
    source_id VARCHAR(64) NULL,
    notes TEXT NULL,
    confidence INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variant_id) REFERENCES food_variants(id) ON DELETE CASCADE,
    INDEX idx_variant_ingredients_variant (variant_id),
    INDEX idx_variant_ingredients_key (ingredient_key),
    INDEX idx_variant_ingredients_source (source_id),
    UNIQUE KEY uq_variant_ingredient (variant_id, ingredient_key, presence_type)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_knowledge (
    id VARCHAR(64) PRIMARY KEY,
    canonical_name VARCHAR(255) NOT NULL,
    canonical_name_key VARCHAR(255) NOT NULL,
    variant_name VARCHAR(255) NOT NULL,
    variant_name_key VARCHAR(255) NOT NULL,
    region_or_style VARCHAR(200) NULL,
    description TEXT NULL,
    ingredients_json JSON NULL,
    sources_json JSON NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 0,
    is_fixture TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_food_knowledge_canonical (canonical_name_key),
    INDEX idx_food_knowledge_variant (variant_name_key),
    UNIQUE KEY uq_food_knowledge_entry (canonical_name_key, variant_name_key)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS food_knowledge_aliases (
    id VARCHAR(64) PRIMARY KEY,
    food_knowledge_id VARCHAR(64) NOT NULL,
    canonical_name_key VARCHAR(150) NULL,
    alias_key VARCHAR(255) NOT NULL,
    alias_name VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_knowledge_id) REFERENCES food_knowledge(id) ON DELETE CASCADE,
    INDEX idx_food_knowledge_aliases_key (alias_key),
    INDEX idx_food_knowledge_aliases_canonical (canonical_name_key),
    UNIQUE KEY uq_food_knowledge_alias (food_knowledge_id, alias_key)
  )
  `,
];

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].total > 0;
}

async function migrate() {
  const added = [];
  const skipped = [];

  for (const [column, definition] of FOOD_IMAGE_COLUMNS) {
    if (await columnExists("food_images", column)) {
      skipped.push(column);
      continue;
    }
    await pool.query(
      `ALTER TABLE food_images ADD COLUMN ${column} ${definition}`
    );
    added.push(column);
  }

  const legacyAdded = [];
  for (const [table, columns] of Object.entries(LEGACY_COLUMNS)) {
    for (const [column, definition] of columns) {
      if (await columnExists(table, column)) continue;
      await pool.query(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
      );
      legacyAdded.push(`${table}.${column}`);
    }
  }

  for (const sql of NEW_TABLES) {
    await pool.query(sql);
  }

  return { added, skipped, legacyAdded };
}

if (require.main === module) {
  migrate()
    .then(({ added, skipped, legacyAdded }) => {
      console.log("Migration finished.");
      console.log("Columns added to food_images:", added.length ? added.join(", ") : "none");
      console.log("Columns already present:", skipped.length ? skipped.join(", ") : "none");
      console.log("Older columns the code needed (added if missing):", legacyAdded.length ? legacyAdded.join(", ") : "none");
      console.log("Tables ensured: food_ingredients, food_agent_reports");
      return pool.end();
    })
    .catch(async (error) => {
      console.error("Migration failed:", error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrate };