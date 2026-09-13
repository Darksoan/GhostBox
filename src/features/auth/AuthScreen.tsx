import { useCallback, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";
import steamIcon from "../../../Icons/steam-glyph.svg";
import type { LoginProvider, ProviderSignupRequired } from "../../lib/ghostboxApi.types";
import "./AuthScreen.scss";

type View = "login" | "signup";

/** Every way into an account, in the order the modal offers them. There is
 * no password: the provider account IS the key, and an unlinked provider
 * opens the one-step signup instead of failing. */
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

type PendingSignup = {
  provider: LoginProvider;
  /** Discord: the still-unspent ticket for the signup call. */
  ticket?: string;
  /** Steam: the still-unspent callback URL for the signup call. */
  callbackUrl?: string;
  suggestedUsername: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

function pendingFromPayload(provider: LoginProvider, payload: ProviderSignupRequired): PendingSignup {
  return {
    provider,
    ticket: payload.ticket,
    callbackUrl: payload.callbackUrl,
    suggestedUsername: payload.suggestedUsername || (provider === "steam" ? "steam_user" : "discord_user"),
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl,
  };
}

export function AuthScreen() {
  const { loginWithProvider, signupWithProvider, signupWithSteam, closeAuthModal } = useAuth();
  const { t } = useSettings();
  const [view, setView] = useState<View>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [pending, setPending] = useState<PendingSignup | null>(null);
  const [username, setUsername] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  function switchToSignup(next: PendingSignup) {
    setPending(next);
    setUsername(next.suggestedUsername);
    setAcceptTerms(false);
    setError("");
    setView("signup");
  }

  function switchToLogin() {
    setView("login");
    setError("");
    setPending(null);
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
  }, [view, error, submitting]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) closeAuthModal();
    },
    [closeAuthModal],
  );

  async function handleProviderClick(provider: LoginProvider) {
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await loginWithProvider(provider);
      if ("account" in result && result.account) {
        closeAuthModal();
        return;
      }
      // Unlinked provider: the same browser flow already proved it, so the
      // signup confirmation reuses that proof instead of failing.
      switchToSignup(pendingFromPayload(provider, result as ProviderSignupRequired));
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignupSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !pending) return;
    setError("");
    if (!acceptTerms) {
      setError(t("auth.errors.terms_required"));
      return;
    }
    setSubmitting(true);
    try {
      if (pending.provider === "steam" && pending.callbackUrl) {
        await signupWithSteam(
          pending.callbackUrl,
          username.trim(),
          pending.displayName,
          pending.avatarUrl,
        );
      } else if (pending.ticket) {
        await signupWithProvider(pending.ticket, username.trim(), pending.displayName ?? undefined);
      } else {
        throw new Error(t("auth.errors.auth_error"));
      }
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
          <div key={view} className="auth-form">
            <AuthTitle text={t("auth.login.title")} />
            <p className="auth-form__subtitle">{t("auth.login.subtitle")}</p>

            {error && <p className="auth-form__error">{error}</p>}

            <div className="auth-form__providers">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className="auth-form__provider"
                  onClick={() => void handleProviderClick(provider.id)}
                  disabled={submitting}
                >
                  <img className="auth-form__provider-icon" src={provider.icon} alt="" aria-hidden="true" />
                  {submitting ? t("auth.provider.signingIn") : t(provider.labelKey)}
                </button>
              ))}
            </div>

            <p className="auth-form__hint-block">{t("auth.disclaimer")}</p>
          </div>
        )}

        {view === "signup" && pending && (
          <form key={view} className="auth-form" onSubmit={handleSignupSubmit}>
            <AuthTitle text={t("auth.signup.title")} />
            <p className="auth-form__subtitle">
              {t(pending.provider === "steam" ? "auth.signup.steamSubtitle" : "auth.signup.subtitle")}
            </p>

            <label className="auth-field">
              <span className="auth-field__label">{t("auth.signup.usernameLabel")}</span>
              <input
                className="auth-field__input"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("auth.signup.usernamePlaceholder")}
                pattern="[a-zA-Z0-9_]{3,20}"
                required
              />
              <span className="auth-field__hint">{t("auth.signup.usernameHint")}</span>
            </label>

            <label className="auth-field auth-field__terms">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(event) => setAcceptTerms(event.target.checked)}
                required
              />
              <span>{t("auth.signup.termsLabel")}</span>
            </label>

            {error && <p className="auth-form__error">{error}</p>}

            <button className="auth-form__submit" type="submit" disabled={submitting || !acceptTerms}>
              {submitting ? <Loader2 className="auth-form__spinner" size={16} /> : null}
              {submitting ? t("auth.signup.submitting") : t("auth.signup.submit")}
            </button>

            <p className="auth-form__hint-block">{t("auth.disclaimer")}</p>

            <p className="auth-form__switch">
              <button type="button" onClick={switchToLogin}>
                {t("auth.signup.backToLogin")}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
