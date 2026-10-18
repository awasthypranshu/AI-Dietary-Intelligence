import {
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import "./foodgenome.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:5001";

const EMPTY_ARRAY = [];

function FoodGenome({
  patientData,
  onContinue,
}) {
  const [foodGenome, setFoodGenome] =
    useState(null);

  const [mealPlans, setMealPlans] =
    useState([]);

  const [selectedMealPlan, setSelectedMealPlan] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  // ==================================================
  // LOAD FOOD GENOME + SAVED MEAL PLANS
  // ==================================================

  useEffect(() => {
    async function loadFoodGenome() {
      const userId =
        patientData?.userId;

      if (!userId) {
        setLoading(false);
        setMessage(
          "No user account was found. Please log in again."
        );
        return;
      }

      setLoading(true);
      setMessage("");

      try {
        const [
          genomeResponse,
          mealPlansResponse,
        ] = await Promise.all([
          fetch(
            `${API_URL}/food-genome/user/${encodeURIComponent(
              userId
            )}`,
            {
              method: "GET",
              credentials: "include",
            }
          ),

          fetch(
            `${API_URL}/meal-plans/user/${encodeURIComponent(
              userId
            )}`,
            {
              method: "GET",
              credentials: "include",
            }
          ),
        ]);

        const genomeData =
          await genomeResponse.json();

        const mealPlansData =
          await mealPlansResponse.json();

        if (!genomeResponse.ok) {
          setMessage(
            genomeData.message ||
              "Could not load Food Genome data."
          );
          return;
        }

        if (!mealPlansResponse.ok) {
          setMessage(
            mealPlansData.message ||
              "Could not load saved meal plans."
          );
          return;
        }

        setFoodGenome(
          genomeData
        );

        setMealPlans(
          Array.isArray(
            mealPlansData.mealPlans
          )
            ? mealPlansData.mealPlans
            : []
        );
      } catch (error) {
        console.error(
          "Food Genome loading error:",
          error
        );

        setMessage(
          "Could not connect to the Food Genome service."
        );
      } finally {
        setLoading(false);
      }
    }

    loadFoodGenome();
  }, [patientData?.userId]);

  // ==================================================
  // BASIC DATA
  // ==================================================

  const totalFeedback =
    Number(foodGenome?.totalFeedback) || 0;

  const lovedFoods =
    Array.isArray(foodGenome?.lovedFoods)
      ? foodGenome.lovedFoods
      : EMPTY_ARRAY;

  const likedFoods =
    Array.isArray(foodGenome?.likedFoods)
      ? foodGenome.likedFoods
      : EMPTY_ARRAY;

  const neutralFoods =
    Array.isArray(foodGenome?.neutralFoods)
      ? foodGenome.neutralFoods
      : EMPTY_ARRAY;

  const dislikedFoods =
    Array.isArray(foodGenome?.dislikedFoods)
      ? foodGenome.dislikedFoods
      : EMPTY_ARRAY;

  const reactions =
    Array.isArray(foodGenome?.reactions)
      ? foodGenome.reactions
      : EMPTY_ARRAY;

  const foods =
    Array.isArray(foodGenome?.foods)
      ? foodGenome.foods
      : EMPTY_ARRAY;

  const mealPlanFeedback =
    Array.isArray(
      foodGenome?.mealPlanFeedback
    )
      ? foodGenome.mealPlanFeedback
      : Array.isArray(
          foodGenome?.mealPlans
        )
      ? foodGenome.mealPlans
      : Array.isArray(
          foodGenome?.mealPlanExperiences
        )
      ? foodGenome.mealPlanExperiences
      : [];

  // ==================================================
  // HELPERS
  // ==================================================

  function normalizeFoodName(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return date.toLocaleDateString(
      undefined,
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    );
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return date.toLocaleString(
      undefined,
      {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }
    );
  }

  // ==================================================
  // CONSOLIDATED FOOD PROFILES
  // ==================================================

  const foodProfiles =
    useMemo(() => {
      const groups =
        new Map();

      function ensureFood(
        foodName
      ) {
        const key =
          normalizeFoodName(
            foodName
          );

        if (!key) {
          return null;
        }

        if (!groups.has(key)) {
          groups.set(key, {
            foodName:
              String(foodName).trim(),
            preference: null,
            reactions: [],
            experiences: [],
          });
        }

        return groups.get(key);
      }

      const preferenceGroups = [
        {
          preference: "Loved",
          items: lovedFoods,
        },
        {
          preference: "Liked",
          items: likedFoods,
        },
        {
          preference: "Neutral",
          items: neutralFoods,
        },
        {
          preference: "Disliked",
          items: dislikedFoods,
        },
      ];

      preferenceGroups.forEach(
        ({
          preference,
          items,
        }) => {
          items.forEach(
            (item) => {
              const food =
                ensureFood(
                  item?.foodName
                );

              if (!food) {
                return;
              }

              food.preference =
                preference;
            }
          );
        }
      );

      reactions.forEach(
        (item) => {
          const food =
            ensureFood(
              item?.foodName
            );

          if (!food) {
            return;
          }

          if (
            item?.reaction
          ) {
            food.reactions.push({
              reaction:
                String(
                  item.reaction
                ).trim(),
              status:
                item.status ||
                "",
              date:
                item.createdAt ||
                item.date ||
                null,
            });
          }

          food.experiences.push(
            item
          );
        }
      );

      foods.forEach(
        (item) => {
          const food =
            ensureFood(
              item?.foodName
            );

          if (!food) {
            return;
          }

          food.experiences.push(
            item
          );
        }
      );

      return Array.from(
        groups.values()
      )
        .map((food) => {
          const reactionCounts =
            new Map();

          food.reactions.forEach(
            (item) => {
              const key =
                normalizeFoodName(
                  item.reaction
                );

              if (!key) {
                return;
              }

              const existing =
                reactionCounts.get(
                  key
                );

              if (existing) {
                existing.count += 1;

                if (
                  !existing.latestDate &&
                  item.date
                ) {
                  existing.latestDate =
                    item.date;
                }
              } else {
                reactionCounts.set(
                  key,
                  {
                    reaction:
                      item.reaction,
                    count: 1,
                    latestDate:
                      item.date ||
                      null,
                  }
                );
              }
            }
          );

          const consolidatedReactions =
            Array.from(
              reactionCounts.values()
            ).sort(
              (a, b) =>
                b.count -
                a.count
            );

          return {
            ...food,
            reactions:
              consolidatedReactions,
            experienceCount:
              Math.max(
                food.experiences
                  .length,
                food.reactions
                  .length
              ),
          };
        })
        .sort(
          (a, b) =>
            b.experienceCount -
            a.experienceCount
        );
    }, [
      lovedFoods,
      likedFoods,
      neutralFoods,
      dislikedFoods,
      reactions,
      foods,
    ]);

  // ==================================================
  // RECENT FOOD EXPERIENCES
  // ==================================================

  const recentFoods =
    useMemo(() => {
      return foods
        .slice()
        .reverse()
        .slice(0, 8);
    }, [foods]);

  // ==================================================
  // LEARNED FOOD PATTERNS
  // ==================================================

  const learnedPatterns =
    useMemo(() => {
      return foodProfiles
        .filter(
          (food) =>
            food.reactions
              .length > 0
        )
        .map((food) => {
          const totalReactions =
            food.reactions.reduce(
              (sum, item) =>
                sum + item.count,
              0
            );

          let strength =
            "Single recorded experience";

          if (
            totalReactions >= 3
          ) {
            strength =
              "Strong repeated pattern";
          } else if (
            totalReactions === 2
          ) {
            strength =
              "Emerging repeated pattern";
          }

          const strongestReaction =
            food.reactions[0];

          return {
            foodName:
              food.foodName,
            preference:
              food.preference,
            totalReactions,
            strongestReaction,
            strength,
          };
        });
    }, [foodProfiles]);

  const uniqueFoodCount =
    foodProfiles.length;

  // ==================================================
  // PREFERENCE CHIP RENDERER
  // ==================================================

  function renderPreferenceFoods(
    items
  ) {
    const uniqueNames =
      Array.from(
        new Set(
          items
            .map(
              (item) =>
                item?.foodName
            )
            .filter(Boolean)
            .map((name) =>
              String(name).trim()
            )
        )
      );

    if (
      uniqueNames.length === 0
    ) {
      return (
        <p className="fg-empty-inline">
          Nothing recorded yet.
        </p>
      );
    }

    const visible =
      uniqueNames.slice(0, 12);

    const remaining =
      uniqueNames.length -
      visible.length;

    return (
      <>
        <div className="fg-chip-container">
          {visible.map(
            (name) => (
              <span
                className="fg-food-chip"
                key={name}
              >
                {name}
              </span>
            )
          )}
        </div>

        {remaining > 0 && (
          <div className="fg-more">
            +{remaining} more
          </div>
        )}
      </>
    );
  }

  // ==================================================
  // OPEN SAVED MEAL PLAN
  // ==================================================

  function openMealPlan(plan) {
    setSelectedMealPlan(
      plan
    );
  }

  function closeMealPlan() {
    setSelectedMealPlan(
      null
    );
  }

  // ==================================================
  // LOADING
  // ==================================================

  if (loading) {
    return (
      <div className="fg-page">
        <div className="fg-container">
          <div className="fg-loading">
            <div className="fg-spinner"></div>

            <h2>
              Loading your Food Genome
            </h2>

            <p>
              Retrieving your food
              preferences, reactions,
              meal plans, and dietary
              learning.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================
  // UI
  // ==================================================

  return (
    <div className="fg-page">
      <div className="fg-container">

        {/* ==================================================
            HERO
        ================================================== */}

        <section className="fg-hero">

          <div className="fg-hero-copy">

            <div className="fg-eyebrow">
              PERSONALIZED FOOD PROFILE
            </div>

            <h1>
              Your Food Genome
            </h1>

            <p>
              A structured view of your
              food preferences, experiences,
              physical reactions, meal plans,
              and dietary learning.
            </p>

          </div>

          <div className="fg-active-pill">
            <span></span>
            Food Genome Active
          </div>

        </section>

        {message && (
          <div className="fg-error">
            {message}
          </div>
        )}

        {/* ==================================================
            01 — OVERVIEW
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow">
              OVERVIEW
            </div>

            <h2>
              Your Dietary Profile
            </h2>

            <p>
              The key signals your Food
              Genome has collected so far.
            </p>

          </div>

          <div className="fg-stats-grid">

            <div className="fg-stat-card fg-stat-green">
              <div className="fg-stat-number">
                {totalFeedback}
              </div>

              <div className="fg-stat-label">
                Food interactions
              </div>

              <div className="fg-stat-description">
                Recorded feedback
              </div>
            </div>

            <div className="fg-stat-card fg-stat-orange">
              <div className="fg-stat-number">
                {reactions.length}
              </div>

              <div className="fg-stat-label">
                Recorded reactions
              </div>

              <div className="fg-stat-description">
                Food experiences
              </div>
            </div>

            <div className="fg-stat-card fg-stat-blue">
              <div className="fg-stat-number">
                {uniqueFoodCount}
              </div>

              <div className="fg-stat-label">
                Unique foods
              </div>

              <div className="fg-stat-description">
                Consolidated profiles
              </div>
            </div>

            <div className="fg-stat-card fg-stat-purple">
              <div className="fg-stat-number">
                {mealPlans.length}
              </div>

              <div className="fg-stat-label">
                Saved meal plans
              </div>

              <div className="fg-stat-description">
                Personalized plans remembered
              </div>
            </div>

          </div>

        </section>

        {/* ==================================================
            02 — PREFERENCES
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-pink">
              PREFERENCES
            </div>

            <h2>
              Foods You Prefer
            </h2>

            <p>
              Your personal preference is
              kept separate from physical
              reactions.
            </p>

          </div>

          <div className="fg-preference-grid">

            <div className="fg-preference-card fg-card-loved">

              <div className="fg-preference-card-header">

                <div className="fg-preference-icon">
                  L
                </div>

                <div>
                  <h3>
                    Loved Foods
                  </h3>

                  <span>
                    Foods you enjoy most
                  </span>
                </div>

              </div>

              {renderPreferenceFoods(
                lovedFoods
              )}

            </div>

            <div className="fg-preference-card fg-card-liked">

              <div className="fg-preference-card-header">

                <div className="fg-preference-icon">
                  +
                </div>

                <div>
                  <h3>
                    Liked Foods
                  </h3>

                  <span>
                    Foods you generally enjoy
                  </span>
                </div>

              </div>

              {renderPreferenceFoods(
                likedFoods
              )}

            </div>

            <div className="fg-preference-card fg-card-neutral">

              <div className="fg-preference-card-header">

                <div className="fg-preference-icon">
                  N
                </div>

                <div>
                  <h3>
                    Neutral Foods
                  </h3>

                  <span>
                    No strong preference
                  </span>
                </div>

              </div>

              {renderPreferenceFoods(
                neutralFoods
              )}

            </div>

            <div className="fg-preference-card fg-card-disliked">

              <div className="fg-preference-card-header">

                <div className="fg-preference-icon">
                  D
                </div>

                <div>
                  <h3>
                    Disliked Foods
                  </h3>

                  <span>
                    Foods you tend to avoid
                  </span>

                </div>

              </div>

              {renderPreferenceFoods(
                dislikedFoods
              )}

            </div>

          </div>

        </section>

        {/* ==================================================
            03 — INDIVIDUAL FOOD PROFILES
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-blue">
              FOOD PROFILES
            </div>

            <h2>
              Your Foods, Organized
            </h2>

            <p>
              Each food gets its own profile.
              Repeated experiences are
              consolidated instead of being
              displayed as duplicate entries.
            </p>

          </div>

          {foodProfiles.length > 0 ? (
            <div className="fg-food-grid">

              {foodProfiles.map(
                (food) => (
                  <div
                    className="fg-food-profile"
                    key={food.foodName}
                  >

                    <div className="fg-food-profile-header">

                      <div>
                        <h3>
                          {food.foodName}
                        </h3>

                        <p>
                          {food.experienceCount}{" "}
                          recorded{" "}
                          {food.experienceCount ===
                          1
                            ? "experience"
                            : "experiences"}
                        </p>
                      </div>

                      {food.preference && (
                        <span
                          className={`fg-preference ${
                            food.preference ===
                            "Loved"
                              ? "fg-loved"
                              : food.preference ===
                                "Liked"
                              ? "fg-liked"
                              : food.preference ===
                                "Neutral"
                              ? "fg-neutral"
                              : "fg-disliked"
                          }`}
                        >
                          {food.preference}
                        </span>
                      )}

                    </div>

                    <div className="fg-card-divider"></div>

                    <div className="fg-profile-label">
                      PHYSICAL REACTIONS
                    </div>

                    {food.reactions.length >
                    0 ? (
                      <div className="fg-reaction-items">

                        {food.reactions
                          .slice(0, 5)
                          .map(
                            (
                              reaction
                            ) => (
                              <div
                                className="fg-reaction-item"
                                key={
                                  reaction.reaction
                                }
                              >

                                <span>
                                  {
                                    reaction.reaction
                                  }
                                </span>

                                <strong>
                                  ×
                                  {
                                    reaction.count
                                  }
                                </strong>

                              </div>
                            )
                          )}

                      </div>
                    ) : (
                      <p className="fg-no-data">
                        No physical reaction
                        recorded for this food.
                      </p>
                    )}

                    {food.reactions.length >
                      0 && (
                      <div className="fg-pattern-highlight">

                        <div className="fg-pattern-icon">
                          AI
                        </div>

                        <div>
                          <span>
                            CURRENT SIGNAL
                          </span>

                          <strong>
                            {food.reactions[0]
                              .reaction}
                            {food.reactions[0]
                              .count > 1
                              ? ` · recorded ${food.reactions[0].count} times`
                              : ""}
                          </strong>
                        </div>

                      </div>
                    )}

                    {food.experienceCount >
                      0 && (
                      <div className="fg-latest-row">
                        <span>
                          Profile status
                        </span>

                        <strong>
                          Personal food
                          history active
                        </strong>
                      </div>
                    )}

                  </div>
                )
              )}

            </div>
          ) : (
            <div className="fg-empty-card">

              <div className="fg-empty-icon">
                AI
              </div>

              <h3>
                No Food Profiles Yet
              </h3>

              <p>
                Upload a food, complete the
                analysis, and record your
                experience to start building
                your personalized food profiles.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            04 — FOOD REACTIONS
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-orange">
              FOOD REACTIONS
            </div>

            <h2>
              How Foods Affect You
            </h2>

            <p>
              Physical reactions are tracked
              separately from whether you like
              a food.
            </p>

          </div>

          {foodProfiles.some(
            (food) =>
              food.reactions.length >
              0
          ) ? (
            <div className="fg-reaction-grid">

              {foodProfiles
                .filter(
                  (food) =>
                    food.reactions
                      .length > 0
                )
                .slice(0, 6)
                .map(
                  (food) => (
                    <div
                      className="fg-reaction-summary-card"
                      key={
                        food.foodName
                      }
                    >

                      <div className="fg-reaction-symbol">
                        R
                      </div>

                      <div className="fg-reaction-summary-content">

                        <h3>
                          {food.foodName}
                        </h3>

                        <strong>
                          {
                            food.reactions
                              .length
                          }{" "}
                          reaction{" "}
                          {food.reactions
                            .length ===
                          1
                            ? "type"
                            : "types"}
                        </strong>

                        {food.reactions
                          .slice(0, 3)
                          .map(
                            (
                              reaction
                            ) => (
                              <p
                                key={
                                  reaction.reaction
                                }
                              >
                                {
                                  reaction.reaction
                                }{" "}
                                ×{" "}
                                {
                                  reaction.count
                                }
                              </p>
                            )
                          )}

                        <small>
                          Preference and
                          physical response
                          are evaluated
                          separately.
                        </small>

                      </div>

                    </div>
                  )
                )}

            </div>
          ) : (
            <div className="fg-empty-card">

              <div className="fg-empty-icon">
                R
              </div>

              <h3>
                No Physical Reactions Recorded
              </h3>

              <p>
                Record how you feel after
                eating a food. These reactions
                will be connected to the
                appropriate food profile.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            05 — RECENT FOOD EXPERIENCE
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-yellow">
              RECENT FOOD EXPERIENCE
            </div>

            <h2>
              Recent Food History
            </h2>

            <p>
              A compact view of your latest
              food experiences.
            </p>

          </div>

          {recentFoods.length > 0 ? (
            <div className="fg-reaction-grid">

              {recentFoods.map(
                (item, index) => (
                  <div
                    className="fg-reaction-summary-card fg-history-card"
                    key={`${item.foodName}-${index}`}
                  >

                    <div className="fg-reaction-symbol">
                      F
                    </div>

                    <div className="fg-reaction-summary-content">

                      <h3>
                        {item.foodName ||
                          "Food"}
                      </h3>

                      {item.status && (
                        <strong>
                          {item.status}
                        </strong>
                      )}

                      {item.reaction && (
                        <p>
                          Reaction:{" "}
                          {item.reaction}
                        </p>
                      )}

                      {item.notes && (
                        <p>
                          {item.notes}
                        </p>
                      )}

                      {formatDate(
                        item.createdAt ||
                          item.date
                      ) && (
                        <small>
                          {formatDate(
                            item.createdAt ||
                              item.date
                          )}
                        </small>
                      )}

                    </div>

                  </div>
                )
              )}

            </div>
          ) : (
            <div className="fg-empty-card">

              <div className="fg-empty-icon">
                F
              </div>

              <h3>
                No Recent Food Experiences
              </h3>

              <p>
                Your food experiences will
                appear here as you use the
                system.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            06 — SAVED MEAL PLANS
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-purple">
              PERSONALIZED MEAL MEMORY
            </div>

            <h2>
              Your Saved Meal Plans
            </h2>

            <p>
              Every personalized meal plan is
              remembered so future recommendations
              can learn from your previous meals.
              Select a plan to view the complete
              saved version.
            </p>

          </div>

          {mealPlans.length > 0 ? (
            <div className="fg-meal-grid">

              {mealPlans
                .slice(0, 12)
                .map(
                  (plan, index) => (
                    <button
                      type="button"
                      className="fg-meal-card fg-meal-card-clickable"
                      key={
                        plan._id ||
                        plan.id ||
                        index
                      }
                      onClick={() =>
                        openMealPlan(
                          plan
                        )
                      }
                    >

                      <div className="fg-meal-card-top">

                        <div className="fg-meal-icon fg-meal-icon-purple">
                          MP
                        </div>

                        <span className="fg-meal-view-label">
                          VIEW PLAN
                        </span>

                      </div>

                      <h3>
                        {plan.goal ||
                          "Personalized Meal Plan"}
                      </h3>

                      {plan.context && (
                        <p className="fg-meal-context">
                          {plan.context}
                        </p>
                      )}

                      {plan.customization && (
                        <div className="fg-plan-customization">
                          Customized plan
                        </div>
                      )}

                      <div className="fg-meal-plan-preview">
                        {String(
                          plan.mealPlan ||
                            ""
                        )
                          .replace(
                            /[#*_`]/g,
                            ""
                          )
                          .slice(
                            0,
                            120
                          )}
                        {String(
                          plan.mealPlan ||
                            ""
                        ).length > 120
                          ? "..."
                          : ""}
                      </div>

                      <div className="fg-meal-date">
                        {formatDate(
                          plan.updatedAt ||
                            plan.createdAt
                        )}
                      </div>

                      <div className="fg-plan-open">
                        Open complete plan →
                      </div>

                    </button>
                  )
                )}

            </div>
          ) : (
            <div className="fg-empty-card fg-meal-empty">

              <div className="fg-empty-icon fg-empty-purple">
                MP
              </div>

              <h3>
                No Saved Meal Plans Yet
              </h3>

              <p>
                Create a personalized meal plan
                from What Should I Eat? and it
                will automatically be remembered
                here for future reference.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            07 — MEAL PLAN FEEDBACK
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-teal">
              MEAL PLANNER LEARNING
            </div>

            <h2>
              Your Meal Plan Experiences
            </h2>

            <p>
              Feedback about complete meal plans
              is kept separate from individual
              food reactions.
            </p>

          </div>

          {mealPlanFeedback.length >
          0 ? (
            <div className="fg-meal-grid">

              {mealPlanFeedback
                .slice()
                .reverse()
                .slice(0, 9)
                .map(
                  (item, index) => (
                    <div
                      className="fg-meal-card fg-feedback-card"
                      key={
                        item._id ||
                        item.id ||
                        index
                      }
                    >

                      <div className="fg-meal-card-top">

                        <div className="fg-meal-icon fg-meal-icon-teal">
                          FB
                        </div>

                        {item.status && (
                          <span
                            className={`fg-preference ${
                              normalizeFoodName(
                                item.status
                              ) ===
                              "loved"
                                ? "fg-loved"
                                : normalizeFoodName(
                                    item.status
                                  ) ===
                                  "liked"
                                ? "fg-liked"
                                : normalizeFoodName(
                                    item.status
                                  ) ===
                                  "disliked"
                                ? "fg-disliked"
                                : "fg-neutral"
                            }`}
                          >
                            {item.status}
                          </span>
                        )}

                      </div>

                      <h3>
                        {item.goal ||
                          "Personalized Meal Plan"}
                      </h3>

                      {(item.context ||
                        item.customization) && (
                        <p className="fg-meal-context">
                          {item.context ||
                            item.customization}
                        </p>
                      )}

                      {(item.reaction ||
                        item.notes) && (
                        <div className="fg-meal-reaction">

                          <span>
                            Your feedback
                          </span>

                          <strong>
                            {item.reaction ||
                              item.notes}
                          </strong>

                        </div>
                      )}

                      {formatDate(
                        item.createdAt ||
                          item.date ||
                          item.recordedAt
                      ) && (
                        <div className="fg-meal-date">
                          {formatDate(
                            item.createdAt ||
                              item.date ||
                              item.recordedAt
                          )}
                        </div>
                      )}

                    </div>
                  )
                )}

            </div>
          ) : (
            <div className="fg-empty-card fg-meal-empty">

              <div className="fg-empty-icon fg-empty-teal">
                FB
              </div>

              <h3>
                No Meal Plan Feedback Yet
              </h3>

              <p>
                After creating a personalized
                meal plan, record how useful
                or suitable it was. That
                feedback becomes part of
                future dietary learning.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            08 — LEARNED PATTERNS
        ================================================== */}

        <section className="fg-section">

          <div className="fg-section-heading">

            <div className="fg-eyebrow fg-eyebrow-blue">
              LEARNED PATTERNS
            </div>

            <h2>
              What Your Food Genome Has Learned
            </h2>

            <p>
              Repeated experiences are
              summarized into food-level
              patterns instead of showing
              every duplicate entry.
            </p>

          </div>

          {learnedPatterns.length >
          0 ? (
            <div className="fg-learning-grid">

              {learnedPatterns
                .slice(0, 9)
                .map(
                  (pattern) => (
                    <div
                      className="fg-learning-card"
                      key={
                        pattern.foodName
                      }
                    >

                      <div className="fg-learning-header">

                        <div className="fg-ai-mini">
                          AI
                        </div>

                        <span>
                          PERSONAL FOOD PATTERN
                        </span>

                      </div>

                      <h3>
                        {pattern.foodName}
                      </h3>

                      <p>
                        Consolidated from{" "}
                        {
                          pattern.totalReactions
                        }{" "}
                        recorded reaction
                        {pattern.totalReactions ===
                        1
                          ? ""
                          : "s"}
                      </p>

                      <div className="fg-learning-row">

                        <span>
                          Preference
                        </span>

                        <strong>
                          {pattern.preference ||
                            "Not recorded"}
                        </strong>

                      </div>

                      <div className="fg-learning-row">

                        <span>
                          Main reaction
                        </span>

                        <strong>
                          {pattern
                            .strongestReaction
                            ?.reaction ||
                            "No reaction"}
                        </strong>

                      </div>

                      <div className="fg-learning-row">

                        <span>
                          Learning signal
                        </span>

                        <strong>
                          {pattern.strength}
                        </strong>

                      </div>

                    </div>
                  )
                )}

            </div>
          ) : (
            <div className="fg-empty-card">

              <div className="fg-empty-icon">
                AI
              </div>

              <h3>
                More Learning Will Appear Here
              </h3>

              <p>
                As you record different foods
                and experiences, the Food Genome
                will consolidate repeated signals
                into useful food-level patterns.
              </p>

            </div>
          )}

        </section>

        {/* ==================================================
            AI INTELLIGENCE
        ================================================== */}

        <section className="fg-section">

          <div className="fg-ai-card">

            <div className="fg-ai-icon">
              AI
            </div>

            <div>

              <div className="fg-ai-label">
                PERSONALIZED FOOD INTELLIGENCE
              </div>

              <h2>
                Your dietary signals work together
              </h2>

              <p>
                Your Food Genome considers
                preferences, physical reactions,
                repeated food experiences,
                saved meal plans, and meal-plan
                feedback as different signals.
                This helps future food suitability
                analysis and meal recommendations
                become more personalized over time.
              </p>

            </div>

          </div>

        </section>

        {/* ==================================================
            ACTION
        ================================================== */}

        <div className="fg-action">

          <button
            type="button"
            onClick={onContinue}
          >
            ← Back to Dashboard
          </button>

        </div>

      </div>

      {/* ==================================================
          SAVED MEAL PLAN MODAL
      ================================================== */}

      {selectedMealPlan && (
        <div
          className="fg-plan-overlay"
          onClick={closeMealPlan}
          role="presentation"
        >

          <div
            className="fg-plan-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
            aria-label="Saved personalized meal plan"
          >

            <div className="fg-plan-modal-header">

              <div>
                <div className="fg-eyebrow fg-eyebrow-purple">
                  SAVED PERSONALIZED PLAN
                </div>

                <h2>
                  {selectedMealPlan.goal ||
                    "Personalized Meal Plan"}
                </h2>

                <div className="fg-plan-meta">
                  <span>
                    Created{" "}
                    {formatDateTime(
                      selectedMealPlan.createdAt
                    )}
                  </span>

                  {selectedMealPlan.updatedAt &&
                    selectedMealPlan.updatedAt !==
                      selectedMealPlan.createdAt && (
                      <span>
                        Updated{" "}
                        {formatDateTime(
                          selectedMealPlan.updatedAt
                        )}
                      </span>
                    )}
                </div>
              </div>

              <button
                type="button"
                className="fg-plan-close"
                onClick={closeMealPlan}
                aria-label="Close meal plan"
              >
                ×
              </button>

            </div>

            <div className="fg-plan-details">

              {selectedMealPlan.context && (
                <div className="fg-plan-detail-card fg-plan-detail-blue">
                  <span>
                    CURRENT CONTEXT
                  </span>

                  <strong>
                    {selectedMealPlan.context}
                  </strong>
                </div>
              )}

              {selectedMealPlan.customization && (
                <div className="fg-plan-detail-card fg-plan-detail-purple">
                  <span>
                    CUSTOMIZATION
                  </span>

                  <strong>
                    {selectedMealPlan.customization}
                  </strong>
                </div>
              )}

            </div>

            <div className="fg-plan-content">

              <ReactMarkdown>
                {selectedMealPlan.mealPlan ||
                  "No meal plan content was saved."}
              </ReactMarkdown>

            </div>

            <div className="fg-plan-footer">
              This plan is stored as part of your
              personalized dietary history and can
              be used as context for future
              recommendations.
            </div>

          </div>

        </div>
      )}

    </div>
  );
}

export default FoodGenome;