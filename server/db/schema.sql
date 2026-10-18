CREATE DATABASE IF NOT EXISTS dietaryAI;

USE dietaryAI;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    reset_token_hash VARCHAR(255),
    reset_token_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_expires_at (expires_at),
    INDEX idx_sessions_user_id (user_id)
);

CREATE TABLE IF NOT EXISTS patients (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255),
    age INT,
    gender VARCHAR(100),
    height DECIMAL(6,2),
    weight DECIMAL(6,2),
    blood_pressure VARCHAR(100),
    blood_sugar VARCHAR(100),
    diseases JSON,
    allergies JSON,
    food_preferences JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_twins (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL UNIQUE,
    health_profile JSON,
    dietary_feedback JSON,
    feedback_count INT DEFAULT 0,
    last_dietary_feedback DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS food_genomes (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL UNIQUE,
    total_feedback INT DEFAULT 0,
    loved_foods JSON,
    liked_foods JSON,
    neutral_foods JSON,
    disliked_foods JSON,
    reactions JSON,
    foods JSON,
    meal_plan_feedback JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medical_reports (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    patient_id VARCHAR(64),
    file_name VARCHAR(255),
    file_type VARCHAR(100),
    conditions JSON,
    blood_pressure VARCHAR(100),
    blood_sugar VARCHAR(100),
    fasting_blood_sugar VARCHAR(100),
    post_meal_blood_sugar VARCHAR(100),
    hba1c VARCHAR(100),
    cholesterol VARCHAR(100),
    ldl VARCHAR(100),
    hdl VARCHAR(100),
    triglycerides VARCHAR(100),
    hemoglobin VARCHAR(100),
    thyroid_results JSON,
    kidney_findings JSON,
    liver_findings JSON,
    allergies JSON,
    dietary_restrictions JSON,
    medications JSON,
    other_relevant_findings JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    INDEX idx_medical_reports_user_id (user_id)
);

CREATE TABLE IF NOT EXISTS food_images (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    file_name VARCHAR(255),
    file_path TEXT,
    mime_type VARCHAR(100),
    food_name VARCHAR(255),
    recognition_score DECIMAL(8,5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    original_name VARCHAR(255) NULL,
    uploaded_at DATETIME NULL,
    cuisine VARCHAR(100) NULL,
    food_style VARCHAR(150) NULL,
    food_confidence TINYINT UNSIGNED NULL,
    style_confidence TINYINT UNSIGNED NULL,
    visible_ingredients JSON NULL,
    suspected_ingredients JSON NULL,
    traditional_ingredients JSON NULL,
    estimated_serving JSON NULL,
    nutrition_estimate JSON NULL,
    limitations JSON NULL,
    analysis_json JSON NULL,
    analysis_model VARCHAR(100) NULL,
    analyzed_at DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_food_images_user_id (user_id)
);

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
);

CREATE TABLE IF NOT EXISTS food_agent_reports (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    food_image_id VARCHAR(64) NOT NULL,
    verdict VARCHAR(30) NULL,
    verdict_json JSON NULL,
    personal_context_json JSON NULL,
    variants_json JSON NULL,
    agent_errors JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (food_image_id) REFERENCES food_images(id) ON DELETE CASCADE,
    INDEX idx_food_agent_reports_user (user_id),
    INDEX idx_food_agent_reports_image (food_image_id)
);

CREATE TABLE IF NOT EXISTS meal_plans (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    goal TEXT,
    context TEXT,
    customization TEXT,
    meal_plan JSON NOT NULL,
    latest_feedback JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_meal_plans_user_updated (user_id, updated_at),
    INDEX idx_meal_plans_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS meal_plan_versions (
    id VARCHAR(64) PRIMARY KEY,
    meal_plan_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    meal_plan JSON NOT NULL,
    goal TEXT,
    context TEXT,
    customization TEXT,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_meal_plan_versions_plan_id (meal_plan_id)
);

CREATE TABLE IF NOT EXISTS food_history (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    source VARCHAR(100) NOT NULL,
    food_name VARCHAR(255),
    status VARCHAR(50),
    meal_plan_id VARCHAR(64),
    goal TEXT,
    context TEXT,
    customization TEXT,
    feedback_data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE SET NULL,
    INDEX idx_food_history_user_id (user_id),
    INDEX idx_food_history_meal_plan_id (meal_plan_id)
);