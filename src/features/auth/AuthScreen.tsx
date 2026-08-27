import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";
import googleIcon from "../../../Icons/google-icon-1.png";
import steamIcon from "../../../Icons/steam-glyph.svg";
import type { LoginProvider, OAuthSignupPending } from "../../lib/ghostboxApi.types";
import "./AuthScreen.scss";

type View = "login" | "register" | "recover" | "recoverPassword" | "oauthSignup";

/** Every way into an account, in the order the modal offers them. GhostBox
 * sends no email, so this list is also the complete list of ways back in after
 * a forgotten password. */
const PROVIDERS: ReadonlyArray<{ id: LoginProvider; icon: string; labelKey: string }> = [
  { id: "discord", icon: discordIcon, labelKey: "auth.provider.discord" },
  { id: "google", icon: googleIcon, labelKey: "auth.provider.google" },
  { id: "steam", icon: steamIcon, labelKey: "auth.provider.steam" },
];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function AuthTitle({ text }: { text: string }) {
  return (
    <h1 className="auth-form__title">
      <img className="auth-form__title-icon" src={ghostLogo} alt="" />
      {text}
    </h1>
  );
}

/** Provider usernames allow characters the GhostBox handle does not, so the
 * suggestion is filtered instead of rejected outright — the user only has to
 * fix it when nothing usable is left. */
function suggestUsername(value: string | null): string {
  return (value ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
}

export function AuthScreen() {
  const {
    login,
    register,
    loginWithProvider,
    completeOAuthSignup,
    startRecovery,
    completeRecovery,
    closeAuthModal,
  } = useAuth();
  const { t } = useSettings();
  const [view, setView] = useState<View>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [oauthPending, setOauthPending] = useState<OAuthSignupPending | null>(null);
  const [oauthUsername, setOauthUsername] = useState("");
  const [oauthPassword, setOauthPassword] = useState("");

  // Held in memory only, never persisted as a session: it buys exactly one
  // call, and it expires in ten minutes.
  const [recoveryToken, setRecoveryToken] = useState("");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoverPassword, setRecoverPassword] = useState("");
  const [recoverConfirm, setRecoverConfirm] = useState("");

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirm, setRegisterConfirm] = useState("");

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  function switchView(next: View) {
    setView(next);
    setError("");
    setNotice("");
    setShowPassword(false);
  }

  useLayoutEffect(() => {
    const card = cardRef.current;
    const form = card?.querySelector(".auth-form") as HTMLElement | null;
    if (!card || !form) return;

    const measure = () => {
      const styles = window.getComputedStyle(card);
      const verticalSpace =
        parseFloat(styles.paddingTop) +
        parseFloat(styles.paddingBottom) +
        parseFloat(styles.borderTopWidth) +
        parseFloat(styles.borderBottomWidth);

      setCardHeight(Math.ceil(form.getBoundingClientRect().height + verticalSpace));
    };

    measure();

    // A altura do card é travada em pixels. Sem observar o formulário, estreitar
    // a janela quebra os rótulos em mais linhas e o card continua na altura
    // antiga — conteúdo cortado ou sobrando. O observer refaz a conta.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [view, error, notice, submitting]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) closeAuthModal();
    },
    [closeAuthModal],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAuthModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeAuthModal]);

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await login(loginIdentifier.trim(), loginPassword);
      closeAuthModal();
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
      if (registerPassword !== registerConfirm) {
        setError(errorMessage(null, t("auth.errors.password_mismatch")));
        setSubmitting(false);
        return;
      }
      await register(registerEmail.trim(), registerUsername.trim(), registerPassword);
      closeAuthModal();
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProviderClick(provider: LoginProvider) {
    if (submitting) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const pending = await loginWithProvider(provider);
      if (!pending) {
        closeAuthModal();
        return;
      }
      // The provider account is not attached to anything yet: collect a
      // password so the account is a normal one, reachable by password too.
      setOauthPending(pending);
      setOauthUsername(suggestUsername(pending.profile.username));
      setOauthPassword("");
      setView("oauthSignup");
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuthSignupSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !oauthPending) return;
    setError("");
    setSubmitting(true);
    try {
      await completeOAuthSignup(oauthPending.ticket, oauthUsername.trim(), oauthPassword);
      closeAuthModal();
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  // Called as a plain function, not rendered as <ProviderButtons />: a
  // component declared inside the render remounts on every keystroke.
  function providerButtons(onClick: (provider: LoginProvider) => void) {
    return (
      <>
        <div className="auth-form__divider">{t("auth.provider.divider")}</div>
        <div className="auth-form__providers">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="auth-form__provider"
              onClick={() => onClick(provider.id)}
              disabled={submitting}
            >
              <img className="auth-form__provider-icon" src={provider.icon} alt="" aria-hidden="true" />
              {t(provider.labelKey)}
            </button>
          ))}
        </div>
      </>
    );
  }

  /** Recovery step one. The provider proves the account; what comes back is a
   * ten-minute token that can do nothing but set a password. */
  async function handleRecoverClick(provider: LoginProvider) {
    if (submitting) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const recovery = await startRecovery(provider);
      setRecoveryToken(recovery.token);
      setRecoveryUsername(recovery.account.username);
      setRecoverPassword("");
      setRecoverConfirm("");
      setView("recoverPassword");
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoverPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    if (recoverPassword !== recoverConfirm) {
      setError(t("auth.errors.password_mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await completeRecovery(recoveryToken, recoverPassword);
      setRecoveryToken("");
      closeAuthModal();
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen" onMouseDown={handleBackdropClick}>
      <div
        ref={cardRef}
        className="auth-screen__card"
        style={cardHeight !== null ? { height: `${cardHeight}px` } : undefined}
      >
        {view === "login" && (
          <form key={view} className="auth-form" onSubmit={handleLoginSubmit}>
            <AuthTitle text={t("auth.login.title")} />
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
              onClick={() => switchView("recover")}
            >
              {t("auth.login.forgotPassword")}
            </button>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
            </button>

            {providerButtons((provider) => void handleProviderClick(provider))}

            <p className="auth-form__switch">
              {t("auth.login.noAccount")}{" "}
              <button type="button" onClick={() => switchView("register")}>
                {t("auth.login.createAccount")}
              </button>
            </p>
          </form>
        )}

        {view === "register" && (
          <form key={view} className="auth-form" onSubmit={handleRegisterSubmit}>
            <AuthTitle text={t("auth.register.title")} />
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

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.confirmPasswordLabel")}</span>
              <div className="auth-field__password">
                <input
                  className="auth-field__input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={registerConfirm}
                  onChange={(event) => setRegisterConfirm(event.target.value)}
                  placeholder={t("auth.register.confirmPasswordPlaceholder")}
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
            </label>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
            </button>

            {providerButtons((provider) => void handleProviderClick(provider))}

            <p className="auth-form__switch">
              {t("auth.register.haveAccount")}{" "}
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.register.signIn")}
              </button>
            </p>
          </form>
        )}

        {view === "oauthSignup" && oauthPending && (
          <form key={view} className="auth-form" onSubmit={handleOAuthSignupSubmit}>
            <AuthTitle text={t("auth.oauthSignup.title")} />
            <p className="auth-form__subtitle">{t("auth.oauthSignup.subtitle")}</p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.emailLabel")}</span>
              <input
                className="auth-field__input"
                type="email"
                value={oauthPending.profile.email ?? ""}
                readOnly
                disabled
              />
              <span className="auth-field__hint">
                {oauthPending.profile.emailVerified
                  ? t("auth.oauthSignup.emailVerifiedHint")
                  : t("auth.oauthSignup.emailUnverifiedHint")}
              </span>
            </label>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.usernameLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                autoFocus
                value={oauthUsername}
                onChange={(event) => setOauthUsername(event.target.value)}
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
                  value={oauthPassword}
                  onChange={(event) => setOauthPassword(event.target.value)}
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
              <span className="auth-field__hint">{t("auth.oauthSignup.passwordHint")}</span>
            </label>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.oauthSignup.submitting") : t("auth.oauthSignup.submit")}
            </button>

            <p className="auth-form__switch">
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.recover.backToLogin")}
              </button>
            </p>
          </form>
        )}

        {view === "recover" && (
          <div key={view} className="auth-form">
            <AuthTitle text={t("auth.recover.title")} />
            {/* No identifier field, and nothing is sent anywhere: the provider
                is the proof. Saying so up front is what stops the user waiting
                on an email that is never coming. */}
            <p className="auth-form__subtitle">{t("auth.recover.subtitle")}</p>

            {error && <p className="auth-form__error">{error}</p>}
            {notice && <p className="auth-form__notice">{notice}</p>}

            {providerButtons((provider) => void handleRecoverClick(provider))}

            <p className="auth-form__hint-block">{t("auth.recover.noProviderHint")}</p>

            <p className="auth-form__switch">
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.recover.backToLogin")}
              </button>
            </p>
          </div>
        )}

        {view === "recoverPassword" && (
          <form key={view} className="auth-form" onSubmit={handleRecoverPasswordSubmit}>
            <AuthTitle text={t("auth.recover.setPasswordTitle")} />
            <p className="auth-form__subtitle">
              {t("auth.recover.setPasswordSubtitle").replace("{username}", recoveryUsername)}
            </p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.passwordLabel")}</span>
              <div className="auth-field__password">
                <input
                  className="auth-field__input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoFocus
                  value={recoverPassword}
                  onChange={(event) => setRecoverPassword(event.target.value)}
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
            </label>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.register.confirmPasswordLabel")}</span>
              <input
                className="auth-field__input"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={recoverConfirm}
                onChange={(event) => setRecoverConfirm(event.target.value)}
                placeholder={t("auth.register.confirmPasswordPlaceholder")}
                minLength={8}
                required
              />
              <span className="auth-field__hint">{t("auth.recover.signsOutHint")}</span>
            </label>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.recover.submitting") : t("auth.recover.submit")}
            </button>

            <p className="auth-form__switch">
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.recover.backToLogin")}
              </button>
            </p>
          </form>
        )}

      </div>
    </div>
  );
}
