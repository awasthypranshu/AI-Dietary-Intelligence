import { useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:5001";

function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [rememberMe, setRememberMe] =
    useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // ==================================================
  // GET CURRENT AUTHENTICATED USER
  // ==================================================

  async function getCurrentUser() {
    const response =
      await fetch(
        `${API_URL}/me`,
        {
          method: "GET",
          credentials: "include",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Could not verify the authenticated session."
      );
    }

    return data;
  }

  // ==================================================
  // LOGIN / SIGNUP
  // ==================================================

  async function handleLoginOrSignup(e) {
    e.preventDefault();

    setMessage("");

    const cleanEmail =
      email.trim();

    if (
      !cleanEmail ||
      !password.trim()
    ) {
      setMessage(
        "Please enter your email and password."
      );
      return;
    }

    if (
      mode === "signup" &&
      password !== confirmPassword
    ) {
      setMessage(
        "Passwords do not match."
      );
      return;
    }

    if (
      mode === "signup" &&
      password.length < 8
    ) {
      setMessage(
        "Password must be at least 8 characters."
      );
      return;
    }

    setLoading(true);

    try {
      // ==================================================
      // SIGNUP
      // ==================================================

      if (mode === "signup") {
        const signupResponse =
          await fetch(
            `${API_URL}/signup`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              credentials:
                "include",

              body: JSON.stringify({
                email:
                  cleanEmail,

                password,
              }),
            }
          );

        const signupData =
          await signupResponse.json();

        if (!signupResponse.ok) {
          setMessage(
            signupData.message ||
              "Could not create account."
          );

          return;
        }

        // ==================================================
        // AUTOMATIC LOGIN AFTER SIGNUP
        // ==================================================

        const loginResponse =
          await fetch(
            `${API_URL}/login`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              credentials:
                "include",

              body: JSON.stringify({
                email:
                  cleanEmail,

                password,

                rememberMe,
              }),
            }
          );

        const loginData =
          await loginResponse.json();

        if (!loginResponse.ok) {
          setMessage(
            loginData.message ||
              "Account created, but automatic login failed. Please log in."
          );

          setMode("login");
          setPassword("");
          setConfirmPassword("");

          return;
        }

        // ==================================================
        // VERIFY SESSION
        // ==================================================

        const meData =
          await getCurrentUser();

        setMessage(
          "Account created successfully!"
        );

        setTimeout(() => {
          if (onLoginSuccess) {
            onLoginSuccess(
              meData
            );
          }
        }, 400);

        return;
      }

      // ==================================================
      // LOGIN
      // ==================================================

      const response =
        await fetch(
          `${API_URL}/login`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body: JSON.stringify({
              email:
                cleanEmail,

              password,

              rememberMe,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.message ||
            "Login failed."
        );

        return;
      }

      // ==================================================
      // VERIFY HTTP-ONLY SESSION
      // ==================================================

      const meData =
        await getCurrentUser();

      setMessage(
        "Login successful!"
      );

      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess(
            meData
          );
        }
      }, 400);
    } catch (error) {
      console.error(
        "Authentication error:",
        error
      );

      setMessage(
        error.message ||
          "Cannot connect to the backend server."
      );
    } finally {
      setLoading(false);
    }
  }

  // ==================================================
  // FORGOT PASSWORD
  // ==================================================

  async function handleForgotPassword(e) {
    e.preventDefault();

    setMessage("");

    const cleanEmail =
      email.trim();

    if (!cleanEmail) {
      setMessage(
        "Please enter your email address."
      );
      return;
    }

    setLoading(true);

    try {
      const response =
        await fetch(
          `${API_URL}/forgot-password`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials:
              "include",

            body: JSON.stringify({
              email:
                cleanEmail,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.message ||
            "Could not process your request."
        );

        return;
      }

      setMessage(
        data.message ||
          "If an account exists for this email, a password reset link has been sent."
      );
    } catch (error) {
      console.error(
        "Forgot password error:",
        error
      );

      setMessage(
        "Cannot connect to the backend server."
      );
    } finally {
      setLoading(false);
    }
  }

  // ==================================================
  // MODE SWITCHING
  // ==================================================

  function switchMode() {
    setMode(
      mode === "login"
        ? "signup"
        : "login"
    );

    setMessage("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  }

  function openForgotPassword() {
    setMode("forgot");
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  function backToLogin() {
    setMode("login");
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

  // ==================================================
  // UI
  // ==================================================

  return (
    <div className="login-page">

      <div className="login-card">

        {/* =========================
            LOGO
        ========================= */}

        <div className="login-logo">

          <span className="logo-icon">
            AI
          </span>

          <span>
            Dietary Intelligence
          </span>

        </div>

        {/* =========================
            TITLE
        ========================= */}

        <h1>
          {mode === "login"
            ? "Welcome Back"
            : mode === "signup"
            ? "Create Your Account"
            : "Forgot Password?"}
        </h1>

        {/* =========================
            SUBTITLE
        ========================= */}

        <p className="login-subtitle">

          {mode === "login"
            ? "Sign in to continue your personalized dietary journey."
            : mode === "signup"
            ? "Create your account to start your personalized dietary journey."
            : "Enter your email address and we'll send you a password reset link."}

        </p>

        {/* =========================
            LOGIN / SIGNUP
        ========================= */}

        {(mode === "login" ||
          mode === "signup") && (

          <form
            onSubmit={
              handleLoginOrSignup
            }
          >

            {/* EMAIL */}

            <div className="login-field">

              <label>
                Email Address
              </label>

              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value
                  )
                }
                autoComplete="email"
                required
                disabled={loading}
              />

            </div>

            {/* PASSWORD */}

            <div className="login-field">

              <label>
                Password
              </label>

              <input
                type="password"
                placeholder={
                  mode === "signup"
                    ? "Create a password"
                    : "Enter your password"
                }
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                autoComplete={
                  mode === "signup"
                    ? "new-password"
                    : "current-password"
                }
                required
                disabled={loading}
              />

            </div>

            {/* CONFIRM PASSWORD */}

            {mode === "signup" && (

              <div className="login-field">

                <label>
                  Confirm Password
                </label>

                <input
                  type="password"
                  placeholder="Confirm your password"
                  value={
                    confirmPassword
                  }
                  onChange={(e) =>
                    setConfirmPassword(
                      e.target.value
                    )
                  }
                  autoComplete="new-password"
                  required
                  disabled={loading}
                />

              </div>

            )}

            {/* LOGIN OPTIONS */}

            {mode === "login" && (

              <div className="login-options">

                <label className="remember-me">

                  <input
                    type="checkbox"
                    checked={
                      rememberMe
                    }
                    onChange={(e) =>
                      setRememberMe(
                        e.target.checked
                      )
                    }
                    disabled={loading}
                  />

                  <span>
                    Remember me
                  </span>

                </label>

                <button
                  type="button"
                  className="login-link-button"
                  onClick={
                    openForgotPassword
                  }
                  disabled={loading}
                >
                  Forgot password?
                </button>

              </div>

            )}

            {/* SUBMIT */}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >

              {loading
                ? mode === "login"
                  ? "Logging in..."
                  : "Creating account..."
                : mode === "login"
                ? "Login"
                : "Create Account"}

            </button>

          </form>

        )}

        {/* =========================
            FORGOT PASSWORD
        ========================= */}

        {mode === "forgot" && (

          <form
            onSubmit={
              handleForgotPassword
            }
          >

            <div className="login-field">

              <label>
                Email Address
              </label>

              <input
                type="email"
                placeholder="Enter your registered email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value
                  )
                }
                autoComplete="email"
                required
                disabled={loading}
              />

            </div>

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >

              {loading
                ? "Sending reset link..."
                : "Send Reset Link"}

            </button>

            <button
              type="button"
              className="login-link-button"
              onClick={
                backToLogin
              }
              disabled={loading}
              style={{
                display: "block",
                margin:
                  "16px auto 0",
              }}
            >
              ← Back to Login
            </button>

          </form>

        )}

        {/* =========================
            MESSAGE
        ========================= */}

        {message && (

          <p className="profile-message">
            {message}
          </p>

        )}

        {/* =========================
            LOGIN / SIGNUP SWITCH
        ========================= */}

        {(mode === "login" ||
          mode === "signup") && (

          <p className="register-text">

            {mode === "login"
              ? "Don't have an account? "
              : "Already have an account? "}

            <button
              type="button"
              className="login-link-button"
              onClick={
                switchMode
              }
              disabled={loading}
            >

              {mode === "login"
                ? "Create an account"
                : "Login"}

            </button>

          </p>

        )}

        {/* =========================
            FORGOT PASSWORD FOOTER
        ========================= */}

        {mode === "forgot" && (

          <p className="register-text">

            Remember your password?{" "}

            <button
              type="button"
              className="login-link-button"
              onClick={
                backToLogin
              }
              disabled={loading}
            >
              Login
            </button>

          </p>

        )}

      </div>

    </div>
  );
}

export default Login;