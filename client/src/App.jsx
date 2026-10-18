import { useEffect, useState } from "react";
import Login from "./Login";
import ResetPassword from "./ResetPassword";
import PatientProfile from "./PatientProfile";
import MedicalReport from "./MedicalReport";
import FoodUpload from "./FoodUpload";
import DigitalTwin from "./DigitalTwin";
import FoodGenome from "./FoodGenome";
import Dashboard from "./Dashboard";
import FoodHistory from "./FoodHistory";
import MealPlanner from "./MealPlanner";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:5001";

function AuthenticatedNavbar({
  onGoHome,
  onGoDashboard,
  onGoDigitalTwin,
  onGoFoodGenome,
  onProfileNavigation,
  onLogout,
  mobileMenuOpen,
  setMobileMenuOpen,
}) {
  return (
    <nav className="app-navbar">
      <div className="app-navbar-inner">
        <button
          className="app-brand"
          type="button"
          onClick={onGoHome}
          aria-label="Go to home"
        >
          <span className="app-brand-mark">AI</span>
          <span className="app-brand-text">Dietary Intelligence</span>
        </button>

        <button
          className="mobile-menu-button"
          type="button"
          onClick={() => setMobileMenuOpen((value) => !value)}
          aria-label="Toggle navigation"
          aria-expanded={mobileMenuOpen}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div className={`app-nav-links ${mobileMenuOpen ? "mobile-open" : ""}`}>
          <button
            type="button"
            className="app-nav-link"
            onClick={() => {
              onGoHome();
              setMobileMenuOpen(false);
            }}
          >
            Home
          </button>

          <button
            type="button"
            className="app-nav-link"
            onClick={() => {
              onGoDashboard();
              setMobileMenuOpen(false);
            }}
          >
            Dashboard
          </button>

          <button
            type="button"
            className="app-nav-link"
            onClick={() => {
              onGoDigitalTwin();
              setMobileMenuOpen(false);
            }}
          >
            Digital Twin
          </button>

          <button
            type="button"
            className="app-nav-link"
            onClick={() => {
              onGoFoodGenome();
              setMobileMenuOpen(false);
            }}
          >
            Food Genome
          </button>

          <button
            type="button"
            className="app-nav-link"
            onClick={() => {
              onProfileNavigation();
              setMobileMenuOpen(false);
            }}
          >
            Profile
          </button>

          <button
            type="button"
            className="app-nav-logout"
            onClick={() => {
              onLogout();
              setMobileMenuOpen(false);
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

function PageNavigation({
  backLabel = "Back",
  onBack,
  continueLabel,
  onContinue,
}) {
  return (
    <div className="page-navigation">
      <button
        className="page-back-button"
        type="button"
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
        {backLabel}
      </button>

      {continueLabel && onContinue && (
        <button
          className="page-continue-button"
          type="button"
          onClick={onContinue}
        >
          {continueLabel}
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}

function AuthenticatedPage({ children, navigation, navbar }) {
  return (
    <div className="authenticated-layout">
      {navbar}
      <div className="authenticated-content">
        {navigation}
        {children}
      </div>
    </div>
  );
}

function App() {
  // ==================================================
  // PAGE STATE
  // ==================================================

  const [showLogin, setShowLogin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMedicalReport, setShowMedicalReport] =
    useState(false);
  const [showDigitalTwin, setShowDigitalTwin] =
    useState(false);
  const [showFoodGenome, setShowFoodGenome] =
    useState(false);
  const [showDashboard, setShowDashboard] =
    useState(false);
  const [showFoodUpload, setShowFoodUpload] =
    useState(false);
  const [showFoodHistory, setShowFoodHistory] =
    useState(false);
  const [showMealPlanner, setShowMealPlanner] =
    useState(false);

  // ==================================================
  // PASSWORD RESET PAGE
  // ==================================================

  const isResetPasswordPage =
    typeof window !== "undefined" &&
    window.location.pathname === "/reset-password";

  // ==================================================
  // AUTHENTICATED USER
  // ==================================================

  const [currentUser, setCurrentUser] = useState(null);
  const [patientData, setPatientData] = useState(null);
  const [checkingUser, setCheckingUser] = useState(
    () => !isResetPasswordPage
  );

  // ==================================================
  // FEEDBACK
  // ==================================================

  const [feedbackContext, setFeedbackContext] =
    useState(null);

  // ==================================================
  // NAVIGATION CONTEXT
  // ==================================================

  const [openedFromDashboard, setOpenedFromDashboard] =
    useState(false);

  const [
    medicalReportOpenedFromDigitalTwin,
    setMedicalReportOpenedFromDigitalTwin,
  ] = useState(false);

  // ==================================================
  // MOBILE NAVBAR
  // ==================================================

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);

  // ==================================================
  // RESET PAGE STATES
  // ==================================================

  function resetPages() {
    setShowLogin(false);
    setShowProfile(false);
    setShowMedicalReport(false);
    setShowDigitalTwin(false);
    setShowFoodGenome(false);
    setShowDashboard(false);
    setShowFoodUpload(false);
    setShowFoodHistory(false);
    setShowMealPlanner(false);
    setOpenedFromDashboard(false);
    setMedicalReportOpenedFromDigitalTwin(false);
    setFeedbackContext(null);
    setMobileMenuOpen(false);
  }

  // ==================================================
  // LOAD PATIENT PROFILE
  // ==================================================

  async function loadPatientProfile(user) {
    if (!user?.userId) {
      return null;
    }

    try {
      const response = await fetch(
        `${API_URL}/patients/user/${encodeURIComponent(
          user.userId
        )}`,
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (response.ok) {
        const data = await response.json();

        return {
          ...data,
          userId: user.userId,
          email: user.email || "",
        };
      }

      if (response.status === 404) {
        return {
          userId: user.userId,
          email: user.email || "",
        };
      }

      if (response.status === 401) {
        setCurrentUser(null);
        setPatientData(null);
        return null;
      }

      return {
        userId: user.userId,
        email: user.email || "",
      };
    } catch (error) {
      console.error(
        "Patient profile loading error:",
        error
      );

      return {
        userId: user.userId,
        email: user.email || "",
      };
    }
  }

  // ==================================================
  // RESTORE AUTHENTICATED SESSION
  // ==================================================

  useEffect(() => {
    if (isResetPasswordPage) {
      return;
    }

    async function restoreUser() {
      try {
        const response = await fetch(
          `${API_URL}/me`,
          {
            method: "GET",
            credentials: "include",
          }
        );

        if (response.status === 401) {
          setCurrentUser(null);
          setPatientData(null);
          return;
        }

        if (!response.ok) {
          setCurrentUser(null);
          setPatientData(null);
          return;
        }

        const user = await response.json();

        if (!user?.userId) {
          setCurrentUser(null);
          setPatientData(null);
          return;
        }

        const authenticatedUser = {
          userId: user.userId,
          email: user.email || "",
          rememberMe: Boolean(user.rememberMe),
        };

        setCurrentUser(authenticatedUser);

        const profile =
          await loadPatientProfile(
            authenticatedUser
          );

        if (!profile) {
          return;
        }

        setPatientData(profile);

        if (profile.name) {
          resetPages();
          setShowDashboard(true);
        } else {
          resetPages();
          setShowProfile(true);
        }
      } catch (error) {
        console.error(
          "User restoration error:",
          error
        );

        setCurrentUser(null);
        setPatientData(null);
      } finally {
        setCheckingUser(false);
      }
    }

    restoreUser();
  }, [isResetPasswordPage]);

  // ==================================================
  // LOGIN SUCCESS
  // ==================================================

  async function handleLoginSuccess(loginData) {
    const userId = loginData?.userId;
    const email = loginData?.email || "";

    if (!userId) {
      console.error(
        "Authentication succeeded but no user ID was returned."
      );

      setCurrentUser(null);
      setPatientData(null);
      resetPages();
      setShowLogin(true);
      return;
    }

    const authenticatedUser = {
      userId,
      email,
      rememberMe: Boolean(loginData?.rememberMe),
    };

    setCurrentUser(authenticatedUser);
    setCheckingUser(true);

    try {
      const profile =
        await loadPatientProfile(
          authenticatedUser
        );

      if (!profile) {
        return;
      }

      setPatientData(profile);
      resetPages();

      if (profile.name) {
        setShowDashboard(true);
      } else {
        setShowProfile(true);
      }
    } catch (error) {
      console.error(
        "Login profile loading error:",
        error
      );

      setPatientData({
        userId,
        email,
      });

      resetPages();
      setShowProfile(true);
    } finally {
      setCheckingUser(false);
    }
  }

  // ==================================================
  // GO HOME
  // ==================================================

  function handleGoHome() {
    resetPages();
  }

  // ==================================================
  // GO TO DASHBOARD
  // ==================================================

  async function handleGoDashboard() {
    if (!currentUser?.userId) {
      resetPages();
      setShowLogin(true);
      return;
    }

    const profile =
      await loadPatientProfile(
        currentUser
      );

    if (!profile) {
      resetPages();
      setShowLogin(true);
      return;
    }

    setPatientData(profile);
    resetPages();

    if (profile.name) {
      setShowDashboard(true);
    } else {
      setShowProfile(true);
    }
  }

  // ==================================================
  // GO TO DIGITAL TWIN
  // ==================================================

  function handleGoDigitalTwin() {
    if (!currentUser?.userId) {
      resetPages();
      setShowLogin(true);
      return;
    }

    setOpenedFromDashboard(true);
    resetPages();
    setOpenedFromDashboard(true);
    setShowDigitalTwin(true);
  }

  // ==================================================
  // GO TO FOOD GENOME
  // ==================================================

  function handleGoFoodGenome() {
    if (!currentUser?.userId) {
      resetPages();
      setShowLogin(true);
      return;
    }

    setOpenedFromDashboard(true);
    resetPages();
    setOpenedFromDashboard(true);
    setShowFoodGenome(true);
  }

  // ==================================================
  // LOGOUT
  // ==================================================

  async function handleLogout() {
    try {
      await fetch(
        `${API_URL}/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    setCurrentUser(null);
    setPatientData(null);
    setFeedbackContext(null);
    resetPages();
  }

  // ==================================================
  // PROFILE NAVIGATION
  // ==================================================

  async function handleProfileNavigation() {
    if (!currentUser?.userId) {
      resetPages();
      setShowLogin(true);
      return;
    }

    const profile =
      await loadPatientProfile(
        currentUser
      );

    if (!profile) {
      resetPages();
      setShowLogin(true);
      return;
    }

    setPatientData(profile);
    resetPages();
    setShowProfile(true);
  }

  // ==================================================
  // PAGE-LEVEL BACK NAVIGATION
  // ==================================================

  function handleBackToDashboard() {
    if (!currentUser?.userId) {
      resetPages();
      setShowLogin(true);
      return;
    }

    resetPages();
    setShowDashboard(true);
  }



  // ==================================================
  // SHARED AUTHENTICATED NAVBAR & LAYOUT
  // ==================================================

  const authNavbar = (
    <AuthenticatedNavbar
      onGoHome={handleGoHome}
      onGoDashboard={handleGoDashboard}
      onGoDigitalTwin={handleGoDigitalTwin}
      onGoFoodGenome={handleGoFoodGenome}
      onProfileNavigation={handleProfileNavigation}
      onLogout={handleLogout}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
    />
  );

  // ==================================================
  // PASSWORD RESET PAGE
  // ==================================================

  if (isResetPasswordPage) {
    return (
      <ResetPassword
        onBackToLogin={() => {
          window.history.replaceState(
            {},
            "",
            "/"
          );

          setShowLogin(true);
        }}
      />
    );
  }

  // ==================================================
  // AUTH CHECK LOADING
  // ==================================================

  if (checkingUser) {
    return (
      <div className="app-loading">
        <div className="loading-orbit">
          <span></span>
          <span></span>
          <span></span>
        </div>

        <div className="app-loading-card">
          <span className="logo-icon">
            AI
          </span>

          <h2>
            Dietary Intelligence
          </h2>

          <p>
            Preparing your personalized
            experience...
          </p>
        </div>
      </div>
    );
  }

  // ==================================================
  // LOGIN
  // ==================================================

  if (showLogin) {
    return (
      <Login
        onLoginSuccess={
          handleLoginSuccess
        }
      />
    );
  }

  // ==================================================
  // PATIENT PROFILE
  // ==================================================

  if (showProfile) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back to Dashboard"
            onBack={
              handleBackToDashboard
            }
          />
        }
      >
        <PatientProfile
          patientData={
            patientData
          }

          onProfileSaved={(data) => {
            const userId =
              currentUser?.userId ||
              patientData?.userId;

            setPatientData({
              ...data,
              userId,
              email:
                currentUser?.email ||
                patientData?.email ||
                "",
            });

            setMedicalReportOpenedFromDigitalTwin(
              false
            );

            setShowProfile(false);
            setShowMedicalReport(true);
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // MEDICAL REPORT
  // ==================================================

  if (showMedicalReport) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back"
            onBack={() => {
              if (
                medicalReportOpenedFromDigitalTwin
              ) {
                resetPages();
                setOpenedFromDashboard(true);
                setShowDigitalTwin(true);
              } else {
                resetPages();
                setShowProfile(true);
              }
            }}
          />
        }
      >
        <MedicalReport
          patientData={
            patientData
          }

          onReportUploaded={() => {
            setShowMedicalReport(false);

            if (
              medicalReportOpenedFromDigitalTwin
            ) {
              setOpenedFromDashboard(true);
              setShowDigitalTwin(true);
            } else {
              setOpenedFromDashboard(false);
              setShowDigitalTwin(true);
            }

            setMedicalReportOpenedFromDigitalTwin(
              false
            );
          }}

          onSkip={() => {
            setShowMedicalReport(false);

            if (
              medicalReportOpenedFromDigitalTwin
            ) {
              setOpenedFromDashboard(true);
              setShowDigitalTwin(true);
            } else {
              setOpenedFromDashboard(false);
              setShowDigitalTwin(true);
            }

            setMedicalReportOpenedFromDigitalTwin(
              false
            );
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // DIGITAL TWIN
  // ==================================================

  if (showDigitalTwin) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back to Dashboard"
            onBack={
              handleBackToDashboard
            }
          />
        }
      >
        <DigitalTwin
          patientData={
            patientData
          }

          onMedicalReport={() => {
            setMedicalReportOpenedFromDigitalTwin(
              true
            );

            setShowDigitalTwin(false);
            setShowMedicalReport(true);
          }}

          onContinue={() => {
            setShowDigitalTwin(false);

            if (
              openedFromDashboard
            ) {
              setOpenedFromDashboard(false);
              setShowDashboard(true);
            } else {
              setShowFoodGenome(true);
            }
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // FOOD GENOME
  // ==================================================

  if (showFoodGenome) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back to Dashboard"
            onBack={
              handleBackToDashboard
            }
          />
        }
      >
        <FoodGenome
          patientData={
            patientData
          }

          onContinue={() => {
            setShowFoodGenome(false);

            if (
              openedFromDashboard
            ) {
              setOpenedFromDashboard(false);
              setShowDashboard(true);
            } else {
              setShowDashboard(true);
            }
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // DASHBOARD
  // ==================================================

  if (showDashboard) {
    return (
      <AuthenticatedPage navbar={authNavbar}>
        <Dashboard
          patientData={
            patientData
          }

          onCanIEat={() => {
            setShowDashboard(false);
            setShowFoodUpload(true);
          }}

          onWhatShouldIEat={() => {
            setShowDashboard(false);
            setShowMealPlanner(true);
          }}

          onDigitalTwin={() => {
            setOpenedFromDashboard(true);
            setShowDashboard(false);
            setShowDigitalTwin(true);
          }}

          onFoodGenome={() => {
            setOpenedFromDashboard(true);
            setShowDashboard(false);
            setShowFoodGenome(true);
          }}

          onHome={
            handleGoHome
          }

          onLogout={
            handleLogout
          }
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // CAN I EAT THIS?
  // ==================================================

  if (showFoodUpload) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back to Dashboard"
            onBack={
              handleBackToDashboard
            }
          />
        }
      >
        <FoodUpload
          patientData={
            patientData
          }

          onFoodUploaded={(data) => {
            setFeedbackContext({
              type: "food",
              foodName:
                data?.foodName ||
                "",
            });

            setShowFoodUpload(false);
            setShowFoodHistory(true);
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // WHAT SHOULD I EAT?
  // ==================================================

  if (showMealPlanner) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back to Dashboard"
            onBack={
              handleBackToDashboard
            }
          />
        }
      >
        <MealPlanner
          patientData={
            patientData
          }

          /*
           * IMPORTANT:
           *
           * MealPlanner sends the complete saved
           * plan context here.
           *
           * The mealPlanId must be preserved so
           * FoodHistory can attach feedback to
           * the exact MongoDB meal-plan record.
           */
          onMealPlanCompleted={(planData) => {
            setFeedbackContext({
              type: "meal-plan",

              foodName: "",

              mealPlanId:
                planData?.mealPlanId ||
                null,

              goal:
                planData?.goal ||
                "",

              context:
                planData?.context ||
                "",

              customization:
                planData?.customization ||
                "",
            });

            setShowMealPlanner(false);
            setShowFoodHistory(true);
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // USER FEEDBACK
  // ==================================================

  if (showFoodHistory) {
    return (
      <AuthenticatedPage
        navbar={authNavbar}
        navigation={
          <PageNavigation
            backLabel="Back"
            onBack={() => {
              if (
                feedbackContext?.type ===
                "meal-plan"
              ) {
                resetPages();
                setShowMealPlanner(true);
              } else {
                resetPages();
                setShowFoodUpload(true);
              }
            }}
          />
        }
      >
        <FoodHistory
          patientData={
            patientData
          }

          feedbackContext={
            feedbackContext
          }

          onContinue={() => {
            setShowFoodHistory(false);
            setFeedbackContext(null);
            setShowDashboard(true);
          }}
        />
      </AuthenticatedPage>
    );
  }

  // ==================================================
  // LANDING PAGE
  // ==================================================

  const isLoggedIn =
    Boolean(
      currentUser?.userId
    );

  return (
    <div className="app">

      {/* =========================
          NAVBAR
      ========================= */}

      <nav className="navbar">

        <div className="logo">
          <span className="logo-icon">
            AI
          </span>

          <span>
            Dietary Intelligence
          </span>
        </div>

        <div className="nav-links">

          <a href="#features">
            Features
          </a>

          <a href="#how-it-works">
            How It Works
          </a>

          <a href="#about">
            About
          </a>

          {isLoggedIn && (
            <>
              <button
                className="nav-link-button"
                type="button"
                onClick={
                  handleGoHome
                }
              >
                Home
              </button>

              <button
                className="nav-link-button"
                type="button"
                onClick={
                  handleGoDashboard
                }
              >
                Dashboard
              </button>

              <button
                className="nav-link-button"
                type="button"
                onClick={
                  handleProfileNavigation
                }
              >
                Profile
              </button>

              <button
                className="nav-link-button"
                type="button"
                onClick={
                  handleLogout
                }
              >
                Logout
              </button>
            </>
          )}

          {!isLoggedIn && (
            <button
              className="nav-button"
              type="button"
              onClick={() =>
                setShowLogin(true)
              }
            >
              Get Started
            </button>
          )}

        </div>
      </nav>

      <main>

        {/* =========================
            HERO
        ========================= */}

        <section className="hero-section">

          <div className="hero-content">

            <p className="hero-badge">
              AI-POWERED PERSONALIZED
              NUTRITION
            </p>

            <h1>
              Your Health.
              <br />
              Your Food.
              <br />

              <span>
                One Intelligent System.
              </span>
            </h1>

            <p className="hero-description">
              AI Dietary Intelligence
              combines your health profile,
              medical information, food data,
              and personal history to help you
              make smarter food decisions.
            </p>

            <div className="hero-buttons">

              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  if (
                    isLoggedIn
                  ) {
                    handleGoDashboard();
                  } else {
                    setShowLogin(true);
                  }
                }}
              >
                {isLoggedIn
                  ? "Go to Dashboard"
                  : "Get Started"}
              </button>

              <a
                href="#features"
                className="secondary-button"
              >
                Explore Features
              </a>

            </div>

          </div>

          <div className="hero-visual">

            <div className="hero-image-panel">
              <div className="hero-image-overlay"></div>

              <div className="hero-floating-card hero-floating-card-top">
                <span className="floating-label">
                  PERSONALIZED
                </span>

                <strong>
                  Health Intelligence
                </strong>
              </div>

              <div className="health-card">

                <div className="card-header">

                  <div>
                    <p className="small-label">
                      PATIENT PROFILE
                    </p>

                    <h3>
                      Health Overview
                    </h3>
                  </div>

                  <span className="status-dot"></span>

                </div>

                <div className="health-stats">

                  <div>
                    <span>Age</span>

                    <strong>
                      {patientData?.age ||
                        "--"}
                    </strong>
                  </div>

                  <div>
                    <span>Weight</span>

                    <strong>
                      {patientData?.weight
                        ? `${patientData.weight} kg`
                        : "-- kg"}
                    </strong>
                  </div>

                  <div>
                    <span>Blood Sugar</span>

                    <strong>
                      {patientData?.bloodSugar ||
                        "--"}
                    </strong>
                  </div>

                  <div>
                    <span>Blood Pressure</span>

                    <strong>
                      {patientData?.bloodPressure ||
                        "--"}
                    </strong>
                  </div>

                </div>

                <div className="ai-insight">

                  <div className="insight-icon">
                    AI
                  </div>

                  <div>
                    <p>
                      AI INSIGHT
                    </p>

                    <span>
                      {isLoggedIn
                        ? "Your personalized dietary intelligence is ready."
                        : "Your personalized dietary intelligence will appear here."}
                    </span>
                  </div>

                </div>

              </div>

              <div className="hero-floating-card hero-floating-card-bottom">
                <span className="floating-label">
                  CONTINUOUS LEARNING
                </span>

                <strong>
                  Food Genome + Digital Twin
                </strong>
              </div>

            </div>

          </div>

        </section>

        {/* =========================
            FEATURES
        ========================= */}

        <section
          className="features-section"
          id="features"
        >

          <div className="section-heading">

            <p className="section-label">
              CORE INTELLIGENCE
            </p>

            <h2>
              More Than Nutrition.
              <br />

              <span>
                Personalized Intelligence.
              </span>
            </h2>

            <p>
              The system learns from your
              health, food choices, and
              feedback to build a continuously
              improving understanding of what
              works for you.
            </p>

          </div>

          <div className="feature-grid">

            <div className="feature-card">
              <div className="feature-number">
                01
              </div>

              <h3>
                Digital Twin
              </h3>

              <p>
                A personalized virtual
                representation of your health
                profile that evolves as new
                health and lifestyle data is
                added.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-number">
                02
              </div>

              <h3>
                Food Genome
              </h3>

              <p>
                Learns your food preferences,
                history, suitability patterns,
                and reactions to build a
                personalized food knowledge
                profile.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-number">
                03
              </div>

              <h3>
                AI Food Analysis
              </h3>

              <p>
                Upload a food image and receive
                a personalized analysis based on
                the identified food and your
                individual health profile.
              </p>
            </div>

          </div>

        </section>

        {/* =========================
            HOW IT WORKS
        ========================= */}

        <section
          className="how-section"
          id="how-it-works"
        >

          <div className="section-heading">

            <p className="section-label">
              HOW IT WORKS
            </p>

            <h2>
              From Health Data to
              <br />

              <span>
                Smarter Food Decisions.
              </span>
            </h2>

          </div>

          <div className="steps-grid">

            <div className="step-card">
              <span>01</span>

              <h3>
                Understand
              </h3>

              <p>
                Build a health profile using
                personal information and
                medical data.
              </p>
            </div>

            <div className="step-card">
              <span>02</span>

              <h3>
                Analyze
              </h3>

              <p>
                Understand food through image
                analysis and nutritional
                information.
              </p>
            </div>

            <div className="step-card">
              <span>03</span>

              <h3>
                Learn
              </h3>

              <p>
                Learn from food history,
                preferences, and user feedback.
              </p>
            </div>

            <div className="step-card">
              <span>04</span>

              <h3>
                Personalize
              </h3>

              <p>
                Provide increasingly
                personalized food insights
                and recommendations.
              </p>
            </div>

          </div>

        </section>

        {/* =========================
            ABOUT
        ========================= */}

        <section
          className="about-section"
          id="about"
        >

          <div className="section-heading">

            <p className="section-label">
              ABOUT THE PROJECT
            </p>

            <h2>
              Personalized Intelligence
              for Better Food Decisions
            </h2>

            <p>
              AI Dietary Intelligence combines
              health information, medical
              reports, food data, and user
              feedback to create a personalized
              understanding of dietary
              suitability.
            </p>

          </div>

          <div className="about-content">

            <div className="about-card">
              <h3>
                Why We Built It
              </h3>

              <p>
                Traditional diet applications
                often provide generic nutrition
                recommendations. Our system aims
                to understand the individual and
                personalize food-related insights
                around their health profile and
                history.
              </p>
            </div>

            <div className="about-card">
              <h3>
                What Makes It Different
              </h3>

              <p>
                The platform combines multimodal
                health data, food image analysis,
                a Digital Twin, a personalized
                Food Genome, and adaptive AI
                recommendations in one system.
              </p>
            </div>

          </div>

        </section>

      </main>

      {/* =========================
          FOOTER
      ========================= */}

      <footer>

        <div className="footer-inner">

          <div className="footer-brand">

            <div className="footer-logo">

              <span className="logo-icon">
                AI
              </span>

              <span>
                Dietary Intelligence
              </span>

            </div>

            <p>
              AI-driven personalized dietary
              intelligence for smarter, more
              informed food decisions.
            </p>

          </div>

          <div className="footer-links">

            <a href="#features">
              Features
            </a>

            <a href="#how-it-works">
              How It Works
            </a>

            <a href="#about">
              About
            </a>

          </div>

        </div>

        <div className="footer-bottom">

          <span>
            Final Year Project • B.Tech
            Computer Science
          </span>

          <span>
            © 2026 Dietary Intelligence
          </span>

        </div>

      </footer>

    </div>
  );
}

export default App;