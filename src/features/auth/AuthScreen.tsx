import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";
import steamIcon from "../../../Icons/steam-glyph.svg";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { LoginProvider } from "../../lib/ghostboxApi.types";
import "./AuthScreen.scss";

const TERMS_URL = "https://github.com/Darksoan/GhostBox/blob/main/POLICIES.md#terms-of-service";
const PRIVACY_URL = "https://github.com/Darksoan/GhostBox/blob/main/POLICIES.md#privacy-policy";

/** Every way into an account, in the order the modal offers them. There is
 * no password: the provider account is the key. */
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
  const brand = "GHOSTBOX";
  const brandStart = text.lastIndexOf(brand);
  const prefix = brandStart >= 0 ? text.slice(0, brandStart) : text;

  return (
    <h1 id="auth-dialog-title" className="auth-form__title">
      <img className="auth-form__title-icon" src={ghostLogo} alt="" width="28" height="28" />
      <span className="auth-form__title-copy">
        <span className="auth-form__title-prefix">{prefix}</span>
        {brandStart >= 0 && <span translate="no">{brand}</span>}
      </span>
    </h1>
  );
}

export function AuthScreen() {
  const { loginWithProvider, closeAuthModal } = useAuth();
  const { t } = useSettings();
  const [submittingProvider, setSubmittingProvider] = useState<LoginProvider | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const submitting = submittingProvider !== null;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const card = cardRef.current;
    if (!card) return;

    const focusableElements = () => Array.from(card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ));

    focusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAuthModal();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [closeAuthModal]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) closeAuthModal();
    },
    [closeAuthModal],
  );

  async function handleProviderClick(provider: LoginProvider) {
    if (submitting) return;
    setError("");
    setSubmittingProvider(provider);
    try {
      await loginWithProvider(provider);
      closeAuthModal();
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSubmittingProvider(null);
    }
  }

  function openLegalDocument(url: string) {
    void ghostboxApi.openExternalUrl(url).catch(() => undefined);
  }

  return (
    <div className="auth-screen" onMouseDown={handleBackdropClick}>
      <div
        ref={cardRef}
        className="auth-screen__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <div className="auth-form">
          <header className="auth-form__header">
            <AuthTitle text={t("auth.login.title")} />
          </header>

          {error && <p className="auth-form__error" role="alert">{error}</p>}

          <div className="auth-form__providers">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="auth-form__provider"
                onClick={() => void handleProviderClick(provider.id)}
                disabled={submitting || !termsAccepted}
                aria-busy={submittingProvider === provider.id}
                data-provider={provider.id}
              >
                <span className="auth-form__provider-icon-slot" aria-hidden="true">
                  <img
                    className="auth-form__provider-icon"
                    src={provider.icon}
                    alt=""
                    width="30"
                    height="30"
                  />
                </span>
                <span aria-live="polite">
                  {submittingProvider === provider.id
                    ? t("auth.provider.signingIn")
                    : t(provider.labelKey)}
                </span>
              </button>
            ))}
          </div>

          <footer className="auth-form__legal">
            <label className="auth-form__consent">
              <input
                type="checkbox"
                name="accept-policies"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
              />
              <span className="auth-form__consent-toggle" aria-hidden="true">
                <svg viewBox="0 0 10.1668 10.1668" width={12} height={12}>
                  <path d="M1 5.52L3.92 9.17L9.17 1" />
                </svg>
              </span>
              <span>{t("auth.login.legalNotice")}</span>
            </label>
            <div className="auth-form__legal-links">
              <button type="button" onClick={() => openLegalDocument(TERMS_URL)}>
                {t("auth.login.terms")}
              </button>
              <span aria-hidden="true">-</span>
              <button type="button" onClick={() => openLegalDocument(PRIVACY_URL)}>
                {t("auth.login.privacy")}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
