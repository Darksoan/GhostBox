import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useAppData } from "../../context/AppDataContext";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import ghostLogo from "../../../Icons/ghost-solid.png";
import "./AccountSection.scss";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function AccountSection() {
  const { t } = useSettings();
  const { account, logout, resendVerificationEmail } = useAuth();
  const { steamProfile } = useAppData();
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!usernameCopied) return;
    const timeout = window.setTimeout(() => setUsernameCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [usernameCopied]);

  // The badge stays in its "sent" state long enough to read, then offers the
  // resend again — the worker throttles repeats on its own side.
  useEffect(() => {
    if (!verificationSent) return;
    const timeout = window.setTimeout(() => setVerificationSent(false), 8000);
    return () => window.clearTimeout(timeout);
  }, [verificationSent]);

  if (!account) return null;

  async function onCopyUsernameClick() {
    if (!account) return;
    await navigator.clipboard.writeText(account.username);
    setUsernameCopied(true);
  }

  async function onVerifyEmailClick() {
    if (sendingVerification || verificationSent) return;
    setSendingVerification(true);
    setError("");
    try {
      await resendVerificationEmail();
      setVerificationSent(true);
    } catch (submitError) {
      setError(errorMessage(submitError, t("settings.general.account.verifyEmailError")));
    } finally {
      setSendingVerification(false);
    }
  }

  return (
    <section className="account-section">
      <div className="account-section__top">
        <div className="account-section__main">
          <header className="account-section__header">
            <h2>{t("settings.general.account.title")}</h2>
          </header>

          <div className="account-section__info">
            <div className="account-section__row">
              <span className="account-section__label">{t("settings.general.account.email")}</span>
              <span className="account-section__value">{account.email}</span>
              {!account.emailVerified && (
                <button
                  type="button"
                  className={`account-section__badge${
                    verificationSent ? " account-section__badge--sent" : ""
                  }`}
                  onClick={() => void onVerifyEmailClick()}
                  disabled={sendingVerification || verificationSent}
                >
                  {sendingVerification ? (
                    <Loader2 size={11} className="account-section__spinner" aria-hidden="true" />
                  ) : verificationSent ? (
                    <Check size={11} aria-hidden="true" />
                  ) : null}
                  {sendingVerification
                    ? t("settings.general.account.verifyEmailSending")
                    : verificationSent
                      ? t("settings.general.account.verifyEmailSent")
                      : t("settings.general.account.verifyEmail")}
                </button>
              )}
            </div>
            <div className="account-section__row">
              <span className="account-section__label">{t("settings.general.account.username")}</span>
              <span className="account-section__value">{account.username}</span>
              <button
                type="button"
                className={`account-section__copy${
                  usernameCopied ? " account-section__copy--copied" : ""
                }`}
                onClick={() => void onCopyUsernameClick()}
                aria-label={
                  usernameCopied
                    ? t("settings.general.account.usernameCopied")
                    : t("settings.general.account.copyUsername")
                }
              >
                <span className="account-section__copy-icon account-section__copy-icon--copy">
                  <Copy size={12} aria-hidden="true" />
                </span>
                <span className="account-section__copy-icon account-section__copy-icon--check">
                  <Check size={12} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </div>

        <img
          className="account-section__avatar"
          src={steamProfile?.avatarUrl || ghostLogo}
          alt=""
          aria-hidden="true"
        />
      </div>

      {error && <p className="account-section__error">{error}</p>}

      <div className="account-section__actions">
        <button
          type="button"
          className="account-section__button account-section__button--danger"
          onClick={() => void logout()}
        >
          {t("settings.general.account.signOut")}
        </button>
      </div>
    </section>
  );
}
