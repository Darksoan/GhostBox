import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import discordIcon from "../../../Icons/discord.svg";
import steamIcon from "../../../Icons/steam-glyph.svg";
import type { LoginProvider } from "../../lib/ghostboxApi.types";
import "./AuthScreen.scss";

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
  return (
    <h1 className="auth-form__title">
      <img className="auth-form__title-icon" src={ghostLogo} alt="" />
      {text}
    </h1>
  );
}

export function AuthScreen() {
  const { loginWithProvider, closeAuthModal } = useAuth();
  const { t } = useSettings();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

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
  }, [error, submitting]);

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
      await loginWithProvider(provider);
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
        <div className="auth-form">
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
      </div>
    </div>
  );
}
