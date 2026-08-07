import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import "./AuthScreen.scss";

type View = "login" | "register" | "forgot";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function AuthScreen() {
  const { login, register, requestPasswordReset } = useAuth();
  const { t } = useSettings();
  const [view, setView] = useState<View>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  const [forgotIdentifier, setForgotIdentifier] = useState("");

  function switchView(next: View) {
    setView(next);
    setError("");
    setNotice("");
    setShowPassword(false);
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await login(loginIdentifier.trim(), loginPassword);
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await register(registerEmail.trim(), registerUsername.trim(), registerPassword);
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await requestPasswordReset(forgotIdentifier.trim());
      setNotice(t("auth.forgotPassword.success"));
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-screen__card">
        <div className="auth-screen__brand">GhostBox</div>

        {view === "login" && (
          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <h1 className="auth-form__title">{t("auth.login.title")}</h1>
            <p className="auth-form__subtitle">{t("auth.login.subtitle")}</p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.login.identifierLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                autoFocus
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                placeholder={t("auth.login.identifierPlaceholder")}
                required
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.login.passwordLabel")}</span>
              <div className="auth-field__password">
                <input
                  className="auth-field__input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder={t("auth.login.passwordPlaceholder")}
                  required
                />
                <button
                  type="button"
                  className="auth-field__toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button
              type="button"
              className="auth-form__link"
              onClick={() => switchView("forgot")}
            >
              {t("auth.login.forgotPassword")}
            </button>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
            </button>

            <p className="auth-form__switch">
              {t("auth.login.noAccount")}{" "}
              <button type="button" onClick={() => switchView("register")}>
                {t("auth.login.createAccount")}
              </button>
            </p>
          </form>
        )}

        {view === "register" && (
          <form className="auth-form" onSubmit={handleRegisterSubmit}>
            <h1 className="auth-form__title">{t("auth.register.title")}</h1>
            <p className="auth-form__subtitle">{t("auth.register.subtitle")}</p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.emailLabel")}</span>
              <input
                className="auth-field__input"
                type="email"
                autoComplete="email"
                autoFocus
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder={t("auth.register.emailPlaceholder")}
                required
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.usernameLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                value={registerUsername}
                onChange={(event) => setRegisterUsername(event.target.value)}
                placeholder={t("auth.register.usernamePlaceholder")}
                pattern="[a-zA-Z0-9_]{3,20}"
                required
              />
              <span className="auth-field__hint">{t("auth.register.usernameHint")}</span>
            </label>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.passwordLabel")}</span>
              <div className="auth-field__password">
                <input
                  className="auth-field__input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  placeholder={t("auth.register.passwordPlaceholder")}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="auth-field__toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span className="auth-field__hint">{t("auth.register.passwordHint")}</span>
            </label>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
            </button>

            <p className="auth-form__switch">
              {t("auth.register.haveAccount")}{" "}
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.register.signIn")}
              </button>
            </p>
          </form>
        )}

        {view === "forgot" && (
          <form className="auth-form" onSubmit={handleForgotSubmit}>
            <h1 className="auth-form__title">{t("auth.forgotPassword.title")}</h1>
            <p className="auth-form__subtitle">{t("auth.forgotPassword.subtitle")}</p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.forgotPassword.identifierLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                autoFocus
                value={forgotIdentifier}
                onChange={(event) => setForgotIdentifier(event.target.value)}
                placeholder={t("auth.forgotPassword.identifierPlaceholder")}
                required
              />
            </label>

            {error && <p className="auth-form__error">{error}</p>}
            {notice && <p className="auth-form__notice">{notice}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.forgotPassword.submitting") : t("auth.forgotPassword.submit")}
            </button>

            <p className="auth-form__switch">
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.forgotPassword.backToLogin")}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
