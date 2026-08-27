import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";
import steamIcon from "../../../Icons/steam-glyph.svg";
import type { LoginProvider } from "../../lib/ghostboxApi.types";
import "./AuthScreen.scss";

type View = "login" | "register" | "recover" | "recoverDiscord" | "recoverPassword";

/** Every way into an account, in the order the modal offers them. GhostBox
 * sends no email, so this list is also the complete list of ways back in after
 * a forgotten password. Steam cannot create an account; Discord signs in an
 * existing link only. */
const PROVIDERS: ReadonlyArray<{ id: LoginProvider; icon: string; labelKey: string }> = [
  { id: "discord", icon: discordIcon, labelKey: "auth.provider.discord" },
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

/** Accounts are created with email + password only — the providers sign in
 * and recover, they never sign up. */
export function AuthScreen() {
  const {
    login,
    register,
    loginWithProvider,
    startSteamRecovery,
    startDiscordRecovery,
    confirmDiscordRecovery,
    completeRecovery,
    closeAuthModal,
  } = useAuth();
  const { t } = useSettings();
  const [view, setView] = useState<View>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Discord PIN recovery: the identifier names the GhostBox account, and the
  // PIN arrives on the Discord linked to it.
  const [recoverIdentifier, setRecoverIdentifier] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoverPinSent, setRecoverPinSent] = useState(false);

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
      await loginWithProvider(provider);
    } catch (submitError) {
      // A provider with no GhostBox account attached rejects with a message
      // that points to email + password signup — account creation is never
      // opened through a provider.
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

  /** Recovery step one. Steam proves the account through its OpenID callback;
   * Discord goes to the PIN flow, where the bot DMs the code to the linked
   * account. Either way what comes back is a ten-minute token that can do
   * nothing but set a password. */
  async function handleRecoverClick(provider: LoginProvider) {
    if (submitting) return;
    setError("");
    setNotice("");
    if (provider === "discord") {
      setRecoverIdentifier("");
      setRecoverCode("");
      setRecoverPinSent(false);
      setView("recoverDiscord");
      return;
    }
    setSubmitting(true);
    try {
      const recovery = await startSteamRecovery();
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

  /** Asks the bot to DM the recovery PIN. The answer is uniform for unknown
   * identifiers — the user is simply told to check their Discord. */
  async function handleRecoverDiscordSend() {
    if (submitting || !recoverIdentifier.trim()) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await startDiscordRecovery(recoverIdentifier.trim());
      setRecoverPinSent(true);
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoverDiscordConfirm() {
    if (submitting || recoverCode.length !== 6) return;
    setError("");
    setSubmitting(true);
    try {
      const recovery = await confirmDiscordRecovery(recoverIdentifier.trim(), recoverCode);
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

            <p className="auth-form__switch">
              {t("auth.register.haveAccount")}{" "}
              <button type="button" onClick={() => switchView("login")}>
                {t("auth.register.signIn")}
              </button>
            </p>
          </form>
        )}

        {view === "recoverDiscord" && (
          <div key={view} className="auth-form">
            <AuthTitle text={t("auth.recover.title")} />
            <p className="auth-form__subtitle">{t("auth.recover.discordSubtitle")}</p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.recover.discordIdentifierLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                autoFocus
                value={recoverIdentifier}
                onChange={(event) => setRecoverIdentifier(event.target.value)}
                placeholder={t("auth.recover.discordIdentifierPlaceholder")}
                disabled={recoverPinSent}
              />
            </label>

            {!recoverPinSent ? (
              <button
                className="auth-form__submit"
                type="button"
                onClick={() => void handleRecoverDiscordSend()}
                disabled={submitting || !recoverIdentifier.trim()}
              >
                {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
                {submitting ? t("auth.recover.discordSending") : t("auth.recover.discordSend")}
              </button>
            ) : (
              <>
                <p className="auth-form__notice">{t("auth.recover.discordSent")}</p>

                <label className="auth-field">
                  <span className="auth-field__label">{t("auth.recover.discordCodeLabel")}</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoFocus
                    value={recoverCode}
                    onChange={(event) => setRecoverCode(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={t("auth.recover.discordCodePlaceholder")}
                    required
                  />
                </label>

                {error && <p className="auth-form__error">{error}</p>}

                <button
                  className="auth-form__submit"
                  type="button"
                  onClick={() => void handleRecoverDiscordConfirm()}
                  disabled={submitting || recoverCode.length !== 6}
                >
                  {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
                  {submitting ? t("auth.recover.submitting") : t("auth.recover.discordConfirm")}
                </button>

                <button
                  type="button"
                  className="auth-form__link"
                  onClick={() => void handleRecoverDiscordSend()}
                  disabled={submitting}
                >
                  {t("auth.recover.discordResend")}
                </button>
              </>
            )}

            <p className="auth-form__switch">
              <button type="button" onClick={() => switchView("recover")}>
                {t("auth.recover.backToLogin")}
              </button>
            </p>
          </div>
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
