const express = require("express");
const cors = require("cors");
const db = require("./db/connection");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  registerFoodIntelligenceRoutes,
} = require("./routes/foodIntelligence");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

require("dotenv").config({
  path: __dirname + "/.env",
});

const { GoogleGenAI } = require("@google/genai");

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();

const PORT =
  process.env.PORT || 5001;

const CLIENT_URL =
  process.env.CLIENT_URL ||
  "http://localhost:5173";

const IS_PRODUCTION =
  process.env.NODE_ENV === "production";

const SESSION_COOKIE_NAME =
  "dietary_session";

// ==================================================
// MIDDLEWARE
// ==================================================

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

// ==================================================
// EMAIL / PASSWORD RESET SETUP
// ==================================================

let emailTransporter = null;

if (
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASSWORD
) {
  emailTransporter =
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port:
        Number(process.env.SMTP_PORT) || 587,
      secure:
        Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

  console.log(
    "Password reset email service configured."
  );
} else {
  console.log(
    "SMTP email settings not configured yet."
  );
}

// ==================================================
// FILE UPLOAD SETUP
// ==================================================

const uploadsDirectory = path.join(
  __dirname,
  "uploads"
);

if (!fs.existsSync(uploadsDirectory)) {
  fs.mkdirSync(uploadsDirectory, {
    recursive: true,
  });
}

const storage =
  multer.diskStorage({
    destination: function (
      req,
      file,
      cb
    ) {
      cb(null, uploadsDirectory);
    },

    filename: function (
      req,
      file,
      cb
    ) {
      const uniqueName =
        Date.now() +
        "-" +
        Math.round(Math.random() * 1e9);

      cb(
        null,
        uniqueName +
          path.extname(file.originalname)
      );
    },
  });

const upload = multer({
  storage,
});

// ==================================================
// MYSQL DATABASE CONNECTION
// ==================================================

async function connectToDatabase() {
  try {
    await db.query("SELECT 1");

    console.log(
      "MySQL connected successfully!"
    );

    console.log(
      "Authentication and meal-plan database ready."
    );
  } catch (error) {
    console.error(
      "MySQL connection error:",
      error
    );

    throw error;
  }
}

// ==================================================
// AUTHENTICATION HELPERS
// ==================================================

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function normalizeUserId(userId) {
  return String(userId || "").trim();
}

// ==================================================
// JSON DATABASE HELPER
// ==================================================

// MySQL JSON columns must receive valid JSON.
// This helper safely stores strings, arrays, and objects.
function toJsonString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return JSON.stringify(value);
}

// ==================================================
// SESSION HELPERS
// ==================================================

function hashSessionToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function createSessionToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function getSessionCookieOptions(
  rememberMe
) {
  const options = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION
      ? "none"
      : "lax",
    path: "/",
  };

  if (rememberMe) {
    options.maxAge =
      30 *
      24 *
      60 *
      60 *
      1000;
  }

  return options;
}

function getClearCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION
      ? "none"
      : "lax",
    path: "/",
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader
    .split(";")
    .forEach((cookie) => {
      const separator =
        cookie.indexOf("=");

      if (separator === -1) {
        return;
      }

      const key = cookie
        .slice(0, separator)
        .trim();

      const value = cookie
        .slice(separator + 1)
        .trim();

      if (key) {
        cookies[key] =
          decodeURIComponent(value);
      }
    });

  return cookies;
}

// ==================================================
// AUTHENTICATION MIDDLEWARE
// ==================================================

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const cookies =
      parseCookies(
        req.headers.cookie
      );

    const sessionToken =
      cookies[
        SESSION_COOKIE_NAME
      ];

    if (!sessionToken) {
      return res.status(401).json({
        message:
          "Authentication required. Please log in again.",
      });
    }

    const sessionTokenHash =
      hashSessionToken(
        sessionToken
      );

    const [rows] =
      await db.query(
        `
        SELECT id, user_id, expires_at
        FROM sessions
        WHERE token_hash = ?
          AND expires_at > NOW()
        LIMIT 1
        `,
        [sessionTokenHash]
      );

    const session = rows[0];

    if (!session) {
      res.clearCookie(
        SESSION_COOKIE_NAME,
        getClearCookieOptions()
      );

      return res.status(401).json({
        message:
          "Your session has expired. Please log in again.",
      });
    }

    req.authUserId =
      normalizeUserId(
        session.user_id
      );

    req.authSessionId =
      session.id;

    next();
  } catch (error) {
    console.error(
      "Authentication middleware error:",
      error
    );

    res.status(500).json({
      message:
        "Could not verify your session.",
    });
  }
}

// ==================================================
// PASSWORD RESET HELPERS
// ==================================================

function hashResetToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

// ==================================================
// PERSONALIZATION DATA
// ==================================================

function parseJsonValue(
  value,
  fallback = null
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function getPersonalizationData(
  userId
) {
  const cleanUserId =
    normalizeUserId(userId);

  if (!cleanUserId) {
    return {
      digitalTwin: null,
      foodGenome: null,
    };
  }

  const [
    digitalTwinRows,
    foodGenomeRows,
  ] = await Promise.all([
    db.query(
      `
      SELECT *
      FROM digital_twins
      WHERE user_id = ?
      LIMIT 1
      `,
      [cleanUserId]
    ),

    db.query(
      `
      SELECT *
      FROM food_genomes
      WHERE user_id = ?
      LIMIT 1
      `,
      [cleanUserId]
    ),
  ]);

  const digitalTwin =
    digitalTwinRows[0][0];

  const foodGenome =
    foodGenomeRows[0][0];

  return {
    digitalTwin: digitalTwin
      ? {
          userId:
            digitalTwin.user_id,

          patientName:
            digitalTwin.patient_name ||
            "",

          healthProfile:
            parseJsonValue(
              digitalTwin.health_profile,
              null
            ),

          medicalReportData:
            parseJsonValue(
              digitalTwin.medical_report_data,
              null
            ),

          medicalReportAnalyzed:
            Boolean(
              digitalTwin.medical_report_analyzed
            ),

          medicalReportUpdatedAt:
            digitalTwin.medical_report_updated_at ||
            null,

          dietaryFeedback:
            parseJsonValue(
              digitalTwin.dietary_feedback,
              []
            ),

          feedbackCount:
            digitalTwin.feedback_count || 0,

          lastDietaryFeedback:
            parseJsonValue(
              digitalTwin.last_dietary_feedback,
              null
            ),

          createdAt:
            digitalTwin.created_at,

          updatedAt:
            digitalTwin.updated_at,
        }
      : null,

    foodGenome: foodGenome
      ? {
          userId:
            foodGenome.user_id,

          patientName:
            foodGenome.patient_name ||
            "",

          totalFeedback:
            foodGenome.total_feedback || 0,

          lovedFoods:
            parseJsonValue(
              foodGenome.loved_foods,
              []
            ),

          likedFoods:
            parseJsonValue(
              foodGenome.liked_foods,
              []
            ),

          neutralFoods:
            parseJsonValue(
              foodGenome.neutral_foods,
              []
            ),

          dislikedFoods:
            parseJsonValue(
              foodGenome.disliked_foods,
              []
            ),

          reactions:
            parseJsonValue(
              foodGenome.reactions,
              []
            ),

          foods:
            parseJsonValue(
              foodGenome.foods,
              []
            ),

          mealPlanFeedback:
            parseJsonValue(
              foodGenome.meal_plan_feedback,
              []
            ),

          lastFeedback:
            parseJsonValue(
              foodGenome.last_feedback,
              null
            ),

          lastMealPlanFeedback:
            parseJsonValue(
              foodGenome.last_meal_plan_feedback,
              null
            ),

          createdAt:
            foodGenome.created_at,

          updatedAt:
            foodGenome.updated_at,
        }
      : null,
  };
}

// ==================================================
// GET AUTHENTICATED PATIENT
// ==================================================

async function getAuthenticatedPatient(
  userId
) {
  const cleanUserId =
    normalizeUserId(userId);

  if (!cleanUserId) {
    return null;
  }

  const [rows] =
    await db.query(
      `
      SELECT *
      FROM patients
      WHERE user_id = ?
      LIMIT 1
      `,
      [cleanUserId]
    );

  const patient =
    rows[0] || null;

  if (!patient) {
    return null;
  }

  return {
    userId:
      patient.user_id,

    patientId:
      patient.id,

    name:
      patient.name,

    age:
      patient.age,

    gender:
      patient.gender || "",

    height:
      patient.height,

    weight:
      patient.weight,

    bloodPressure:
      patient.blood_pressure,

    bloodSugar:
      patient.blood_sugar,

    diseases:
      parseJsonValue(
        patient.diseases,
        []
      ),

    allergies:
      parseJsonValue(
        patient.allergies,
        []
      ),

    foodPreferences:
      parseJsonValue(
        patient.food_preferences,
        []
      ),

    medicalReportId:
      patient.medical_report_id ||
      null,

    medicalReportAnalyzed:
      Boolean(
        patient.medical_report_analyzed
      ),

    medicalReportUpdatedAt:
      patient.medical_report_updated_at ||
      null,

    medicalReportData:
      parseJsonValue(
        patient.medical_report_data,
        null
      ),

    createdAt:
      patient.created_at,

    updatedAt:
      patient.updated_at,
  };
}

// ==================================================
// GET PREVIOUS MEAL PLANS
// ==================================================

async function getPreviousMealPlans(
  userId,
  excludeMealPlanId = null
) {
  const cleanUserId =
    normalizeUserId(userId);

  let query = `
    SELECT
      id,
      user_id,
      patient_name,
      meal_plan,
      goal,
      context,
      customization,
      created_at,
      updated_at,
      latest_feedback
    FROM meal_plans
    WHERE user_id = ?
  `;

  const params = [
    cleanUserId,
  ];

  if (excludeMealPlanId) {
    query += `
      AND id <> ?
    `;

    params.push(
      excludeMealPlanId
    );
  }

  query += `
    ORDER BY updated_at DESC
    LIMIT 8
  `;

  const [rows] =
    await db.query(
      query,
      params
    );

  return rows.map(
    (plan) => ({
      id:
        plan.id,

      userId:
        plan.user_id,

      patientName:
        plan.patient_name ||
        "",

      mealPlan:
        parseJsonValue(
          plan.meal_plan,
          ""
        ),

      goal:
        plan.goal ||
        "",

      context:
        plan.context ||
        "",

      customization:
        plan.customization ||
        "",

      createdAt:
        plan.created_at,

      updatedAt:
        plan.updated_at,

      latestFeedback:
        parseJsonValue(
          plan.latest_feedback,
          null
        ),
    })
  );
}

// ==================================================
// BUILD FOOD GENOME LEARNING SUMMARY
// ==================================================

function buildFoodGenomeLearning(
  foodGenome
) {
  if (!foodGenome) {
    return {
      preferences: [],
      reactions: [],
      recentExperiences: [],
      learnedPatterns: [],
      mealPlanFeedback: [],
    };
  }

  const preferences = [];

  const preferenceGroups = [
    {
      label: "loved",
      items:
        Array.isArray(
          foodGenome.lovedFoods
        )
          ? foodGenome.lovedFoods
          : [],
    },

    {
      label: "liked",
      items:
        Array.isArray(
          foodGenome.likedFoods
        )
          ? foodGenome.likedFoods
          : [],
    },

    {
      label: "neutral",
      items:
        Array.isArray(
          foodGenome.neutralFoods
        )
          ? foodGenome.neutralFoods
          : [],
    },

    {
      label: "disliked",
      items:
        Array.isArray(
          foodGenome.dislikedFoods
        )
          ? foodGenome.dislikedFoods
          : [],
    },
  ];

  preferenceGroups.forEach(
    (group) => {
      group.items.forEach(
        (item) => {
          if (item?.foodName) {
            preferences.push({
              foodName:
                item.foodName,

              preference:
                group.label,

              reaction:
                item.reaction ||
                "",

              notes:
                item.notes ||
                "",
            });
          }
        }
      );
    }
  );

  const reactions =
    Array.isArray(
      foodGenome.reactions
    )
      ? foodGenome.reactions
      : [];

  const foods =
    Array.isArray(
      foodGenome.foods
    )
      ? foodGenome.foods
      : [];

  const reactionGroups =
    new Map();

  reactions.forEach(
    (item) => {
      if (!item?.foodName) {
        return;
      }

      const key =
        item.foodName
          .trim()
          .toLowerCase();

      if (
        !reactionGroups.has(
          key
        )
      ) {
        reactionGroups.set(
          key,
          {
            foodName:
              item.foodName,

            reactions: [],
          }
        );
      }

      if (item.reaction) {
        reactionGroups
          .get(key)
          .reactions.push(
            item.reaction
          );
      }
    }
  );

  const learnedPatterns = [];

  reactionGroups.forEach(
    (group) => {
      const preferenceMatch =
        preferences.find(
          (item) =>
            item.foodName
              .trim()
              .toLowerCase() ===
            group.foodName
              .trim()
              .toLowerCase()
        );

      learnedPatterns.push({
        foodName:
          group.foodName,

        preference:
          preferenceMatch?.preference ||
          "not recorded",

        reactionCount:
          group.reactions.length,

        reactions:
          group.reactions,

        learningStrength:
          group.reactions.length >=
          3
            ? "strong repeated pattern"
            : group.reactions.length ===
              2
            ? "emerging repeated pattern"
            : "single recorded experience",
      });
    }
  );

  const mealPlanFeedback =
    Array.isArray(
      foodGenome.mealPlanFeedback
    )
      ? foodGenome.mealPlanFeedback
      : [];

  return {
    preferences,

    reactions,

    recentExperiences:
      foods
        .slice()
        .reverse()
        .slice(0, 10),

    learnedPatterns,

    mealPlanFeedback:
      mealPlanFeedback
        .slice()
        .reverse()
        .slice(0, 10),
  };
}

// ==================================================
// GEMINI ERROR HELPER
// ==================================================

function getGeminiErrorMessage(
  error
) {
  const errorText =
    String(
      error?.message ||
        error ||
        ""
    );

  if (
    errorText.includes(
      "RESOURCE_EXHAUSTED"
    ) ||
    errorText.includes(
      "GenerateRequestsPerDay"
    ) ||
    errorText.includes(
      "quota"
    ) ||
    errorText.includes("429")
  ) {
    return (
      "The AI daily free-tier limit has been reached. Please try again after the quota resets."
    );
  }

  return null;
}

// ==================================================
// TEST ROUTE
// ==================================================

app.get("/", (req, res) => {
  res.json({
    message:
      "AI Dietary Intelligence Backend is running!",
  });
});

// ==================================================
// SIGNUP
// ==================================================

app.post(
  "/signup",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password || ""
        );

      if (!email) {
        return res.status(400).json({
          message:
            "Email address is required.",
        });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          message:
            "Please enter a valid email address.",
        });
      }

      if (!password) {
        return res.status(400).json({
          message:
            "Password is required.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters.",
        });
      }

      const [existingRows] =
        await db.query(
          `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
          `,
          [email]
        );

      if (existingRows.length > 0) {
        return res.status(409).json({
          message:
            "An account with this email already exists. Please log in.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const userId =
        crypto
          .randomBytes(24)
          .toString("hex");

      await db.query(
        `
        INSERT INTO users (
          id,
          email,
          password_hash,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, NOW(), NOW())
        `,
        [
          userId,
          email,
          passwordHash,
        ]
      );

      res.status(201).json({
        message:
          "Account created successfully.",

        userId,

        email,
      });
    } catch (error) {
      console.error(
        "Signup error:",
        error
      );

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          message:
            "An account with this email already exists. Please log in.",
        });
      }

      res.status(500).json({
        message:
          "Could not create your account.",
      });
    }
  }
);

// ==================================================
// LOGIN
// ==================================================

app.post(
  "/login",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password || ""
        );

      const rememberMe =
        Boolean(
          req.body.rememberMe
        );

      if (!email || !password) {
        return res.status(400).json({
          message:
            "Email and password are required.",
        });
      }

      const [userRows] =
        await db.query(
          `
          SELECT
            id,
            email,
            password_hash
          FROM users
          WHERE email = ?
          LIMIT 1
          `,
          [email]
        );

      const user = userRows[0];

      if (!user) {
        return res.status(401).json({
          message:
            "Invalid email or password.",
        });
      }

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!passwordMatches) {
        return res.status(401).json({
          message:
            "Invalid email or password.",
        });
      }

      const sessionToken =
        createSessionToken();

      const sessionTokenHash =
        hashSessionToken(
          sessionToken
        );

      const now =
        new Date();

      const sessionLifetime =
        rememberMe
          ? 30 * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

      const expiresAt =
        new Date(
          Date.now() +
            sessionLifetime
        );

      const sessionId =
        crypto
          .randomBytes(24)
          .toString("hex");

      await db.query(
        `
        INSERT INTO sessions (
          id,
          user_id,
          token_hash,
          expires_at,
          remember_me,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          sessionId,
          user.id,
          sessionTokenHash,
          expiresAt,
          rememberMe,
          now,
        ]
      );

      await db.query(
        `
        UPDATE users
        SET
          last_login_at = ?,
          updated_at = ?
        WHERE id = ?
        `,
        [
          now,
          now,
          user.id,
        ]
      );

      res.cookie(
        SESSION_COOKIE_NAME,
        sessionToken,
        getSessionCookieOptions(
          rememberMe
        )
      );

      res.json({
        message:
          "Login successful.",

        userId:
          user.id,

        email:
          user.email,

        rememberMe,
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        message:
          "Could not log you in.",
      });
    }
  }
);

// ==================================================
// GET CURRENT AUTHENTICATED USER
// ==================================================

app.get(
  "/me",
  requireAuth,
  async (req, res) => {
    try {
      const [rows] =
        await db.query(
          `
          SELECT
            id,
            email,
            created_at,
            last_login_at
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const user = rows[0];

      if (!user) {
        return res.status(404).json({
          message:
            "User account not found.",
        });
      }

      res.json({
        userId:
          user.id,

        email:
          user.email,

        createdAt:
          user.created_at,

        lastLoginAt:
          user.last_login_at ||
          null,
      });
    } catch (error) {
      console.error(
        "Current user retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve your account.",
      });
    }
  }
);

// ==================================================
// LOGOUT
// ==================================================

app.post(
  "/logout",
  async (req, res) => {
    try {
      const cookies =
        parseCookies(
          req.headers.cookie
        );

      const sessionToken =
        cookies[
          SESSION_COOKIE_NAME
        ];

      if (sessionToken) {
        const sessionTokenHash =
          hashSessionToken(
            sessionToken
          );

        await db.query(
          `
          DELETE FROM sessions
          WHERE token_hash = ?
          `,
          [sessionTokenHash]
        );
      }

      res.clearCookie(
        SESSION_COOKIE_NAME,
        getClearCookieOptions()
      );

      res.json({
        message:
          "Logged out successfully.",
      });
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );

      res.status(500).json({
        message:
          "Could not log you out.",
      });
    }
  }
);

// ==================================================
// FORGOT PASSWORD
// ==================================================

app.post(
  "/forgot-password",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body.email
        );

      if (
        !email ||
        !isValidEmail(email)
      ) {
        return res.status(400).json({
          message:
            "Please enter a valid email address.",
        });
      }

      const genericMessage =
        "If an account exists for this email, a password reset link has been sent.";

      const [userRows] =
        await db.query(
          `
          SELECT id, email
          FROM users
          WHERE email = ?
          LIMIT 1
          `,
          [email]
        );

      const user = userRows[0];

      if (!user) {
        return res.json({
          message:
            genericMessage,
        });
      }

      if (!emailTransporter) {
        console.error(
          "Password reset requested, but SMTP is not configured."
        );

        return res.status(500).json({
          message:
            "Email service is not configured yet.",
        });
      }

      const resetToken =
        crypto
          .randomBytes(32)
          .toString("hex");

      const resetTokenHash =
        hashResetToken(
          resetToken
        );

      const resetTokenExpiresAt =
        new Date(
          Date.now() +
            30 *
              60 *
              1000
        );

      await db.query(
        `
        UPDATE users
        SET
          reset_token_hash = ?,
          reset_token_expires_at = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [
          resetTokenHash,
          resetTokenExpiresAt,
          user.id,
        ]
      );

      const resetUrl =
        `${CLIENT_URL}/reset-password?token=${encodeURIComponent(
          resetToken
        )}`;

      await emailTransporter.sendMail({
        from:
          process.env.SMTP_FROM ||
          process.env.SMTP_USER,

        to: email,

        subject:
          "Reset Your Dietary Intelligence Password",

        text:
          `You requested a password reset for your Dietary Intelligence account.\n\n` +
          `Use the following link to create a new password:\n\n` +
          `${resetUrl}\n\n` +
          `This link expires in 30 minutes and can only be used once.\n\n` +
          `If you did not request this password reset, you can safely ignore this email.`,

        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 30px;">
            <h2>Reset Your Password</h2>
            <p>
              You requested a password reset for your
              Dietary Intelligence account.
            </p>
            <p>
              Click the button below to create a new password.
            </p>
            <p>
              <a
                href="${resetUrl}"
                style="
                  display: inline-block;
                  padding: 12px 20px;
                  background: #111827;
                  color: white;
                  text-decoration: none;
                  border-radius: 8px;
                "
              >
                Reset Password
              </a>
            </p>
            <p>
              This link expires in
              <strong>30 minutes</strong>
              and can only be used once.
            </p>
            <p>
              If you did not request this password reset,
              you can safely ignore this email.
            </p>
          </div>
        `,
      });

      console.log(
        `Password reset email sent to ${email}`
      );

      res.json({
        message:
          genericMessage,
      });
    } catch (error) {
      console.error(
        "Forgot password error:",
        error
      );

      res.status(500).json({
        message:
          "Could not process the password reset request.",
      });
    }
  }
);

// ==================================================
// RESET PASSWORD
// ==================================================

app.post(
  "/reset-password",
  async (req, res) => {
    try {
      const token =
        String(
          req.body.token || ""
        ).trim();

      const newPassword =
        String(
          req.body.password || ""
        );

      if (!token) {
        return res.status(400).json({
          message:
            "Password reset token is missing.",
        });
      }

      if (!newPassword) {
        return res.status(400).json({
          message:
            "New password is required.",
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters.",
        });
      }

      const resetTokenHash =
        hashResetToken(token);

      const [userRows] =
        await db.query(
          `
          SELECT id
          FROM users
          WHERE reset_token_hash = ?
            AND reset_token_expires_at > NOW()
          LIMIT 1
          `,
          [resetTokenHash]
        );

      const user = userRows[0];

      if (!user) {
        return res.status(400).json({
          message:
            "This password reset link is invalid or has expired.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      const [result] =
        await db.query(
          `
          UPDATE users
          SET
            password_hash = ?,
            reset_token_hash = NULL,
            reset_token_expires_at = NULL,
            updated_at = NOW()
          WHERE id = ?
            AND reset_token_hash = ?
            AND reset_token_expires_at > NOW()
          `,
          [
            passwordHash,
            user.id,
            resetTokenHash,
          ]
        );

      if (result.affectedRows !== 1) {
        return res.status(400).json({
          message:
            "This password reset link is invalid or has already been used.",
        });
      }

      await db.query(
        `
        DELETE FROM sessions
        WHERE user_id = ?
        `,
        [user.id]
      );

      res.json({
        message:
          "Password reset successfully. You can now log in with your new password.",
      });
    } catch (error) {
      console.error(
        "Reset password error:",
        error
      );

      res.status(500).json({
        message:
          "Could not reset your password.",
      });
    }
  }
);

// ==================================================
// LEGACY USER ROUTE
// ==================================================

app.get(
  "/user/:userId",
  requireAuth,
  async (req, res) => {
    try {
      const requestedUserId =
        normalizeUserId(
          req.params.userId
        );

      if (
        requestedUserId !==
        req.authUserId
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this account.",
        });
      }

      if (!requestedUserId) {
        return res.status(400).json({
          message:
            "Invalid user ID.",
        });
      }

      const [rows] =
        await db.query(
          `
          SELECT
            id,
            email,
            created_at,
            last_login_at
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [requestedUserId]
        );

      const user = rows[0];

      if (!user) {
        return res.status(404).json({
          message:
            "User account not found.",
        });
      }

      res.json({
        userId:
          user.id,

        email:
          user.email,

        createdAt:
          user.created_at,

        lastLoginAt:
          user.last_login_at ||
          null,
      });
    } catch (error) {
      console.error(
        "User retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve user account.",
      });
    }
  }
);
// ==================================================
// FOOD RECOGNITION, NUTRITION ESTIMATE AND FOOD AGENTS
// ==================================================

registerFoodIntelligenceRoutes({
  app,
  db,
  requireAuth,
  storage,
  gemini,
  getAuthenticatedPatient,
  getPersonalizationData,
  buildFoodGenomeLearning,
  getGeminiErrorMessage,
});

// ==================================================
// PATIENT PROFILE
// ==================================================

app.post(
  "/patients",
  requireAuth,
  async (req, res) => {
    try {
      const patient = req.body;
      const userId = req.authUserId;

      if (!userId) {
        return res.status(401).json({
          message:
            "Authentication required.",
        });
      }

      if (
        !patient?.name ||
        !patient.name.trim()
      ) {
        return res.status(400).json({
          message:
            "Patient name is required.",
        });
      }

      const cleanName =
        patient.name.trim();

      const patientId =
        crypto.randomBytes(24).toString("hex");

      const now = new Date();

      const diseases =
        patient.diseases || "";

      const allergies =
        patient.allergies || "";

      const foodPreferences =
        patient.foodPreferences || "";

      const [existingPatientRows] =
        await db.query(
          `
          SELECT *
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const existingPatient =
        existingPatientRows[0] || null;

      let savedPatientId;

      if (existingPatient) {
        savedPatientId =
          existingPatient.id;

        await db.query(
          `
          UPDATE patients
          SET
            name = ?,
            age = ?,
            gender = ?,
            height = ?,
            weight = ?,
            blood_pressure = ?,
            blood_sugar = ?,
            diseases = ?,
            allergies = ?,
            food_preferences = ?,
            updated_at = ?
          WHERE user_id = ?
          `,
          [
            cleanName,
            patient.age || null,
            patient.gender || null,
            patient.height || null,
            patient.weight || null,
            patient.bloodPressure || null,
            patient.bloodSugar || null,
            toJsonString(diseases),
            toJsonString(allergies),
            toJsonString(foodPreferences),
            now,
            userId,
          ]
        );
      } else {
        savedPatientId =
          patientId;

        await db.query(
          `
          INSERT INTO patients (
            id,
            user_id,
            name,
            age,
            gender,
            height,
            weight,
            blood_pressure,
            blood_sugar,
            diseases,
            allergies,
            food_preferences,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            savedPatientId,
            userId,
            cleanName,
            patient.age || null,
            patient.gender || null,
            patient.height || null,
            patient.weight || null,
            patient.bloodPressure || null,
            patient.bloodSugar || null,
            toJsonString(diseases),
            toJsonString(allergies),
            toJsonString(foodPreferences),
            now,
            now,
          ]
        );
      }

      // ------------------------------------------
      // DIGITAL TWIN
      // ------------------------------------------

      const healthProfile = {
        userId,
        name: cleanName,
        age: patient.age || "",
        gender: patient.gender || "",
        height: patient.height || "",
        weight: patient.weight || "",
        bloodPressure:
          patient.bloodPressure || "",
        bloodSugar:
          patient.bloodSugar || "",
        diseases,
        allergies,
        foodPreferences,
        updatedAt: now,
      };

      const [digitalTwinRows] =
        await db.query(
          `
          SELECT id
          FROM digital_twins
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      if (digitalTwinRows.length > 0) {
        await db.query(
          `
          UPDATE digital_twins
          SET
            patient_name = ?,
            health_profile = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
          `,
          [
            cleanName,
            toJsonString(
              healthProfile
            ),
            userId,
          ]
        );
      } else {
        await db.query(
          `
          INSERT INTO digital_twins (
            id,
            user_id,
            patient_name,
            health_profile,
            dietary_feedback,
            feedback_count,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          `,
          [
            crypto.randomBytes(24).toString("hex"),
            userId,
            cleanName,
            toJsonString(
              healthProfile
            ),
            toJsonString([]),
            now,
            now,
          ]
        );
      }

      // ------------------------------------------
      // FOOD GENOME
      // ------------------------------------------

      const [foodGenomeRows] =
        await db.query(
          `
          SELECT id
          FROM food_genomes
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      if (foodGenomeRows.length === 0) {
        await db.query(
          `
          INSERT INTO food_genomes (
            id,
            user_id,
            total_feedback,
            loved_foods,
            liked_foods,
            neutral_foods,
            disliked_foods,
            reactions,
            foods,
            meal_plan_feedback,
            patient_name,
            created_at,
            updated_at
          )
          VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            crypto.randomBytes(24).toString("hex"),
            userId,
            toJsonString([]),
            toJsonString([]),
            toJsonString([]),
            toJsonString([]),
            toJsonString([]),
            toJsonString([]),
            toJsonString([]),
            cleanName,
            now,
            now,
          ]
        );
      }

      res.json({
        message:
          "Patient profile saved successfully.",

        patientId:
          savedPatientId.toString(),

        userId,

        patient: {
          userId,
          name: cleanName,
          age:
            patient.age || "",
          gender:
            patient.gender || "",
          height:
            patient.height || "",
          weight:
            patient.weight || "",
          bloodPressure:
            patient.bloodPressure || "",
          bloodSugar:
            patient.bloodSugar || "",
          diseases,
          allergies,
          foodPreferences,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error(
        "Error saving patient:",
        error
      );

      res.status(500).json({
        message:
          "Failed to save patient profile.",
      });
    }
  }
);

// ==================================================
// GET PATIENT BY USER ID
// ==================================================

app.get(
  "/patients/user/:userId",
  requireAuth,
  async (req, res) => {
    try {
      if (
        normalizeUserId(
          req.params.userId
        ) !==
        req.authUserId
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this health profile.",
        });
      }

      const [rows] =
        await db.query(
          `
          SELECT *
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const patient =
        rows[0];

      if (!patient) {
        return res.status(404).json({
          message:
            "No health profile found for this account.",
        });
      }

      res.json({
        userId:
          patient.user_id,

        patientId:
          patient.id,

        name:
          patient.name,

        age:
          patient.age,

        gender:
          patient.gender || "",

        height:
          patient.height,

        weight:
          patient.weight,

        bloodPressure:
          patient.blood_pressure,

        bloodSugar:
          patient.blood_sugar,

        diseases:
          parseJsonValue(
            patient.diseases
          ),

        allergies:
          parseJsonValue(
            patient.allergies
          ),

        foodPreferences:
          parseJsonValue(
            patient.food_preferences
          ),

        medicalReportId:
          patient.medical_report_id ||
          null,

        medicalReportAnalyzed:
          Boolean(
            patient.medical_report_analyzed
          ),

        medicalReportUpdatedAt:
          patient.medical_report_updated_at ||
          null,

        medicalReportData:
          parseJsonValue(
            patient.medical_report_data,
            null
          ),

        createdAt:
          patient.created_at,

        updatedAt:
          patient.updated_at,
      });
    } catch (error) {
      console.error(
        "Patient profile retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve patient profile.",
      });
    }
  }
);

// ==================================================
// MEDICAL REPORT UPLOAD + GEMINI AI READING
// ==================================================

app.post(
  "/medical-reports",
  requireAuth,
  upload.single("medicalReport"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message:
            "No medical report uploaded.",
        });
      }

      const userId =
        req.authUserId;

      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ];

      if (
        !allowedTypes.includes(
          req.file.mimetype
        )
      ) {
        return res.status(400).json({
          message:
            "Only PDF, JPG, JPEG, and PNG medical reports are supported.",
        });
      }

      console.log(
        "Reading medical report with Gemini..."
      );

      const reportBytes =
        fs.readFileSync(
          req.file.path
        );

      const reportBase64 =
        reportBytes.toString(
          "base64"
        );

      const extractionPrompt = `
You are a medical document information extraction assistant.

Analyze the uploaded medical report.

Extract ONLY information that is explicitly visible,
written, or clearly stated in the document.

DO NOT:
- diagnose the patient
- infer diseases
- invent values
- estimate missing values
- make medical conclusions
- create information that is not in the document

Return ONLY valid JSON.

Use exactly this structure:

{
  "conditions": [],
  "bloodPressure": null,
  "bloodSugar": null,
  "fastingBloodSugar": null,
  "postMealBloodSugar": null,
  "hba1c": null,
  "cholesterol": null,
  "ldl": null,
  "hdl": null,
  "triglycerides": null,
  "hemoglobin": null,
  "thyroidResults": [],
  "kidneyFindings": [],
  "liverFindings": [],
  "allergies": [],
  "dietaryRestrictions": [],
  "medications": [],
  "otherRelevantFindings": []
}

Rules:

1. "conditions" should contain explicitly diagnosed or
   explicitly mentioned health conditions.

2. Blood values should contain the value and unit if
   available.

3. "thyroidResults" should contain objects such as:
   {
     "test": "TSH",
     "value": "..."
   }

4. "kidneyFindings" should contain explicitly reported
   kidney-related findings.

5. "liverFindings" should contain explicitly reported
   liver-related findings.

6. "allergies" should contain only allergies explicitly
   mentioned.

7. "dietaryRestrictions" should contain only dietary
   restrictions explicitly mentioned.

8. "medications" should contain medications only when
   clearly listed in the report.

9. "otherRelevantFindings" should contain other explicitly
   reported findings that could be relevant to dietary
   planning.

10. If a value is not present, use null.

11. If a list has no information, use [].

This is document extraction only, not medical diagnosis.
`;


const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let aiResponse;
const maxAttempts = 3;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    aiResponse = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: reportBase64,
          },
        },
        { text: extractionPrompt },
      ],
      config: {
        httpOptions: {
          timeout: 60000,
          retryOptions: {
            attempts: 1,
          },
        },
      },
    });

    break;
  } catch (error) {
    const status = error.status ?? error.code;
    const retryable =
      status === 503 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 504 ||
      error.cause?.code === "UND_ERR_CONNECT_TIMEOUT";

    if (!retryable || attempt === maxAttempts) {
      throw error;
    }

    console.warn(
      `Gemini attempt ${attempt} failed; retrying shortly.`
    );

    await sleep(2000 * 2 ** (attempt - 1));
  }
}

if (!aiResponse) {
  throw new Error("Gemini did not return a response.");
}



      const aiText =
        aiResponse.text || "";

      let cleanedJson =
        aiText.trim();

      if (
        cleanedJson.startsWith(
          "```"
        )
      ) {
        cleanedJson =
          cleanedJson
            .replace(
              /^```(?:json)?/i,
              ""
            )
            .replace(
              /```$/,
              ""
            )
            .trim();
      }

      let extractedData;

      try {
        extractedData =
          JSON.parse(
            cleanedJson
          );
      } catch (parseError) {
        console.error(
          "Gemini returned invalid JSON:",
          aiText
        );

        return res.status(500).json({
          message:
            "The report was uploaded, but the AI could not structure its information.",
        });
      }

      extractedData = {
        conditions:
          Array.isArray(
            extractedData.conditions
          )
            ? extractedData.conditions
            : [],

        bloodPressure:
          extractedData.bloodPressure ??
          null,

        bloodSugar:
          extractedData.bloodSugar ??
          null,

        fastingBloodSugar:
          extractedData.fastingBloodSugar ??
          null,

        postMealBloodSugar:
          extractedData.postMealBloodSugar ??
          null,

        hba1c:
          extractedData.hba1c ??
          null,

        cholesterol:
          extractedData.cholesterol ??
          null,

        ldl:
          extractedData.ldl ??
          null,

        hdl:
          extractedData.hdl ??
          null,

        triglycerides:
          extractedData.triglycerides ??
          null,

        hemoglobin:
          extractedData.hemoglobin ??
          null,

        thyroidResults:
          Array.isArray(
            extractedData.thyroidResults
          )
            ? extractedData.thyroidResults
            : [],

        kidneyFindings:
          Array.isArray(
            extractedData.kidneyFindings
          )
            ? extractedData.kidneyFindings
            : [],

        liverFindings:
          Array.isArray(
            extractedData.liverFindings
          )
            ? extractedData.liverFindings
            : [],

        allergies:
          Array.isArray(
            extractedData.allergies
          )
            ? extractedData.allergies
            : [],

        dietaryRestrictions:
          Array.isArray(
            extractedData.dietaryRestrictions
          )
            ? extractedData.dietaryRestrictions
            : [],

        medications:
          Array.isArray(
            extractedData.medications
          )
            ? extractedData.medications
            : [],

        otherRelevantFindings:
          Array.isArray(
            extractedData.otherRelevantFindings
          )
            ? extractedData.otherRelevantFindings
            : [],
      };

      const [patientRows] =
        await db.query(
          `
          SELECT id, name
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const patient =
        patientRows[0] || null;

      const patientName =
        patient?.name || "";

      const now =
        new Date();

      const reportId =
        crypto.randomBytes(24).toString("hex");

      // IMPORTANT:
      // medical_reports has 30 columns here,
      // so this VALUES list has exactly 30 placeholders.
      await db.query(
        `
        INSERT INTO medical_reports (
          id,
          user_id,
          patient_id,
          patient_name,
          original_name,
          file_name,
          file_path,
          file_type,
          conditions,
          blood_pressure,
          blood_sugar,
          fasting_blood_sugar,
          post_meal_blood_sugar,
          hba1c,
          cholesterol,
          ldl,
          hdl,
          triglycerides,
          hemoglobin,
          thyroid_results,
          kidney_findings,
          liver_findings,
          allergies,
          dietary_restrictions,
          medications,
          other_relevant_findings,
          extracted_data,
          uploaded_at,
          ai_analyzed,
          ai_analyzed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          reportId,
          userId,
          patient?.id || null,
          patientName,
          req.file.originalname,
          req.file.originalname,
          req.file.path,
          req.file.mimetype,
          toJsonString(
            extractedData.conditions
          ),
          extractedData.bloodPressure,
          extractedData.bloodSugar,
          extractedData.fastingBloodSugar,
          extractedData.postMealBloodSugar,
          extractedData.hba1c,
          extractedData.cholesterol,
          extractedData.ldl,
          extractedData.hdl,
          extractedData.triglycerides,
          extractedData.hemoglobin,
          toJsonString(
            extractedData.thyroidResults
          ),
          toJsonString(
            extractedData.kidneyFindings
          ),
          toJsonString(
            extractedData.liverFindings
          ),
          toJsonString(
            extractedData.allergies
          ),
          toJsonString(
            extractedData.dietaryRestrictions
          ),
          toJsonString(
            extractedData.medications
          ),
          toJsonString(
            extractedData.otherRelevantFindings
          ),
          toJsonString(
            extractedData
          ),
          now,
          true,
          now,
        ]
      );

      await db.query(
        `
        UPDATE patients
        SET
          medical_report_id = ?,
          medical_report_analyzed = TRUE,
          medical_report_updated_at = ?,
          medical_report_data = ?
        WHERE user_id = ?
        `,
        [
          reportId,
          now,
          toJsonString(
            extractedData
          ),
          userId,
        ]
      );

      const [digitalTwinRows] =
        await db.query(
          `
          SELECT id
          FROM digital_twins
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      if (digitalTwinRows.length > 0) {
        await db.query(
          `
          UPDATE digital_twins
          SET
            patient_name = ?,
            medical_report_data = ?,
            medical_report_analyzed = TRUE,
            medical_report_updated_at = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
          `,
          [
            patientName,
            toJsonString(
              extractedData
            ),
            now,
            userId,
          ]
        );
      } else {
        await db.query(
          `
          INSERT INTO digital_twins (
            id,
            user_id,
            patient_name,
            medical_report_data,
            medical_report_analyzed,
            medical_report_updated_at,
            dietary_feedback,
            feedback_count,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, TRUE, ?, ?, 0, ?, ?)
          `,
          [
            crypto.randomBytes(24).toString("hex"),
            userId,
            patientName,
            toJsonString(
              extractedData
            ),
            now,
            toJsonString([]),
            now,
            now,
          ]
        );
      }

      res.json({
        message:
          "Medical report uploaded and analyzed successfully.",

        reportId,

        userId,

        aiAnalyzed:
          true,

        extractedData,
      });
    } catch (error) {
      console.error(
        "Medical report AI analysis error:",
        error
      );

      const quotaMessage =
        getGeminiErrorMessage(
          error
        );

      res
        .status(
          quotaMessage
            ? 429
            : 500
        )
        .json({
          message:
            quotaMessage ||
            "Could not analyze the medical report. Please try again.",
        });
    }
  }
);

// ==================================================
// FOOD IMAGE UPLOAD
// ==================================================

app.post(
  "/food-images",
  requireAuth,
  upload.single("foodImage"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message:
            "No food image uploaded.",
        });
      }

      const userId =
        req.authUserId;

      const foodImageId =
        crypto.randomBytes(24).toString("hex");

      const now =
        new Date();

      await db.query(
        `
        INSERT INTO food_images (
          id,
          user_id,
          original_name,
          file_name,
          file_path,
          mime_type,
          uploaded_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          foodImageId,
          userId,
          req.file.originalname,
          req.file.filename,
          req.file.path,
          req.file.mimetype,
          now,
        ]
      );

      res.json({
        message:
          "Food image uploaded successfully.",

        foodImageId,
      });
    } catch (error) {
      console.error(
        "Error uploading food image:",
        error
      );

      res.status(500).json({
        message:
          "Failed to upload food image.",
      });
    }
  }
);

// ==================================================
// SHARED USER FEEDBACK
// ==================================================

app.post(
  "/food-history",
  requireAuth,
  async (req, res) => {
    try {
      const userId =
        req.authUserId;

      const patientName =
        String(
          req.body.patientName || ""
        ).trim();

      const foodName =
        String(
          req.body.foodName || ""
        ).trim();

      const status =
        String(
          req.body.status || ""
        ).trim();

      const reaction =
        String(
          req.body.reaction || ""
        ).trim();

      const notes =
        String(
          req.body.notes || ""
        ).trim();

      const source =
        String(
          req.body.source ||
            "user_feedback"
        ).trim();

      const mealPlanId =
        String(
          req.body.mealPlanId || ""
        ).trim();

      const goal =
        String(
          req.body.goal || ""
        ).trim();

      const context =
        String(
          req.body.context || ""
        ).trim();

      const customization =
        String(
          req.body.customization || ""
        ).trim();

      const isFoodFeedback =
        source ===
        "food-analysis";

      const isMealPlanFeedback =
        source ===
        "meal-planner";

      if (
        isFoodFeedback &&
        !foodName
      ) {
        return res.status(400).json({
          message:
            "Food name is required for food feedback.",
        });
      }

      if (
        isMealPlanFeedback &&
        !mealPlanId
      ) {
        return res.status(400).json({
          message:
            "A saved meal plan ID is required for meal-plan feedback.",
        });
      }

      if (!status) {
        return res.status(400).json({
          message:
            "Feedback status is required.",
        });
      }

      const validStatuses = [
        "loved",
        "liked",
        "neutral",
        "disliked",
      ];

      if (
        !validStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid feedback status.",
        });
      }

      const [patientRows] =
        await db.query(
          `
          SELECT name
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const patient =
        patientRows[0] || null;

      const resolvedPatientName =
        patient?.name ||
        patientName;

      const now =
        new Date();

      let savedMealPlan =
        null;

      if (
        isMealPlanFeedback
      ) {
        const [mealPlanRows] =
          await db.query(
            `
            SELECT *
            FROM meal_plans
            WHERE id = ?
              AND user_id = ?
            LIMIT 1
            `,
            [
              mealPlanId,
              userId,
            ]
          );

        savedMealPlan =
          mealPlanRows[0] || null;

        if (!savedMealPlan) {
          return res.status(404).json({
            message:
              "The saved meal plan could not be found.",
          });
        }
      }

      const feedbackRecord = {
        userId,

        patientName:
          resolvedPatientName,

        foodName:
          isFoodFeedback
            ? foodName
            : "",

        status,

        reaction,

        notes,

        source,

        recordedAt:
          now,
      };

      if (
        isMealPlanFeedback
      ) {
        feedbackRecord.mealPlanId =
          mealPlanId;

        feedbackRecord.goal =
          savedMealPlan.goal ||
          goal ||
          "";

        feedbackRecord.context =
          savedMealPlan.context ||
          context ||
          "";

        feedbackRecord.customization =
          savedMealPlan.customization ||
          customization ||
          "";
      }

      const foodHistoryId =
        crypto
          .randomBytes(24)
          .toString("hex");

      await db.query(
        `
        INSERT INTO food_history (
          id,
          user_id,
          patient_name,
          source,
          food_name,
          status,
          reaction,
          notes,
          meal_plan_id,
          goal,
          context,
          customization,
          feedback_data,
          recorded_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          foodHistoryId,
          userId,
          resolvedPatientName,
          source,
          isFoodFeedback
            ? foodName
            : "",
          status,
          reaction,
          notes,
          isMealPlanFeedback
            ? mealPlanId
            : null,
          isMealPlanFeedback
            ? savedMealPlan.goal ||
              goal ||
              ""
            : goal,
          isMealPlanFeedback
            ? savedMealPlan.context ||
              context ||
              ""
            : context,
          isMealPlanFeedback
            ? savedMealPlan.customization ||
              customization ||
              ""
            : customization,
          toJsonString(
            feedbackRecord
          ),
          now,
          now,
        ]
      );

      // ==================================================
      // FOOD GENOME
      // ==================================================

      if (
        isFoodFeedback
      ) {
        const genomeFoodEntry = {
          foodName,

          status,

          reaction,

          notes,

          source,

          recordedAt:
            now,
        };

        const [genomeRows] =
          await db.query(
            `
            SELECT *
            FROM food_genomes
            WHERE user_id = ?
            LIMIT 1
            `,
            [userId]
          );

        const genome =
          genomeRows[0] || null;

        const lovedFoods =
          parseJsonValue(
            genome?.loved_foods,
            []
          );

        const likedFoods =
          parseJsonValue(
            genome?.liked_foods,
            []
          );

        const neutralFoods =
          parseJsonValue(
            genome?.neutral_foods,
            []
          );

        const dislikedFoods =
          parseJsonValue(
            genome?.disliked_foods,
            []
          );

        const reactions =
          parseJsonValue(
            genome?.reactions,
            []
          );

        const foods =
          parseJsonValue(
            genome?.foods,
            []
          );

        const currentPreferences = {
          loved: lovedFoods,
          liked: likedFoods,
          neutral: neutralFoods,
          disliked: dislikedFoods,
        };

        const statusKey = String(status || "").toLowerCase().trim();

if (!Object.prototype.hasOwnProperty.call(currentPreferences, statusKey)) {
  throw new Error(`Invalid food feedback status: ${status}`);
}

currentPreferences[statusKey].push({
  foodName,
  reaction,
  notes,
  source,
  recordedAt: now,
});

        foods.push(
          genomeFoodEntry
        );

        if (reaction) {
          reactions.push({
            foodName,

            reaction,

            recordedAt:
              now,
          });
        }

        const genomeId =
          genome?.id ||
          crypto
            .randomBytes(24)
            .toString("hex");

        await db.query(
          `
          INSERT INTO food_genomes (
            id,
            user_id,
            total_feedback,
            loved_foods,
            liked_foods,
            neutral_foods,
            disliked_foods,
            reactions,
            foods,
            meal_plan_feedback,
            patient_name,
            last_feedback,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            total_feedback = VALUES(total_feedback),
            loved_foods = VALUES(loved_foods),
            liked_foods = VALUES(liked_foods),
            neutral_foods = VALUES(neutral_foods),
            disliked_foods = VALUES(disliked_foods),
            reactions = VALUES(reactions),
            foods = VALUES(foods),
            patient_name = VALUES(patient_name),
            last_feedback = VALUES(last_feedback),
            updated_at = CURRENT_TIMESTAMP
          `,
          [
            genomeId,
            userId,
            (genome?.total_feedback || 0) +
              1,
            toJsonString(
              currentPreferences.loved
            ),
            toJsonString(
              currentPreferences.liked
            ),
            toJsonString(
              currentPreferences.neutral
            ),
            toJsonString(
              currentPreferences.disliked
            ),
            toJsonString(
              reactions
            ),
            toJsonString(
              foods
            ),
            toJsonString(
              parseJsonValue(
                genome?.meal_plan_feedback,
                []
              )
            ),
            resolvedPatientName,
now, // last_feedback must be a datetime
genome?.created_at || now,
now, // updated_at
          ]
        );
      }

      // ==================================================
      // MEAL PLAN FEEDBACK
      // ==================================================

      if (isMealPlanFeedback) {
        const mealPlanFeedbackRecord = {
          mealPlanId,

          status,

          reaction,

          notes,

          source,

          goal:
            savedMealPlan.goal ||
            goal ||
            "",

          context:
            savedMealPlan.context ||
            context ||
            "",

          customization:
            savedMealPlan.customization ||
            customization ||
            "",

          recordedAt:
            now,
        };

        const [genomeRows] =
          await db.query(
            `
            SELECT *
            FROM food_genomes
            WHERE user_id = ?
            LIMIT 1
            `,
            [userId]
          );

        const genome =
          genomeRows[0] || null;

        const existingMealPlanFeedback =
          parseJsonValue(
            genome?.meal_plan_feedback,
            []
          );

        existingMealPlanFeedback.push(
          mealPlanFeedbackRecord
        );

        const genomeId =
          genome?.id ||
          crypto
            .randomBytes(24)
            .toString("hex");

        await db.query(
          `
          INSERT INTO food_genomes (
            id,
            user_id,
            total_feedback,
            loved_foods,
            liked_foods,
            neutral_foods,
            disliked_foods,
            reactions,
            foods,
            meal_plan_feedback,
            patient_name,
            last_meal_plan_feedback,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            meal_plan_feedback = VALUES(meal_plan_feedback),
            patient_name = VALUES(patient_name),
            last_meal_plan_feedback = VALUES(last_meal_plan_feedback),
            updated_at = CURRENT_TIMESTAMP
          `,
          [
            genomeId,
            userId,
            genome?.total_feedback || 0,

            toJsonString(
              parseJsonValue(
                genome?.loved_foods,
                []
              )
            ),

            toJsonString(
              parseJsonValue(
                genome?.liked_foods,
                []
              )
            ),

            toJsonString(
              parseJsonValue(
                genome?.neutral_foods,
                []
              )
            ),

            toJsonString(
              parseJsonValue(
                genome?.disliked_foods,
                []
              )
            ),

            toJsonString(
              parseJsonValue(
                genome?.reactions,
                []
              )
            ),

            toJsonString(
              parseJsonValue(
                genome?.foods,
                []
              )
            ),

            toJsonString(
              existingMealPlanFeedback
            ),

            resolvedPatientName,

            toJsonString(
              mealPlanFeedbackRecord
            ),

            genome?.created_at ||
              now,

            now,
          ]
        );

        const existingFeedbackHistory =
          parseJsonValue(
            savedMealPlan.feedback_history,
            []
          );

        existingFeedbackHistory.push(
          mealPlanFeedbackRecord
        );

        await db.query(
          `
          UPDATE meal_plans
          SET
            latest_feedback = ?,
            feedback_history = ?,
            updated_at = ?
          WHERE id = ?
            AND user_id = ?
          `,
          [
            toJsonString(
              mealPlanFeedbackRecord
            ),

            toJsonString(
              existingFeedbackHistory
            ),

            now,

            mealPlanId,

            userId,
          ]
        );
      }

      // ==================================================
      // DIGITAL TWIN
      // ==================================================

      const twinFeedback = {
        foodName:
          isFoodFeedback
            ? foodName
            : "",

        status,

        reaction,

        notes,

        source,

        recordedAt:
          now,
      };

      if (
        isMealPlanFeedback
      ) {
        twinFeedback.mealPlanId =
          mealPlanId;

        twinFeedback.goal =
          savedMealPlan.goal ||
          goal ||
          "";

        twinFeedback.context =
          savedMealPlan.context ||
          context ||
          "";

        twinFeedback.customization =
          savedMealPlan.customization ||
          customization ||
          "";
      }

      const [twinRows] =
        await db.query(
          `
          SELECT *
          FROM digital_twins
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const twin =
        twinRows[0] || null;

      const dietaryFeedback =
        parseJsonValue(
          twin?.dietary_feedback,
          []
        );

      dietaryFeedback.push(
        twinFeedback
      );

      const twinId =
        twin?.id ||
        crypto
          .randomBytes(24)
          .toString("hex");

      await db.query(
        `
        INSERT INTO digital_twins (
          id,
          user_id,
          patient_name,
          health_profile,
          medical_report_data,
          medical_report_analyzed,
          medical_report_updated_at,
          dietary_feedback,
          feedback_count,
          last_dietary_feedback,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          patient_name = VALUES(patient_name),
          dietary_feedback = VALUES(dietary_feedback),
          feedback_count = VALUES(feedback_count),
          last_dietary_feedback = VALUES(last_dietary_feedback),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          twinId,
          userId,
          resolvedPatientName,
          toJsonString(
            parseJsonValue(
              twin?.health_profile,
              null
            )
          ),
          toJsonString(
            parseJsonValue(
              twin?.medical_report_data,
              null
            )
          ),
          twin?.medical_report_analyzed ||
            false,
          twin?.medical_report_updated_at ||
            null,
          toJsonString(
            dietaryFeedback
          ),
         (twin?.feedback_count || 0) + 1,
now, // ✅ last_dietary_feedback expects a DATETIME
twin?.created_at || now,
now,
        ]
      );

      res.json({
        message:
          "Feedback saved and personalization data updated successfully.",

        foodHistoryId:
          foodHistoryId,

        mealPlanId:
          isMealPlanFeedback
            ? mealPlanId
            : null,

        feedbackType:
          isMealPlanFeedback
            ? "meal-plan"
            : "food",

        updated: {
          foodGenome:
            true,

          digitalTwin:
            true,

          mealPlan:
            isMealPlanFeedback,
        },
      });
    } catch (error) {
      console.error(
        "Error saving user feedback:",
        error
      );

      res.status(500).json({
        message:
          "Failed to save user feedback.",
      });
    }
  }
);

// ==================================================
// GET FOOD GENOME BY PATIENT NAME
// ==================================================

app.get(
  "/food-genome/:patientName",
  requireAuth,
  async (req, res) => {
    try {
      const [patientRows] =
        await db.query(
          `
          SELECT name
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const patient =
        patientRows[0] || null;

      if (
        patient &&
        patient.name !==
          req.params.patientName
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this Food Genome.",
        });
      }

      const [genomeRows] =
        await db.query(
          `
          SELECT *
          FROM food_genomes
          WHERE user_id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const genome =
        genomeRows[0] || null;

      if (!genome) {
        return res.json({
          userId:
            req.authUserId,

          patientName:
            patient?.name ||
            req.params.patientName,

          totalFeedback: 0,

          lovedFoods: [],

          likedFoods: [],

          neutralFoods: [],

          dislikedFoods: [],

          reactions: [],

          foods: [],

          mealPlanFeedback: [],
        });
      }

      res.json({
        userId:
          genome.user_id,

        patientName:
          genome.patient_name ||
          patient?.name ||
          req.params.patientName,

        totalFeedback:
          genome.total_feedback || 0,

        lovedFoods:
          parseJsonValue(
            genome.loved_foods,
            []
          ),

        likedFoods:
          parseJsonValue(
            genome.liked_foods,
            []
          ),

        neutralFoods:
          parseJsonValue(
            genome.neutral_foods,
            []
          ),

        dislikedFoods:
          parseJsonValue(
            genome.disliked_foods,
            []
          ),

        reactions:
          parseJsonValue(
            genome.reactions,
            []
          ),

        foods:
          parseJsonValue(
            genome.foods,
            []
          ),

        mealPlanFeedback:
          parseJsonValue(
            genome.meal_plan_feedback,
            []
          ),

        lastFeedback:
          parseJsonValue(
            genome.last_feedback,
            null
          ),

        lastMealPlanFeedback:
          parseJsonValue(
            genome.last_meal_plan_feedback,
            null
          ),

        createdAt:
          genome.created_at,

        updatedAt:
          genome.updated_at,
      });
    } catch (error) {
      console.error(
        "Food Genome retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve Food Genome.",
      });
    }
  }
);

// ==================================================
// GET FOOD GENOME BY USER ID
// ==================================================

app.get(
  "/food-genome/user/:userId",
  requireAuth,
  async (req, res) => {
    try {
      if (
        normalizeUserId(
          req.params.userId
        ) !==
        req.authUserId
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this Food Genome.",
        });
      }

      const userId =
        req.authUserId;

      const [rows] =
        await db.query(
          `
          SELECT *
          FROM food_genomes
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const genome =
        rows[0] || null;

      if (!genome) {
        return res.json({
          userId,

          totalFeedback: 0,

          lovedFoods: [],

          likedFoods: [],

          neutralFoods: [],

          dislikedFoods: [],

          reactions: [],

          foods: [],

          mealPlanFeedback: [],
        });
      }

      res.json({
        userId:
          genome.user_id,

        patientName:
          genome.patient_name ||
          "",

        totalFeedback:
          genome.total_feedback || 0,

        lovedFoods:
          parseJsonValue(
            genome.loved_foods,
            []
          ),

        likedFoods:
          parseJsonValue(
            genome.liked_foods,
            []
          ),

        neutralFoods:
          parseJsonValue(
            genome.neutral_foods,
            []
          ),

        dislikedFoods:
          parseJsonValue(
            genome.disliked_foods,
            []
          ),

        reactions:
          parseJsonValue(
            genome.reactions,
            []
          ),

        foods:
          parseJsonValue(
            genome.foods,
            []
          ),

        mealPlanFeedback:
          parseJsonValue(
            genome.meal_plan_feedback,
            []
          ),

        lastFeedback:
          parseJsonValue(
            genome.last_feedback,
            null
          ),

        lastMealPlanFeedback:
          parseJsonValue(
            genome.last_meal_plan_feedback,
            null
          ),

        createdAt:
          genome.created_at,

        updatedAt:
          genome.updated_at,
      });
    } catch (error) {
      console.error(
        "Food Genome user retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve Food Genome.",
      });
    }
  }
);

// ==================================================
// GET SAVED MEAL PLANS BY USER
// ==================================================

app.get(
  "/meal-plans/user/:userId",
  requireAuth,
  async (req, res) => {
    try {
      const requestedUserId =
        normalizeUserId(
          req.params.userId
        );

      if (
        requestedUserId !==
        req.authUserId
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access these meal plans.",
        });
      }

      const [rows] =
        await db.query(
          `
          SELECT *
          FROM meal_plans
          WHERE user_id = ?
          ORDER BY updated_at DESC
          LIMIT 20
          `,
          [req.authUserId]
        );

      const plans =
        rows.map((plan) => ({
          id:
            plan.id,

          userId:
            plan.user_id,

          patientName:
            plan.patient_name,

          goal:
            plan.goal,

          context:
            plan.context,

          customization:
            plan.customization,

          mealPlan:
            parseJsonValue(
              plan.meal_plan,
              ""
            ),

          latestFeedback:
            parseJsonValue(
              plan.latest_feedback,
              null
            ),

          feedbackHistory:
            parseJsonValue(
              plan.feedback_history,
              []
            ),

          createdAt:
            plan.created_at,

          updatedAt:
            plan.updated_at,
        }));

      res.json({
        mealPlans:
          plans,
      });
    } catch (error) {
      console.error(
        "Meal plans retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve saved meal plans.",
      });
    }
  }
);

// ==================================================
// GET ONE SAVED MEAL PLAN
// ==================================================

app.get(
  "/meal-plans/:mealPlanId",
  requireAuth,
  async (req, res) => {
    try {
      const mealPlanId =
        req.params.mealPlanId;

      const [rows] =
        await db.query(
          `
          SELECT *
          FROM meal_plans
          WHERE id = ?
            AND user_id = ?
          LIMIT 1
          `,
          [
            mealPlanId,
            req.authUserId,
          ]
        );

      const plan =
        rows[0] || null;

      if (!plan) {
        return res.status(404).json({
          message:
            "Saved meal plan not found.",
        });
      }

      res.json({
        mealPlan: {
          id:
            plan.id,

          userId:
            plan.user_id,

          patientName:
            plan.patient_name,

          goal:
            plan.goal,

          context:
            plan.context,

          customization:
            plan.customization,

          mealPlan:
            parseJsonValue(
              plan.meal_plan,
              ""
            ),

          latestFeedback:
            parseJsonValue(
              plan.latest_feedback,
              null
            ),

          feedbackHistory:
            parseJsonValue(
              plan.feedback_history,
              []
            ),

          createdAt:
            plan.created_at,

          updatedAt:
            plan.updated_at,
        },
      });
    } catch (error) {
      console.error(
        "Saved meal plan retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve the saved meal plan.",
      });
    }
  }
);

// ==================================================
// GET DIGITAL TWIN BY PATIENT NAME
// ==================================================

app.get(
  "/digital-twin/:patientName",
  requireAuth,
  async (req, res) => {
    try {
      const [patientRows] =
        await db.query(
          `
          SELECT name
          FROM patients
          WHERE user_id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const patient =
        patientRows[0] || null;

      if (
        patient &&
        patient.name !==
          req.params.patientName
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this Digital Twin.",
        });
      }

      const [twinRows] =
        await db.query(
          `
          SELECT *
          FROM digital_twins
          WHERE user_id = ?
          LIMIT 1
          `,
          [req.authUserId]
        );

      const twin =
        twinRows[0] || null;

      if (!twin) {
        return res.json({
          userId:
            req.authUserId,

          patientName:
            patient?.name ||
            req.params.patientName,

          feedbackCount: 0,

          healthProfile: null,

          medicalReportData: null,

          medicalReportAnalyzed: false,

          medicalReportUpdatedAt: null,

          dietaryFeedback: [],

          lastDietaryFeedback: null,
        });
      }

      res.json({
        userId:
          twin.user_id,

        patientName:
          twin.patient_name ||
          patient?.name ||
          req.params.patientName,

        feedbackCount:
          twin.feedback_count || 0,

        healthProfile:
          parseJsonValue(
            twin.health_profile,
            null
          ),

        medicalReportData:
          parseJsonValue(
            twin.medical_report_data,
            null
          ),

        medicalReportAnalyzed:
          Boolean(
            twin.medical_report_analyzed
          ),

        medicalReportUpdatedAt:
          twin.medical_report_updated_at,

        dietaryFeedback:
          parseJsonValue(
            twin.dietary_feedback,
            []
          ),

        lastDietaryFeedback:
          parseJsonValue(
            twin.last_dietary_feedback,
            null
          ),

        createdAt:
          twin.created_at,

        updatedAt:
          twin.updated_at,
      });
    } catch (error) {
      console.error(
        "Digital Twin retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve Digital Twin.",
      });
    }
  }
);

// ==================================================
// GET DIGITAL TWIN BY USER ID
// ==================================================

app.get(
  "/digital-twin/user/:userId",
  requireAuth,
  async (req, res) => {
    try {
      if (
        normalizeUserId(
          req.params.userId
        ) !==
        req.authUserId
      ) {
        return res.status(403).json({
          message:
            "You are not allowed to access this Digital Twin.",
        });
      }

      const userId =
        req.authUserId;

      const [rows] =
        await db.query(
          `
          SELECT *
          FROM digital_twins
          WHERE user_id = ?
          LIMIT 1
          `,
          [userId]
        );

      const twin =
        rows[0] || null;

      if (!twin) {
        return res.json({
          userId,

          feedbackCount: 0,

          healthProfile: null,

          medicalReportData: null,

          medicalReportAnalyzed: false,

          medicalReportUpdatedAt: null,

          dietaryFeedback: [],

          lastDietaryFeedback: null,
        });
      }

      res.json({
        userId:
          twin.user_id,

        patientName:
          twin.patient_name ||
          "",

        feedbackCount:
          twin.feedback_count || 0,

        healthProfile:
          parseJsonValue(
            twin.health_profile,
            null
          ),

        medicalReportData:
          parseJsonValue(
            twin.medical_report_data,
            null
          ),

        medicalReportAnalyzed:
          Boolean(
            twin.medical_report_analyzed
          ),

        medicalReportUpdatedAt:
          twin.medical_report_updated_at,

        dietaryFeedback:
          parseJsonValue(
            twin.dietary_feedback,
            []
          ),

        lastDietaryFeedback:
          parseJsonValue(
            twin.last_dietary_feedback,
            null
          ),

        createdAt:
          twin.created_at,

        updatedAt:
          twin.updated_at,
      });
    } catch (error) {
      console.error(
        "Digital Twin user retrieval error:",
        error
      );

      res.status(500).json({
        message:
          "Could not retrieve Digital Twin.",
      });
    }
  }
);

// ==================================================
// AI MEAL PLANNER
// ==================================================

app.post(
  "/meal-plan",
  requireAuth,
  async (req, res) => {
    try {
      const {
        goal,
        context,
        customization,
        mealPlanId,
      } = req.body;

      if (!goal) {
        return res.status(400).json({
          message:
            "Meal planning goal is required.",
        });
      }

      const cleanUserId =
        req.authUserId;

      const patient =
        await getAuthenticatedPatient(
          cleanUserId
        );

      if (!patient) {
        return res.status(404).json({
          message:
            "Health profile not found. Please complete your profile first.",
        });
      }

      const personalization =
        await getPersonalizationData(
          cleanUserId
        );

      const learning =
        buildFoodGenomeLearning(
          personalization.foodGenome
        );

      // ==================================================
      // CURRENT SAVED PLAN
      // ==================================================

      let currentSavedMealPlan =
        null;

      if (mealPlanId) {
        const [mealPlanRows] =
          await db.query(
            `
            SELECT *
            FROM meal_plans
            WHERE id = ?
              AND user_id = ?
            LIMIT 1
            `,
            [
              mealPlanId,
              cleanUserId,
            ]
          );

        const savedPlan =
          mealPlanRows[0] || null;

        if (!savedPlan) {
          return res.status(404).json({
            message:
              "The saved meal plan could not be found.",
          });
        }

        currentSavedMealPlan = {
          id:
            savedPlan.id,

          userId:
            savedPlan.user_id,

          patientName:
            savedPlan.patient_name ||
            "",

          goal:
            savedPlan.goal ||
            "",

          context:
            savedPlan.context ||
            "",

          customization:
            savedPlan.customization ||
            "",

          mealPlan:
            parseJsonValue(
              savedPlan.meal_plan,
              ""
            ),

          latestFeedback:
            parseJsonValue(
              savedPlan.latest_feedback,
              null
            ),

          feedbackHistory:
            parseJsonValue(
              savedPlan.feedback_history,
              []
            ),

          createdAt:
            savedPlan.created_at,

          updatedAt:
            savedPlan.updated_at,
        };
      }

      // ==================================================
      // PREVIOUS MEAL PLAN MEMORY
      // ==================================================

      const previousMealPlans =
        await getPreviousMealPlans(
          cleanUserId,
          mealPlanId
        );

      const previousMealPlanContext =
        previousMealPlans.length > 0
          ? previousMealPlans
              .map(
                (
                  plan,
                  index
                ) => `
PREVIOUS MEAL PLAN ${index + 1}

Goal:
${plan.goal || "Not recorded"}

Context:
${plan.context || "None"}

Customization:
${plan.customization || "None"}

Created:
${
  plan.createdAt
    ? new Date(
        plan.createdAt
      ).toISOString()
    : "Unknown"
}

Plan:
${plan.mealPlan || "No plan content"}

Previous feedback:
${
  plan.latestFeedback
    ? JSON.stringify(
        plan.latestFeedback
      )
    : "No feedback recorded"
}
`
              )
              .join("\n\n")
          : "No previous personalized meal plans have been saved yet.";

      // ==================================================
      // CURRENT PLAN CONTEXT
      // ==================================================

      const currentMealPlanContext =
        currentSavedMealPlan
          ? `
CURRENT SAVED MEAL PLAN BEING CUSTOMIZED

This is the exact meal plan that the user wants to
customize/update.

Saved Meal Plan ID:
${mealPlanId}

Original Goal:
${
  currentSavedMealPlan.goal ||
  "Not recorded"
}

Original Context:
${
  currentSavedMealPlan.context ||
  "None"
}

Previous Customization:
${
  currentSavedMealPlan.customization ||
  "None"
}

Current Saved Plan:
${
  currentSavedMealPlan.mealPlan ||
  "No plan content"
}

Latest Feedback:
${
  currentSavedMealPlan.latestFeedback
    ? JSON.stringify(
        currentSavedMealPlan.latestFeedback
      )
    : "No feedback recorded"
}
`
          : "There is no currently saved meal plan being customized.";

      // ==================================================
      // GEMINI PROMPT
      // ==================================================

      const prompt = `
You are an AI personalized dietary planning assistant.

Create a practical ONE-DAY meal plan.

PATIENT HEALTH PROFILE:
${JSON.stringify(
  patient,
  null,
  2
)}

DIGITAL TWIN:
${JSON.stringify(
  personalization.digitalTwin ||
    {},
  null,
  2
)}

FOOD GENOME:
${JSON.stringify(
  personalization.foodGenome ||
    {},
  null,
  2
)}

STRUCTURED FOOD GENOME LEARNING:
${JSON.stringify(
  learning,
  null,
  2
)}

PREVIOUS SAVED MEAL PLANS:
${previousMealPlanContext}

${currentMealPlanContext}

USER GOAL:
${goal}

CURRENT CONTEXT / DIETARY REQUIREMENTS:
${
  context ||
  "No additional context provided."
}

CUSTOMIZATION:
${
  customization ||
  "No customization requested."
}

==================================================
CURRENT PLAN UPDATE RULE
==================================================

If a CURRENT SAVED MEAL PLAN is provided:

The user is customizing that exact saved plan.

You MUST treat the CURRENT SAVED MEAL PLAN as the
starting point.

Do NOT create an unrelated new plan.

Update the existing plan according to the user's
customization request.

Preserve useful parts of the current plan unless the
customization requires changing them.

Return the COMPLETE updated one-day meal plan, not only
the changed section.

The saved plan will be updated under the same mealPlanId.

==================================================
PREVIOUS MEAL PLAN MEMORY
==================================================

Previous meal plans are stored dietary history.

Use them as additional context.

Do NOT blindly repeat the same complete meals from
previous plans when other suitable options are available.

You may reuse foods when they are appropriate, but try to
provide useful variety across future recommendations.

If the user explicitly asks for a previous meal or food,
it can be reused.

If a previous plan received negative feedback, avoid
repeating the aspects that were specifically associated
with that feedback.

If previous plans have no feedback, simply treat them as
historical context.

The previous plans are NOT medical instructions.

==================================================
CORE PERSONALIZATION PRINCIPLE
==================================================

LIKE DOES NOT AUTOMATICALLY MEAN SUITABLE.

A food can be loved or liked while also having negative
personal reactions.

Consider:

- portion size
- preparation
- frequency
- lighter alternatives
- other foods with similar nutritional purpose

==================================================
FOOD REACTION LEARNING
==================================================

Use explicitly recorded reactions.

Do not invent reactions.

Do not diagnose medical conditions from reactions.

If a reaction could represent a potentially serious allergic
or medical concern, do not diagnose it. Recommend appropriate
professional medical evaluation.

A single recorded experience should not permanently ban
a food.

Two or more recorded experiences should be treated as an
emerging personal pattern.

Three or more recorded experiences should be treated as a
stronger repeated personal pattern.

The number of experiences indicates learning strength.
Do not claim that different free-text reactions are identical
unless explicitly recorded that way.

==================================================
FOOD PREFERENCE RULES
==================================================

Use:

- loved foods
- liked foods
- neutral foods
- disliked foods

But NEVER use preference alone to determine suitability.

Priority should consider:

1. Explicit allergies
2. Explicit dietary restrictions
3. Explicit medical information
4. Previous negative reactions
5. Repeated personal patterns
6. Nutrition
7. Food preference

Disliked foods should generally not be recommended unless
explicitly requested.

Foods with repeated negative reactions should generally be
given lower priority even if they are liked.

==================================================
EXPLICIT FOOD REQUEST
==================================================

If the user explicitly requests a food that has previous
negative reactions, do not silently remove it.

If appropriate, include it with a clear caution and provide
a safer or lighter alternative.

==================================================
MEAL PLAN FEEDBACK
==================================================

Meal-plan feedback is learning about the quality and
suitability of previous meal plans.

Use it to improve future plans.

Do NOT treat "Personalized Meal Plan" as an actual food.

==================================================
DIGITAL TWIN
==================================================

Use the Digital Twin for health-related dietary context.

Only use information explicitly available in the profile,
medical report, or stored dietary experiences.

Do not invent medical information.

Do not diagnose diseases.

Do not promise medical outcomes.

==================================================
DIETARY REQUIREMENTS
==================================================

If vegan:

No meat, chicken, fish, seafood, eggs, milk, curd/yogurt,
paneer, cheese, butter, ghee, or other animal-derived foods.

If vegetarian:

No meat, chicken, fish, or seafood.

Eggs should only be included if explicitly allowed.

If an allergy or explicit food avoidance exists:
NEVER recommend that food or ingredient.

==================================================
CUSTOMIZATION
==================================================

Follow the user's customization request whenever it does not
conflict with health, allergy, or dietary restrictions.

The updated plan should actually reflect the customization.

==================================================
RESPONSE
==================================================

Return:

## Breakfast

## Mid-Morning Snack

## Lunch

## Evening Snack

## Dinner

## Why This Plan

Explain important personalization factors.

## Food Genome Considerations

Mention relevant preferences, previous reactions, and repeated
patterns that affected the plan.

If there are no relevant learned food patterns, say so.

## Alternatives

Give 2-3 alternatives.

## Missing Information

Mention important information that could improve personalization.

Clearly state that this is dietary guidance and not a replacement
for professional medical advice.
`;

      const response =
  await gemini.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt,
  });

      const generatedMealPlan =
        response.text || "";

      const now =
        new Date();

      let savedMealPlanId =
        null;

      // ==================================================
      // UPDATE EXISTING PLAN
      // ==================================================

      if (
        currentSavedMealPlan
      ) {
        // Store the previous version before replacing
        // the current plan.
        //
        // IMPORTANT:
        // The actual meal_plan_versions table uses
        // saved_at, not created_at.
        await db.query(
          `
          INSERT INTO meal_plan_versions (
            id,
            meal_plan_id,
            user_id,
            meal_plan,
            goal,
            context,
            customization,
            saved_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            crypto
              .randomBytes(24)
              .toString("hex"),

            currentSavedMealPlan.id,

            cleanUserId,

            toJsonString(
              currentSavedMealPlan.mealPlan ||
                ""
            ),

            currentSavedMealPlan.goal ||
              "",

            currentSavedMealPlan.context ||
              "",

            currentSavedMealPlan.customization ||
              "",

            currentSavedMealPlan.updatedAt ||
              currentSavedMealPlan.createdAt ||
              now,
          ]
        );

        await db.query(
          `
          UPDATE meal_plans
          SET
            patient_name = ?,
            goal = ?,
            context = ?,
            customization = ?,
            meal_plan = ?,
            updated_at = ?
          WHERE id = ?
            AND user_id = ?
          `,
          [
            patient.name || "",

            goal,

            String(
              context || ""
            ).trim(),

            String(
              customization || ""
            ).trim(),

            // meal_plan is a JSON column.
            // Store the generated text as a JSON string.
            toJsonString(
              generatedMealPlan
            ),

            now,

            currentSavedMealPlan.id,

            cleanUserId,
          ]
        );

        savedMealPlanId =
          currentSavedMealPlan.id;
      }

      // ==================================================
      // CREATE NEW PLAN
      // ==================================================

      if (!savedMealPlanId) {
        savedMealPlanId =
          crypto
            .randomBytes(24)
            .toString("hex");

        await db.query(
          `
          INSERT INTO meal_plans (
            id,
            user_id,
            patient_name,
            goal,
            context,
            customization,
            meal_plan,
            latest_feedback,
            feedback_history,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            savedMealPlanId,

            cleanUserId,

            patient.name || "",

            goal,

            String(
              context || ""
            ).trim(),

            String(
              customization || ""
            ).trim(),

            // meal_plan is a JSON column.
            toJsonString(
              generatedMealPlan
            ),

            null,

            toJsonString([]),

            now,

            now,
          ]
        );
      }

      console.log(
        `Meal plan saved successfully: ${savedMealPlanId}`
      );

      res.json({
        mealPlan:
          generatedMealPlan,

        mealPlanId:
          savedMealPlanId,

        saved:
          true,

        updated:
          Boolean(
            currentSavedMealPlan
          ),
      });
    } catch (error) {
      console.error(
        "Meal planner error:",
        error
      );

      const quotaMessage =
        getGeminiErrorMessage(
          error
        );

      res
        .status(
          quotaMessage
            ? 429
            : 500
        )
        .json({
          message:
            quotaMessage ||
            "Could not generate personalized meal plan.",
        });
    }
  }
);

// ==================================================
// PERSONALIZED AI ANALYSIS
// ==================================================

app.post(
  "/personalized-analysis",
  requireAuth,
  async (req, res) => {
    try {
      const {
        food,
        nutrition,
      } = req.body;

      if (
        !food ||
        !nutrition
      ) {
        return res.status(400).json({
          message:
            "Food and nutrition data are required.",
        });
      }

      const cleanUserId =
        req.authUserId;

      const patient =
        await getAuthenticatedPatient(
          cleanUserId
        );

      if (!patient) {
        return res.status(404).json({
          message:
            "Health profile not found. Please complete your profile first.",
        });
      }

      const personalization =
        await getPersonalizationData(
          cleanUserId
        );

      const learning =
        buildFoodGenomeLearning(
          personalization.foodGenome
        );

      const currentFoodName =
        String(
          food?.foodName ||
            ""
        )
          .trim()
          .toLowerCase();

      const currentFoodPatterns =
        learning.learnedPatterns.filter(
          (pattern) =>
            pattern.foodName
              .trim()
              .toLowerCase() ===
            currentFoodName
        );

      const currentFoodPreferences =
        learning.preferences.filter(
          (preference) =>
            preference.foodName
              .trim()
              .toLowerCase() ===
            currentFoodName
        );

      const prompt = `
You are a personalized dietary intelligence assistant.

Analyze this food for the user's health profile and previous
personal food experiences.

PATIENT HEALTH PROFILE:
${JSON.stringify(
  patient,
  null,
  2
)}

DIGITAL TWIN:
${JSON.stringify(
  personalization.digitalTwin ||
    {},
  null,
  2
)}

FOOD GENOME:
${JSON.stringify(
  personalization.foodGenome ||
    {},
  null,
  2
)}

STRUCTURED FOOD GENOME LEARNING:
${JSON.stringify(
  learning,
  null,
  2
)}

PREVIOUS PREFERENCES FOR CURRENT FOOD:
${JSON.stringify(
  currentFoodPreferences,
  null,
  2
)}

PREVIOUS EXPERIENCES WITH CURRENT FOOD:
${JSON.stringify(
  currentFoodPatterns,
  null,
  2
)}

IDENTIFIED FOOD:
${JSON.stringify(
  food,
  null,
  2
)}

NUTRITION:
${JSON.stringify(
  nutrition,
  null,
  2
)}

==================================================
CORE PERSONALIZATION PRINCIPLE
==================================================

LIKE DOES NOT AUTOMATICALLY MEAN SUITABLE.

A user can enjoy a food while also experiencing an unwanted
physical reaction.

Previous reactions should be considered separately from
food preferences.

==================================================
PREVIOUS FOOD EXPERIENCE
==================================================

If previous experiences exist for the current food:

1. Mention them when relevant.
2. Treat them as personal user-reported evidence.
3. Do not turn them into a medical diagnosis.
4. Do not invent additional symptoms.
5. Consider repeated experiences more strongly.

Do not assume a reaction is an allergy unless the user or
medical report explicitly identifies it as an allergy.

If the recorded reaction could indicate a potentially serious
allergic or medical issue, recommend appropriate professional
medical evaluation without diagnosing the user.

Learning strength:

1 experience:
single recorded experience

2 experiences:
emerging repeated pattern

3+ experiences:
strong repeated pattern

Do not claim that different free-text reactions are identical
unless explicitly stated by the user.

==================================================
PREFERENCE VS REACTION
==================================================

Keep these signals separate:

Preference:
- loved
- liked
- neutral
- disliked

Reaction:
- user-reported physical or experiential response

A positive preference must NOT override an important negative
personal reaction.

A negative reaction should influence suitability.

==================================================
SUITABILITY
==================================================

Choose one:

- Generally suitable
- Suitable with caution
- Less suitable

Base the assessment on:

1. Explicit allergies
2. Explicit dietary restrictions
3. Explicit medical information
4. Nutrition
5. Food Genome preference
6. Previous reactions
7. Repeated personal patterns

Do not diagnose.

Do not claim guaranteed medical outcomes.

==================================================
EXPLICIT REQUEST
==================================================

If the user explicitly asks for a food that has previous
negative reactions, do not silently prohibit it.

Instead:

- acknowledge the previous reaction
- explain the relevant caution
- suggest a modification or portion consideration when
  appropriate
- provide an alternative

==================================================
RESPONSE
==================================================

Provide:

## Suitability

State one of:
Generally suitable
Suitable with caution
Less suitable

## Reason

Explain why.

## Positive Points

Mention useful nutritional or dietary positives.

## Things to Watch

Mention relevant nutritional factors or previous personal
reactions.

## Recommendation

Give practical guidance.

## Personalization Insight

Explicitly mention previous experiences with this food when
available.

Do not invent this statement unless those reactions are actually
present in the stored data.

Clearly distinguish dietary guidance from medical advice.
`;

      const response =
        await gemini.models.generateContent({
          model:
            "gemini-3.5-flash",

          contents:
            prompt,
        });

      res.json({
        analysis:
          response.text,
      });
    } catch (error) {
      console.error(
        "Gemini personalized analysis error:",
        error
      );

      const quotaMessage =
        getGeminiErrorMessage(
          error
        );

      res
        .status(
          quotaMessage
            ? 429
            : 500
        )
        .json({
          message:
            quotaMessage ||
            "Could not generate personalized analysis.",
        });
    }
  }
);

// ==================================================
// START SERVER
// ==================================================

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    async () => {
      console.log(
        `Backend server running on port ${PORT}`
      );

      console.log(
        `Allowed frontend origin: ${CLIENT_URL}`
      );

      console.log(
        `Authentication: MySQL HTTP-only sessions`
      );

      await connectToDatabase();
    }
  );
server.on(
  "error",
  (error) => {
    console.error(
      "Server error:",
      error
    );
  }
);