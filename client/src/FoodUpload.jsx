import { useState } from "react";
import "./foodintelligence.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:5001";

const VERDICT_LABELS = {
  good: "Good choice",
  caution: "Eat with caution",
  avoid: "Better to avoid",
  insufficient_data: "Not enough information",
};

function formatValue(value, unit = "") {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function ConfidenceBar({ label, value }) {
  if (value === null || value === undefined) {
    return (
      <p className="fi-muted">
        {label}: confidence not provided
      </p>
    );
  }

  return (
    <div className="fi-confidence">
      <span>{label}</span>
      <div className="fi-bar">
        <div
          className="fi-bar-fill"
          style={{ width: `${value}%` }}
        />
      </div>
      <strong>{value}%</strong>
    </div>
  );
}

function IngredientPanel({ title, hint, items }) {
  return (
    <div className="fi-panel">
      <h3>{title}</h3>
      <p className="fi-muted">{hint}</p>
      {items.length === 0 ? (
        <p className="fi-muted">None listed.</p>
      ) : (
        <ul className="fi-chips">
          {items.map((item) => (
            <li key={item.name}>
              {item.name}
              {item.confidence !== null &&
                item.confidence !== undefined && (
                  <small> {item.confidence}%</small>
                )}
              {item.role && (
                <em> · {item.role}</em>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FoodUpload({
  onFoodUploaded,
  patientData,
}) {
  const [file, setFile] =
    useState(null);

  const [message, setMessage] =
    useState("");

  // Gemini food analysis (name, style, ingredients,
  // estimated serving + nutrition, limitations)
  const [foodResult, setFoodResult] =
    useState(null);

  // Output of the three AI agents
  const [agentResult, setAgentResult] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  function handleFileChange(e) {
    const selectedFile =
      e.target.files?.[0] || null;

    setFile(selectedFile);
    setMessage("");
    setFoodResult(null);
    setAgentResult(null);
  }

  // ==================================================
  // FLOW
  //
  // Upload -> Gemini recognition + nutrition estimate
  //        -> Agent 1 (personal evidence / agentic RAG)
  //        -> Agent 2 (food variants)
  //        -> Agent 3 (verdict)
  //        -> User feedback
  // ==================================================

  async function handleSubmit(e) {
    e.preventDefault();

    if (!file) {
      setMessage(
        "Please select a food image first."
      );
      return;
    }

    if (!patientData?.userId) {
      setMessage(
        "No user account was found. Please log in again."
      );
      return;
    }

    setLoading(true);
    setMessage(
      "Identifying the food and estimating nutrition..."
    );
    setFoodResult(null);
    setAgentResult(null);

    const formData = new FormData();
    formData.append("foodImage", file);

    try {
      // STEP 1 - Gemini food recognition
      const recognitionResponse =
        await fetch(
          `${API_URL}/recognize-food`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
          }
        );

      const recognitionData =
        await recognitionResponse.json();

      if (!recognitionResponse.ok) {
        setMessage(
          recognitionData.message ||
            "Food recognition failed."
        );
        return;
      }

      setFoodResult(recognitionData);

      // STEP 2 - the three agents
      setMessage(
        "Food identified. AI agents are checking your profile, report and food history..."
      );

      const agentResponse = await fetch(
        `${API_URL}/food-agents/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            foodImageId:
              recognitionData.foodImageId,
          }),
        }
      );

      const agentData =
        await agentResponse.json();

      if (!agentResponse.ok) {
        setMessage(
          agentData.message ||
            "Food was identified, but the personalized analysis could not be completed."
        );
        return;
      }

      setAgentResult(agentData);

      setMessage(
        agentData.agentErrors &&
          Object.keys(agentData.agentErrors)
            .length > 0
          ? "Analysis finished, but some AI agents had problems (see below)."
          : "Personalized food analysis completed successfully."
      );
    } catch (error) {
      console.error(
        "Food analysis error:",
        error
      );

      setMessage(
        "Could not connect to the food intelligence service."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleContinueToFeedback() {
    if (!foodResult?.foodName) {
      return;
    }

    if (onFoodUploaded) {
      onFoodUploaded({
        foodName: foodResult.foodName,
        recognitionScore:
          foodResult.score ?? null,
        nutrition:
          foodResult.analysis
            ?.nutritionEstimate || null,
      });
    }
  }

  const analysis = foodResult?.analysis;
  const verdict = agentResult?.verdict;
  const context =
    agentResult?.personalContext;
  const variants =
    agentResult?.variants;

  const variantVerdicts = {};
  (verdict?.variantVerdicts || []).forEach(
    (item) => {
      variantVerdicts[
        item.variantName.toLowerCase()
      ] = item;
    }
  );

  return (
    <div className="food-page">

      <div className="food-card">

        {/* ==================================================
            BRAND
        ================================================== */}

        <div className="food-logo">

          <span className="logo-icon">
            AI
          </span>

          <span>
            Dietary Intelligence
          </span>

        </div>

        {/* ==================================================
            HEADER
        ================================================== */}

        <p className="section-label">
          FOOD INTELLIGENCE
        </p>

        <h1>
          Can I Eat This?
        </h1>

        <p className="food-subtitle">
          Upload a photo of the food you are
          about to eat. AI identifies the food,
          its style and ingredients, estimates
          its nutrition, and three AI agents
          check it against your health profile,
          medical report and food history.
        </p>

        {/* ==================================================
            PROCESS INDICATOR
        ================================================== */}

        <div className="food-process">

          <span>
            Upload
          </span>

          <span>
            →
          </span>

          <span>
            Recognize
          </span>

          <span>
            →
          </span>

          <span>
            Estimate
          </span>

          <span>
            →
          </span>

          <span>
            AI Agents
          </span>

          <span>
            →
          </span>

          <span>
            Feedback
          </span>

        </div>

        {/* ==================================================
            UPLOAD FORM
        ================================================== */}

        <form
          onSubmit={handleSubmit}
        >

          <label className="food-upload-area">

            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              onChange={
                handleFileChange
              }
              disabled={loading}
            />

            <div className="food-upload-icon">
              ↑
            </div>

            <h3>
              Upload Food Image
            </h3>

            <p>
              Click to select a clear photo
              of your food.
            </p>

            <span>
              JPG, PNG or WEBP (max 8 MB)
            </span>

          </label>

          {/* ==================================================
              SELECTED FILE
          ================================================== */}

          {file && (
            <div className="food-selected-file">

              <span>
                Selected image:
              </span>

              <strong>
                {file.name}
              </strong>

            </div>
          )}

          {/* ==================================================
              ANALYZE BUTTON
          ================================================== */}

          <button
            type="submit"
            className="food-button"
            disabled={loading}
          >
            {loading
              ? "Analyzing Food..."
              : "Analyze Food →"}
          </button>

        </form>

        {/* ==================================================
            STATUS
        ================================================== */}

        {message && (
          <p className="profile-message">
            {message}
          </p>
        )}

        {/* ==================================================
            1. FOOD IDENTIFICATION
        ================================================== */}

        {analysis && (
          <div className="food-result">
            <p className="section-label">
              FOOD IDENTIFICATION
            </p>

            <h2>{analysis.foodName}</h2>

            <p>
              <strong>Style:</strong>{" "}
              {analysis.foodStyle ||
                "Could not determine"}
              {analysis.cuisine
                ? ` · ${analysis.cuisine} cuisine`
                : ""}
            </p>

            <ConfidenceBar
              label="Food confidence"
              value={
                analysis.confidence.food
              }
            />
            <ConfidenceBar
              label="Style confidence"
              value={
                analysis.confidence.style
              }
            />

            {analysis.notes && (
              <p className="fi-muted">
                {analysis.notes}
              </p>
            )}
          </div>
        )}

        {/* ==================================================
            2. INGREDIENTS (three separate lists)
        ================================================== */}

        {analysis && (
          <div className="food-result">
            <p className="section-label">
              INGREDIENTS
            </p>

            <h2>What is in this food?</h2>

            <div className="fi-grid">
              <IngredientPanel
                title="Visible"
                hint="Clearly seen in the photo."
                items={
                  analysis.ingredients
                    .visible
                }
              />
              <IngredientPanel
                title="Suspected"
                hint="Not clearly visible, but likely present."
                items={
                  analysis.ingredients
                    .suspected
                }
              />
              <IngredientPanel
                title="Traditional"
                hint="Normally used in this exact food and style."
                items={
                  analysis.ingredients
                    .traditional
                }
              />
            </div>
          </div>
        )}

        {/* ==================================================
            3. ESTIMATED SERVING + NUTRITION
        ================================================== */}

        {analysis && (
          <div className="nutrition-result">
            <p className="section-label">
              NUTRITION (ESTIMATE)
            </p>

            <h2>
              Estimated Serving &amp;
              Nutrition
            </h2>

            <p>
              <strong>
                Estimated serving:
              </strong>{" "}
              {analysis.estimatedServing
                .description ||
                "Not estimated"}
              {analysis.estimatedServing
                .grams
                ? ` (about ${analysis.estimatedServing.grams} g)`
                : ""}
            </p>

            <ConfidenceBar
              label="Serving confidence"
              value={
                analysis.estimatedServing
                  .confidence
              }
            />

            <div className="nutrition-grid">
              {[
                ["Calories", analysis.nutritionEstimate.calories, "kcal"],
                ["Protein", analysis.nutritionEstimate.protein_g, "g"],
                ["Carbohydrates", analysis.nutritionEstimate.carbohydrates_g, "g"],
                ["Fat", analysis.nutritionEstimate.fat_g, "g"],
                ["Saturated fat", analysis.nutritionEstimate.saturated_fat_g, "g"],
                ["Fiber", analysis.nutritionEstimate.fiber_g, "g"],
                ["Sugar", analysis.nutritionEstimate.sugar_g, "g"],
                ["Sodium", analysis.nutritionEstimate.sodium_mg, "mg"],
                ["Cholesterol", analysis.nutritionEstimate.cholesterol_mg, "mg"],
              ].map(([label, value, unit]) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <span>
                    ≈ {formatValue(value, unit)}
                  </span>
                </div>
              ))}
            </div>

            {analysis.nutritionEstimate
              .otherNutrients.length >
              0 && (
              <p className="fi-muted">
                Other (estimated):{" "}
                {analysis.nutritionEstimate.otherNutrients
                  .map(
                    (n) =>
                      `${n.name} ≈ ${n.amount} ${n.unit}`
                  )
                  .join(", ")}
              </p>
            )}

            <ConfidenceBar
              label="Nutrition confidence"
              value={
                analysis.nutritionEstimate
                  .confidence
              }
            />

            <p className="nutrition-note">
              All serving sizes and nutrition
              values are AI estimates made from
              a photo, not exact measurements.
            </p>
          </div>
        )}

        {/* ==================================================
            4. LIMITATIONS
        ================================================== */}

        {analysis && (
          <div className="food-result">
            <p className="section-label">
              LIMITATIONS
            </p>

            <h2>
              What this analysis cannot know
            </h2>

            <ul className="fi-list">
              {analysis.limitations.map(
                (item) => (
                  <li key={item}>{item}</li>
                )
              )}
            </ul>
          </div>
        )}

        {/* ==================================================
            5. AGENT 3 - VERDICT
        ================================================== */}

        {agentResult?.agentErrors &&
          Object.keys(
            agentResult.agentErrors
          ).length > 0 && (
            <div className="fi-warning">
              Some AI agents could not finish:{" "}
              {Object.keys(
                agentResult.agentErrors
              ).join(", ")}
              . Results below may be less
              complete.
            </div>
          )}

        {verdict && (
          <div className="food-result">
            <p className="section-label">
              VERDICT FOR YOU
            </p>

            <div
              className={`fi-verdict fi-verdict-${verdict.overallVerdict}`}
            >
              <strong>
                {VERDICT_LABELS[
                  verdict.overallVerdict
                ] || verdict.overallVerdict}
              </strong>
              <span>{verdict.headline}</span>
            </div>

            <ConfidenceBar
              label="Verdict confidence"
              value={verdict.confidence}
            />

            {verdict.reasons.length > 0 && (
              <>
                <h3>Why</h3>
                <ul className="fi-list">
                  {verdict.reasons.map(
                    (reason, index) => (
                      <li
                        key={index}
                        className={`fi-sev-${reason.severity}`}
                      >
                        {reason.point}
                        {reason.evidenceSource && (
                          <small>
                            {" "}
                            ({reason.evidenceSource})
                          </small>
                        )}
                      </li>
                    )
                  )}
                </ul>
              </>
            )}

            {verdict.ingredientsOfConcern
              .length > 0 && (
              <p>
                <strong>
                  Ingredients of concern:
                </strong>{" "}
                {verdict.ingredientsOfConcern.join(
                  ", "
                )}
              </p>
            )}

            {verdict.recommendedPortion && (
              <p>
                <strong>
                  Suggested portion:
                </strong>{" "}
                {verdict.recommendedPortion}
              </p>
            )}

            {verdict.saferAlternatives.length >
              0 && (
              <p>
                <strong>
                  Safer alternatives:
                </strong>{" "}
                {verdict.saferAlternatives.join(
                  ", "
                )}
              </p>
            )}

            {verdict.missingInformation
              .length > 0 && (
              <p className="fi-muted">
                Would improve accuracy:{" "}
                {verdict.missingInformation.join(
                  "; "
                )}
              </p>
            )}

            <p className="nutrition-note">
              {verdict.disclaimer}
            </p>
          </div>
        )}

        {/* ==================================================
            6. AGENT 1 - PERSONAL EVIDENCE
        ================================================== */}

        {context && (
          <div className="food-result">
            <p className="section-label">
              YOUR PERSONAL EVIDENCE
            </p>

            <h2>
              What the AI looked at about you
            </h2>

            {context.evidenceSummary && (
              <p>{context.evidenceSummary}</p>
            )}

            {context.relevantConditions
              .length > 0 && (
              <>
                <h3>Relevant conditions</h3>
                <ul className="fi-list">
                  {context.relevantConditions.map(
                    (item, i) => (
                      <li key={i}>
                        {item.condition}
                        {item.why_relevant
                          ? `: ${item.why_relevant}`
                          : ""}
                      </li>
                    )
                  )}
                </ul>
              </>
            )}

            {context.pastReactionsToThisFood
              .length > 0 && (
              <>
                <h3>Your past reactions</h3>
                <ul className="fi-list">
                  {context.pastReactionsToThisFood.map(
                    (item, i) => (
                      <li key={i}>
                        {item.reaction}
                        {item.note
                          ? ` - ${item.note}`
                          : ""}
                      </li>
                    )
                  )}
                </ul>
              </>
            )}

            {context.similarFoodEvidence
              .length > 0 && (
              <>
                <h3>
                  Similar foods you have eaten
                </h3>
                <ul className="fi-list">
                  {context.similarFoodEvidence.map(
                    (item, i) => (
                      <li key={i}>
                        {item.food}
                        {item.shared_ingredients
                          ? ` (shares: ${item.shared_ingredients})`
                          : ""}
                        {item.past_reaction
                          ? ` - ${item.past_reaction}`
                          : ""}
                      </li>
                    )
                  )}
                </ul>
              </>
            )}

            <p className="fi-muted">
              Data sources checked:{" "}
              {[
                ...new Set(
                  (context.toolsUsed || []).map(
                    (t) =>
                      t.tool.replace(/_/g, " ")
                  )
                ),
              ].join(", ") || "none"}
            </p>
          </div>
        )}

        {/* ==================================================
            7. AGENT 2 - FOOD VARIANTS
        ================================================== */}

        {variants && (
          <div className="food-result">
            <p className="section-label">
              FOOD VARIANTS
            </p>

            <h2>
              Other versions of this food
            </h2>

            <div className="fi-grid">
              {variants.map((variant) => {
                const vv =
                  variantVerdicts[
                    variant.name.toLowerCase()
                  ];

                return (
                  <div
                    className="fi-panel"
                    key={variant.name}
                  >
                    <h3>
                      {variant.name}
                      {variant.matchesUploadedFood && (
                        <small>
                          {" "}
                          (closest to your photo)
                        </small>
                      )}
                    </h3>

                    <p className="fi-muted">
                      {variant.regionOrStyle}
                    </p>
                    <p>{variant.description}</p>

                    {variant.ingredientChanges
                      .added.length > 0 && (
                      <p>
                        <strong>Adds:</strong>{" "}
                        {variant.ingredientChanges.added.join(
                          ", "
                        )}
                      </p>
                    )}
                    {variant.ingredientChanges
                      .removed.length > 0 && (
                      <p>
                        <strong>Removes:</strong>{" "}
                        {variant.ingredientChanges.removed.join(
                          ", "
                        )}
                      </p>
                    )}

                    <p className="fi-muted">
                      vs your photo - calories:{" "}
                      {
                        variant.nutritionVsUploaded
                          .calories
                      }
                      , carbs:{" "}
                      {
                        variant.nutritionVsUploaded
                          .carbohydrates
                      }
                      , fat:{" "}
                      {
                        variant.nutritionVsUploaded
                          .fat
                      }
                    </p>

                    {vv && (
                      <p
                        className={`fi-variant-verdict fi-verdict-${vv.verdict}`}
                      >
                        {VERDICT_LABELS[
                          vv.verdict
                        ] || vv.verdict}
                        {vv.reason
                          ? `: ${vv.reason}`
                          : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================================================
            SHARED USER FEEDBACK
        ================================================== */}

        {foodResult && (
          <div className="food-result">
            <div className="food-feedback-next">
              <p className="section-label">
                NEXT STEP
              </p>

              <h3>Tell Your Food Genome</h3>

              <p className="food-subtitle">
                After eating this food, record how
                you felt. Your preference and
                physical reaction are stored
                separately so future decisions
                become more personalized.
              </p>

              <button
                type="button"
                className="food-button"
                onClick={
                  handleContinueToFeedback
                }
              >
                Continue to Feedback →
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}

export default FoodUpload;