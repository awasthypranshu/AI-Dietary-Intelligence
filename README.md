# AI Dietary Intelligence
AI Dietary Intelligence is a full-stack AI-powered personalized dietary intelligence platform.
The project combines:
- Food image recognition
- Nutrition information
- Patient health information
- Medical report information
- Digital Twin
- Food Genome
- Food preferences and reactions
- Food history
- User feedback
- Personalized AI analysis
- AI-generated meal plans
- Meal-plan customization and versioning
- Authentication and password reset
The core idea is:
> **The suitability of a food depends on the individual user and their personal context.**
Instead of providing only generic nutrition information, the system combines food data with the user's health profile, dietary information, previous experiences, preferences, reactions, and feedback.
---
## 1. Core Concept
```text
Food / Meal Plan
       ↓
User Experience
       ↓
Feedback
       ↓
Food History
       ↓
Food Genome
       ↓
Digital Twin
       ↓
Future AI Analysis
       ↓
Better Personalization

The system is designed as a continuous learning loop.

⸻

2. High-Level Architecture

                    USER
                      |
                      v
               React + Vite
                 Frontend
                      |
                      v
              Node.js + Express
                 Backend API
                      |
       +--------------+--------------+
       |              |              |
       v              v              v
 Authentication   Food System    Meal Planner
       |              |              |
       v              v              v
   MongoDB         Python          Gemini
                      |
                      v
          Local Hugging Face Model
                      |
                      v
                 Food Name
                      |
                      v
           USDA FoodData Central
                      |
                      v
               Nutrition Data
                      |
       +--------------+--------------+
       |              |              |
       v              v              v
 Patient Profile  Digital Twin  Food Genome
       |              |              |
       +--------------+--------------+
                      |
                      v
                Food History
                      |
                      v
                    Gemini
                      |
             +--------+--------+
             |                 |
             v                 v
     Food Analysis        Meal Plan
             |                 |
             v                 v
        Feedback          Saved Plan
             |                 |
             v                 v
       Food Genome       Versions
             |                 |
             +--------+--------+
                      |
                      v
                   MongoDB
                      |
                      v
              Future SQL + RAG

⸻

3. Technology Stack

Technology	Purpose
React	Frontend
Vite	Frontend tooling
JavaScript	Application language
Node.js	Backend runtime
Express.js	Backend API
MongoDB	Current database
Python	Local food recognition
Hugging Face Model	Food image recognition
Google Gemini	AI reasoning and generation
@google/genai	Gemini SDK
USDA FoodData Central	Nutrition data
Multer	File uploads
bcryptjs	Password hashing
Nodemailer	Password-reset email
crypto	Secure token generation/hashing
CORS	Frontend/backend communication
dotenv	Environment configuration
SQL	Planned database
RAG	Planned retrieval layer

⸻

4. Main AI Workflows

Personalized Food Analysis

Food Image
    ↓
Local Python + Hugging Face Model
    ↓
Food Name
    ↓
USDA FoodData Central
    ↓
Nutrition Data
    ↓
Patient Profile
    ↓
Digital Twin
    ↓
Food Genome
    ↓
Food History
    ↓
Gemini
    ↓
Personalized Food Analysis
    ↓
User Feedback

Personalized Meal Planning

User Goal
   +
Context
   +
Patient Profile
   +
Digital Twin
   +
Food Genome
   +
Previous Experiences
   +
Previous Meal Plans
   +
Meal-Plan Feedback
   ↓
Gemini
   ↓
Personalized Meal Plan
   ↓
MongoDB
   ↓
Saved Meal Plan
   ↓
Customization / Versions
   ↓
Feedback

⸻

5. Google Gemini

The project uses:

Google Gemini API

SDK:

@google/genai

Method:

gemini.models.generateContent()

Current model:

gemini-3.5-flash

Gemini is currently used for:

1. Medical report extraction
2. Personalized food analysis
3. Meal-plan generation
4. Meal-plan customization

The Gemini API key is stored only in the backend.

React
  ↓
Express Backend
  ↓
Google Gemini

The frontend never directly exposes the Gemini API key.

The backend also handles Gemini quota errors such as HTTP 429 and RESOURCE_EXHAUSTED.

⸻

6. Hugging Face Food Recognition

Food recognition uses a locally downloaded Hugging Face food-recognition model.

The hosted Hugging Face inference API is not used.

No Hugging Face API key is required.

The important files are:

server/food_recognition.py
server/requirements.txt

The local Python environment is:

server/food-ai/

The backend executes Python using:

server/food-ai/bin/python3

through Node.js:

child_process.execFile()

Flow:

Food Image
    ↓
Express
    ↓
Python
    ↓
food_recognition.py
    ↓
Local Hugging Face Model
    ↓
Food Name + Score
    ↓
Express
    ↓
React

The exact Hugging Face model identifier is defined in:

server/food_recognition.py

It should be taken directly from that file rather than guessed.

⸻

7. USDA FoodData Central

The project uses:

USDA FoodData Central

for food and nutrition information.

The exact external endpoint currently used is:

GET https://api.nal.usda.gov/fdc/v1/foods/search

The backend route is:

GET /nutrition

The request uses:

api_key
query
pageSize=5

The backend uses the first search result and extracts information such as:

* Food name
* FDC ID
* Calories
* Protein
* Carbohydrates
* Fat
* Fiber

The USDA API key is stored only in the backend.

⸻

8. Patient Profile

The patient profile stores information such as:

* Name
* Age
* Gender
* Height
* Weight
* Blood pressure
* Blood sugar
* Diseases
* Allergies
* Food preferences

Route:

POST /patients
GET /patients/user/:userId

The profile is also used to create/update the user’s Digital Twin and Food Genome.

⸻

9. Digital Twin

The Digital Twin is a persistent software representation of the user’s health and dietary context.

It can contain:

* Health profile
* Medical information
* Dietary feedback
* Feedback count
* Personal context

Routes:

GET /digital-twin/:patientName
GET /digital-twin/user/:userId

The Digital Twin provides reusable user context for personalization.

⸻

10. Food Genome

The Food Genome represents the user’s personalized relationship with food.

It stores information such as:

* Loved foods
* Liked foods
* Neutral foods
* Disliked foods
* Food reactions
* Food experiences
* Feedback
* Meal-plan feedback
* Learned patterns

The system keeps food preference separate from physical reaction.

For example:

Food: Pizza
Preference: Loved
Reaction: Acidity

A food being liked does not automatically mean that it is suitable for the user.

⸻

11. Feedback Learning

Food feedback is submitted through:

POST /food-history

Supported statuses:

loved
liked
neutral
disliked

Feedback can come from:

food-analysis
meal-planner

The feedback updates:

Food History
     ↓
Food Genome
     ↓
Digital Twin
     ↓
Future AI Context

Repeated experiences can become learned patterns.

The system distinguishes:

Preference
    ≠
Reaction
    ≠
Medical Diagnosis

The application does not automatically turn a reported reaction into a medical diagnosis or allergy.

⸻

12. Medical Reports

Medical reports can be uploaded through:

POST /medical-reports

Supported formats:

PDF
JPEG
JPG
PNG

Flow:

Medical Report
      ↓
Multer
      ↓
Server Storage
      ↓
Base64
      ↓
Gemini
      ↓
Structured Information
      ↓
medicalReports
      ↓
Patient Profile
      ↓
Digital Twin

Gemini is instructed to extract only information explicitly present in the report and not invent diagnoses or missing information.

⸻

13. Meal Planner

The main route is:

POST /meal-plan

Inputs include:

goal
context
customization
mealPlanId

The Meal Planner uses:

* Patient Profile
* Digital Twin
* Food Genome
* Food Genome learning
* Previous food experiences
* Previous meal plans
* Previous meal-plan feedback
* User goal
* User context
* Customization

The AI generates a personalized one-day plan containing sections such as:

* Breakfast
* Mid-Morning Snack
* Lunch
* Evening Snack
* Dinner
* Why This Plan
* Food Genome Considerations
* Alternatives
* Missing Information

⸻

14. Meal Plan Priority

The system prioritizes information approximately in this order:

1. Explicit allergies
2. Explicit dietary restrictions
3. Explicit medical information
4. Previous negative reactions
5. Repeated personal patterns
6. Nutrition
7. Food preference

This prevents a simple food preference from automatically overriding more important health or safety information.

⸻

15. Meal Plan Saving and Versioning

Generated plans are saved in MongoDB.

The backend returns:

mealPlan
mealPlanId
saved
updated

The mealPlanId connects:

Generated Plan
     ↓
Saved Plan
     ↓
Customization
     ↓
Version History
     ↓
Feedback

When a saved plan is customized:

Existing Plan
     ↓
mealPlanId
     ↓
Customization
     ↓
Gemini
     ↓
Updated Plan
     ↓
Previous Version Saved
     ↓
Same mealPlanId

Previous versions contain information such as:

mealPlan
goal
context
customization
savedAt

⸻

16. Meal Plan Feedback

Meal-plan feedback also uses:

POST /food-history

with:

source = meal-planner

The backend verifies the exact:

mealPlanId
+
authenticated userId

Feedback can update:

foodHistory
foodGenomes
mealPlans
digitalTwins

This allows meal-plan feedback to influence future personalization.

⸻

17. Authentication

The application uses a custom MongoDB-backed session system.

Session cookie:

dietary_session

Authentication flow:

Login
  ↓
Password Verification
  ↓
Generate Random Token
  ↓
SHA-256 Hash
  ↓
Store Hash in MongoDB
  ↓
HTTP-only Cookie
  ↓
Authenticated Requests

Session tokens are generated using:

crypto.randomBytes(32)

Passwords use:

bcryptjs

with cost factor:

12

Session lifetime:

Normal login: 24 hours
Remember Me: 30 days

MongoDB uses a TTL index on expiresAt.

⸻

18. Authentication Routes

POST /signup
POST /login
GET /me
POST /logout
POST /forgot-password
POST /reset-password

Signup requires:

Valid email
Password >= 8 characters

Password reset tokens are:

* Randomly generated
* SHA-256 hashed
* Valid for 30 minutes
* Sent using Nodemailer/SMTP

After a successful password reset, existing sessions are deleted.

⸻

19. API Overview

Method	Endpoint	Purpose
GET	/	Backend health
POST	/signup	Create account
POST	/login	Login
GET	/me	Current user
POST	/logout	Logout
POST	/forgot-password	Password reset request
POST	/reset-password	Reset password
GET	/user/:userId	User information
GET	/nutrition	USDA nutrition search
POST	/recognize-food	Local food recognition
POST	/food-images	Store food image metadata
POST	/patients	Create/update patient
GET	/patients/user/:userId	Retrieve patient
POST	/medical-reports	Upload/analyze medical report
POST	/food-history	Record feedback
GET	/food-genome/:patientName	Food Genome
GET	/food-genome/user/:userId	User Food Genome
GET	/digital-twin/:patientName	Digital Twin
GET	/digital-twin/user/:userId	User Digital Twin
GET	/meal-plans/user/:userId	Saved meal plans
GET	/meal-plans/:mealPlanId	Individual meal plan
POST	/meal-plan	Generate/customize meal plan
POST	/personalized-analysis	Personalized food analysis

⸻

20. MongoDB

Current database:

MongoDB

Database name:

dietaryAI

Current collections:

users
sessions
patients
digitalTwins
foodGenomes
medicalReports
foodImages
foodHistory
mealPlans

The backend owns all database operations.

The frontend never communicates directly with MongoDB.

⸻

21. Database Relationships

User
 |
 +-- Patient
 |
 +-- Digital Twin
 |
 +-- Food Genome
 |
 +-- Food History
 |
 +-- Medical Reports
 |
 +-- Food Images
 |
 +-- Meal Plans
       |
       +-- Versions
       |
       +-- Feedback

User-specific operations use userId and ownership checks.

This helps prevent one user from accessing another user’s private data.

⸻

22. Important MongoDB Indexes

The backend creates indexes for:

sessions.expiresAt
users.email
mealPlans.userId + updatedAt
mealPlans.userId + createdAt

The sessions index is a TTL index so expired sessions can be removed automatically.

⸻

23. Current Project Structure

CAPSTONE/
│
├── client/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── server/
│   ├── server.js
│   ├── food_recognition.py
│   ├── requirements.txt
│   ├── package.json
│   ├── uploads/
│   └── food-ai/
│
├── .gitignore
├── README.md
└── projectinshort.md

Important distinction:

food_recognition.py
= Source code
food-ai/
= Local Python virtual environment

The Python environment should not be committed to GitHub.

⸻

24. Environment Variables

Create:

server/.env

Example:

MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
USDA_API_KEY=YOUR_USDA_API_KEY
CLIENT_URL=http://localhost:5173
PORT=5001
NODE_ENV=development
SMTP_HOST=YOUR_SMTP_HOST
SMTP_PORT=587
SMTP_USER=YOUR_SMTP_USERNAME
SMTP_PASSWORD=YOUR_SMTP_PASSWORD
SMTP_FROM=YOUR_FROM_ADDRESS

The current backend uses:

SMTP_PASSWORD

not SMTP_PASS.

The current backend does not use:

SESSION_SECRET

and does not require:

HUGGINGFACE_API_KEY

⸻

25. Security

Never commit:

.env
API keys
MongoDB credentials
SMTP passwords

The backend keeps private credentials server-side.

Authentication uses:

HTTP-only Cookie
+
Random Session Token
+
SHA-256 Hash
+
MongoDB

Passwords use:

bcryptjs

The project also uses ownership checks for user-specific data.

⸻

26. Local Setup

Clone the repository:

git clone https://github.com/aryanmane07/AI-Dietary-Intelligence.git
cd AI-Dietary-Intelligence

Install frontend dependencies:

cd client
npm install

Install backend dependencies:

cd ../server
npm install

Create the Python environment:

python3 -m venv food-ai
source food-ai/bin/activate

Install Python dependencies:

pip install -r requirements.txt

On Windows:

python -m venv food-ai
food-ai\Scripts\activate
pip install -r requirements.txt

Create and configure:

server/.env

Then start the backend:

cd server
npm start

Start the frontend in another terminal:

cd client
npm run dev

⸻

27. Local Runtime

Frontend:

http://localhost:5173

Backend:

http://127.0.0.1:5001

Runtime:

Browser
   ↓
React + Vite
   ↓
Express
   ↓
+-------------+-------------+-------------+
|             |             |             |
MongoDB      Python       USDA          Gemini
               |
               v
       Local Hugging Face
            Model

⸻

28. Food Recognition Runtime

Image
  ↓
POST /recognize-food
  ↓
Express
  ↓
Multer
  ↓
Python Process
  ↓
food_recognition.py
  ↓
Local Hugging Face Model
  ↓
Food Name + Score
  ↓
Express
  ↓
React

⸻

29. Nutrition Runtime

Food Name
   ↓
GET /nutrition
   ↓
Express
   ↓
USDA FoodData Central
   ↓
/fdc/v1/foods/search
   ↓
Nutrition Data
   ↓
React

⸻

30. Personalized Analysis Runtime

Food
+
Nutrition
+
Patient Profile
+
Digital Twin
+
Food Genome
+
Food History
      ↓
POST /personalized-analysis
      ↓
Gemini
      ↓
gemini-3.5-flash
      ↓
Personalized Analysis

⸻

31. Meal Planner Runtime

Goal
+
Context
+
Patient Profile
+
Digital Twin
+
Food Genome
+
Previous Plans
+
Feedback
      ↓
POST /meal-plan
      ↓
Gemini
      ↓
gemini-3.5-flash
      ↓
Meal Plan
      ↓
MongoDB
      ↓
mealPlanId
      ↓
Frontend

⸻

32. Complete Food Intelligence Flow

START
  ↓
User Login
  ↓
Patient Profile
  ↓
Digital Twin + Food Genome
  ↓
Upload Food Image
  ↓
Local Python
  ↓
Hugging Face Model
  ↓
Food Name
  ↓
USDA FoodData Central
  ↓
Nutrition
  ↓
Patient + Digital Twin + Food Genome + History
  ↓
Gemini
  ↓
Personalized Analysis
  ↓
User Feedback
  ↓
Food History
  ↓
Food Genome + Digital Twin
  ↓
Future Personalization

⸻

33. Current vs Future Architecture

Current

React
  ↓
Express
  ↓
MongoDB

With:

Express
 ├── Python
 │    └── Local Hugging Face Model
 ├── USDA FoodData Central
 ├── Google Gemini
 └── SMTP

Future

React
  ↓
Express
  ↓
Service Layer
  ↓
Repository Layer
  ↓
SQL Database

With:

Express
 ├── Python
 │    └── Local Hugging Face Model
 ├── USDA FoodData Central
 ├── RAG
 ├── Google Gemini
 └── SMTP

⸻

34. Planned MongoDB → SQL Migration

MongoDB is the current database.

The planned next stage is migration to SQL, potentially:

PostgreSQL

or:

MySQL

The final SQL database can be selected during implementation.

The goal is to keep the frontend unchanged:

React
  ↓
Stable API
  ↓
Backend
  ↓
MongoDB

can become:

React
  ↓
Same API
  ↓
Backend
  ↓
SQL

Database-specific logic should remain inside the backend.

⸻

35. Planned RAG

Retrieval-Augmented Generation (RAG) is a future enhancement.

Current architecture:

User Context
+
Food Data
+
Food Genome
+
Digital Twin
+
History
 ↓
Gemini

Future architecture:

User Request
     ↓
Retriever
     ↓
Relevant Context
     ↓
Gemini
     ↓
Grounded Personalized Response

Potential retrieval sources include:

* Food Genome
* Food History
* Digital Twin
* Medical information
* Previous meal plans
* Meal-plan feedback
* USDA nutrition information

The goal is to retrieve only the most relevant information instead of sending unnecessary context.

⸻

36. Future Architecture

                    USER
                      |
                      v
               React Frontend
                      |
                      v
                Express API
                      |
          +-----------+-----------+
          |                       |
          v                       v
     SQL Database             RAG Layer
                                  |
                                  v
                                Gemini
                                  |
                                  v
                      Personalized Output
Food Recognition:
Image → Python → Local Hugging Face Model
Nutrition:
Food → USDA FoodData Central

⸻

37. Project Design Principles

Personalization

Recommendations should consider the individual user.

Separation of Responsibilities

Each technology performs a specific role:

Hugging Face = Food Recognition
USDA = Nutrition Data
MongoDB = Persistence
Digital Twin = User Context
Food Genome = Food Intelligence
Gemini = AI Reasoning

Security

Sensitive credentials remain on the backend.

Feedback

User feedback becomes part of future personalization.

API-Driven Architecture

The frontend communicates with the backend through APIs.

Migration Readiness

The frontend is not coupled directly to MongoDB.

Future AI Grounding

RAG can later provide more targeted information retrieval.

⸻

38. AI Safety

The project is a dietary decision-support system.

It is not intended to replace:

* Doctors
* Dietitians
* Medical professionals
* Clinical diagnosis
* Professional medical advice

The system should not:

* Invent medical information
* Invent allergies
* Invent food reactions
* Diagnose medical conditions
* Treat user preferences as medical facts

Medical report extraction is designed to use explicitly stated information.

⸻

39. Exact Integration Summary

Component	Current Implementation
Frontend	React + Vite
Backend	Node.js + Express
Database	MongoDB
Database Name	dietaryAI
Gemini SDK	@google/genai
Gemini Method	gemini.models.generateContent()
Gemini Model	gemini-3.5-flash
USDA Service	USDA FoodData Central
USDA Endpoint	/fdc/v1/foods/search
USDA Backend Route	GET /nutrition
Food Recognition	Python
Python Script	server/food_recognition.py
Python Environment	server/food-ai/
Python Execution	child_process.execFile()
Hugging Face	Local food-recognition model
Hugging Face Hosted API	Not used
Hugging Face API Key	Not required
Uploads	Multer
Password Hashing	bcryptjs
Session Token	crypto.randomBytes(32)
Session Hash	SHA-256
Session Cookie	dietary_session
Email	Nodemailer + SMTP
Current Database	MongoDB
Planned Database	SQL
Planned Retrieval	RAG

⸻

40. GitHub Handoff

The repository contains the source code and documentation.

It does not contain:

.env
node_modules/
server/food-ai/
server/uploads/
dist/

The Python environment must be recreated using:

python3 -m venv food-ai
pip install -r requirements.txt

The important food-recognition source files are:

server/food_recognition.py
server/requirements.txt

The developer must configure their own environment variables locally.

⸻

41. Final Project Flow

USER
  ↓
SIGN UP / LOGIN
  ↓
AUTHENTICATED SESSION
  ↓
PATIENT PROFILE
  ↓
DIGITAL TWIN + FOOD GENOME
  ↓
USER INTERACTION
  ↓
+-------------------+
|                   |
v                   v
FOOD IMAGE       MEAL PLANNER
  ↓                   |
LOCAL PYTHON          |
  ↓                   |
HUGGING FACE          |
  ↓                   |
FOOD NAME             |
  ↓                   |
USDA NUTRITION        |
  ↓                   |
  +---------+---------+
            ↓
          GEMINI
            ↓
     +------+------+
     |             |
     v             v
FOOD ANALYSIS   MEAL PLAN
     |             |
     v             v
 FEEDBACK       SAVE PLAN
     |             |
     v             v
FOOD HISTORY   VERSIONS
     |             |
     v             v
FOOD GENOME    PLAN FEEDBACK
     |             |
     +------+------+
            ↓
       DIGITAL TWIN
            ↓
 FUTURE PERSONALIZATION
            ↓
        FUTURE RAG
            ↓
        FUTURE SQL

⸻

42. Final Summary

AI Dietary Intelligence combines food recognition, nutrition data, health information, personal food experiences, feedback, and AI reasoning into one personalized dietary intelligence platform.

Current Architecture

React + Vite
      ↓
Node.js + Express
      ↓
MongoDB

AI/Data Components

Local Hugging Face Model
        ↓
Food Recognition
USDA FoodData Central
        ↓
Nutrition Information
Google Gemini
        ↓
Personalized Reasoning

Gemini currently uses:

gemini-3.5-flash

through:

@google/genai

Food recognition runs locally through:

Python
+
food_recognition.py
+
Local Hugging Face Model

The project currently uses MongoDB but is designed to support a future:

MongoDB → SQL

migration.

A future RAG layer will allow the system to retrieve relevant information from the user’s Digital Twin, Food Genome, Food History, meal plans, feedback, and nutrition data before sending context to Gemini.

The overall vision is:

Recognize
   ↓
Understand
   ↓
Retrieve
   ↓
Personalize
   ↓
Recommend
   ↓
Collect Feedback
   ↓
Learn
   ↓
Personalize Again

AI Dietary Intelligence is designed to evolve from a food-recognition and nutrition application into a personalized dietary intelligence platform.

---

## 43. Implemented Architecture: Agentic RAG & Food Variant Intelligence

This section documents the live, production-grade architecture implemented in the MySQL/MariaDB and Express backend.

```text
                                [ User Food Photo ]
                                         │
                                         ▼
                           foodRecognition (Gemini Vision)
                                         │
                ┌────────────────────────┴────────────────────────┐
                ▼                                                 ▼
      [ Patient-Specific RAG ]                       [ Shared Food Knowledge RAG ]
      (retrievalTools.js)                            (variantRetriever.js)
        - Patient Profile & Allergies                  - Canonical Dish & Aliases
        - Medical Reports / Prescriptions              - Documented Regional Variants
        - Historical Meals (Jaccard Similarity)        - Variant Ingredients (Required/Typical/Optional)
        - Food Genome Preferences & Twin Context       - Published Provenance / Source Citations
                │                                                 │
                ▼                                                 ▼
      personalContextAgent.js                        variantAgent.js
        (Patient Evidence Report)                      (Source-backed Candidates & Differences)
                │                                                 │
                └────────────────────────┬────────────────────────┘
                                         ▼
                                  orchestrator.js
                          (Enrich Variants with Per-Variant
                              Patient Allergy Evidence)
                                         │
                                         ▼
                                   verdictAgent.js
               ┌─────────────────────────┴─────────────────────────┐
               ▼                                                   ▼
       Uploaded Food Verdict                             Per-Variant Verdicts
       - Deterministic Allergy Guard                     - Documented Required Allergen -> AVOID
       - Visible / Suspected / Traditional               - Optional / Regional Allergen -> CAUTION
               │                                                   │
               └─────────────────────────┬─────────────────────────┘
                                         ▼
                             POST /food-agents/analyze
                                         │
                                         ▼
                               FoodUpload.jsx (UI)
```

### 1. Two Separate Retrieval Systems

1. **Patient-Specific RAG (`server/ai/agents/retrievalTools.js`)**:
   - Strictly scoped to the authenticated `userId`.
   - **Jaccard Similarity Ranking**: Computes real set intersection over union for candidate food analyses rather than unranked substring matches.
   - **Per-Analysis Grouping**: Candidates are keyed by distinct `food_image_id`, ensuring feedback and reactions attach to the exact historical meal event.
   - **Food Genome Isolation**: Filters unrelated recent food experiences so only relevant ingredient preferences are supplied.
   - **Non-Negotiable Health Constraints**: Serious allergies, chronic conditions, and medication interactions are always preserved regardless of historical food similarity.

2. **Shared Food-Knowledge Retrieval (`server/ai/foodKnowledge/variantRetriever.js`)**:
   - Multi-tier deterministic SQL retrieval: Exact Canonical Name -> Verified Aliases (`food_knowledge_aliases`) -> Style/Region ranking.
   - Structured Relational Model: Retrieves variant details, preparation method, citations (`food_sources`), and ingredient classification (`required`, `typical`, `optional`, `regional`, `substitution`).
   - Clean Fallback: If no catalog entry is found, Gemini suggestions are clearly labeled as `isCatalogMatch: false` and `unverified`.

### 2. Database Schema & Relational Structure

- **`food_sources`**: Stores verifiable recipe literature and culinary documentation (`id`, `title`, `publisher`, `url`, `source_type`, `publication_date`, `is_verified`, `notes`).
- **`food_variants`**: Relational variant catalog linked to sources (`id`, `canonical_name`, `canonical_name_key`, `variant_name`, `variant_name_key`, `region_or_style`, `preparation_method`, `description`, `is_verified`, `source_id`).
- **`food_variant_ingredients`**: Ingredient-level provenance (`id`, `variant_id`, `ingredient_name`, `ingredient_key`, `role`, `presence_type`, `source_id`, `notes`, `confidence`).
- **`food_knowledge_aliases`**: Verified aliases mapping variations (e.g. `khaman`, `suji dhokla`, `kulche chole`) to canonical dishes.
- **`food_knowledge`**: Dual-mode legacy/flattened table for backward compatibility.
- **`food_agent_reports`**: Extended with `knowledge_json` column storing variant retrieval state, citations, and evidence.

### 3. Operational Commands

#### A. Database Migration
Applies incremental, idempotent schema migrations without dropping existing data:
```bash
cd server
npm run migrate
```

#### B. Seed / Import Verified Starter Records
Populates verified culinary starter data (e.g., Khaman Dhokla, Rava Dhokla, Chole Bhature, Amritsari Kulcha Chole) with verified source citations:
```bash
cd server
npm run seed:knowledge
```
To import custom JSON records:
```bash
node ai/agents/seedFoodKnowledge.js --json path/to/records.json
```

#### C. Ingredient Normalization & Key Backfilling
Idempotently normalizes historical stored ingredient keys using canonical synonyms and singularization:
```bash
cd server
npm run reindex:ingredients
```

#### D. Running Unit & Integration Tests
Runs the test suite using mock database tables and deterministic fake Gemini responses without requiring external credentials:
```bash
cd server
npm test
```

### 4. Safety Architecture & Verdict Guardrails

- **Uploaded Food Guard**: If an allergen matches visible or traditional ingredients of the photographed plate, `avoid` is deterministically enforced.
- **Per-Variant Allergy Guard**:
  - `required` allergen in variant recipe -> Variant verdict is downgraded to `avoid` with a clear explanation.
  - `optional` / `regional` allergen -> Variant verdict is held at `caution`, prompting the patient to verify restaurant preparation.
  - Variant ingredients are never falsely attributed to the uploaded food analysis.
- **Honest Uncertainty**: Missing nutritional facts or unverified recipe variations are explicitly labeled as `unknown` / `unverified` rather than hallucinating precise numbers.