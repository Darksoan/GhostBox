import { useState, type FormEvent } from "react";
import { Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { useDiscordLink } from "./useDiscordLink";
import "./AccountSection.scss";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function AccountSection() {
  const { t } = useSettings();
  const { account, logout, refreshAccount } = useAuth();
  const discord = useDiscordLink();
  const [error, setError] = useState("");

  // One button drives the whole thing: link the Discord if it is not linked
  // yet, then ask the bot for a PIN. Requiring the user to go to Connections
  // first made verification a two-screen errand for no reason.
  const [verifying, setVerifying] = useState(false);
  const [codePrompt, setCodePrompt] = useState(false);
  const [code, setCode] = useState("");
  const [confirmingCode, setConfirmingCode] = useState(false);

  if (!account) return null;

  async function sendCode() {
    await ghostboxApi.sendDiscordVerificationCode();
    setCode("");
    setCodePrompt(true);
  }

  async function onVerifyClick() {
    if (verifying) return;
    setVerifying(true);
    setError("");
    try {
      if (!discord.status?.linked) {
        const linked = await discord.connect();
        if (!linked?.linked) {
          setError(t("settings.general.account.discordLinkCancelled"));
          return;
        }

        // Linking can settle it outright: when Discord vouches for the very
        // address on file, the callback already marked the account verified
        // and there is nothing to send a PIN for.
        const fresh = await refreshAccount();
        if (fresh && (fresh.emailVerified || fresh.verifiedVia)) return;
      }

      await sendCode();
    } catch (submitError) {
      setError(errorMessage(submitError, t("settings.general.account.discordCodeError")));
    } finally {
      setVerifying(false);
    }
  }

  async function onResendClick() {
    if (verifying || confirmingCode) return;
    setVerifying(true);
    setError("");
    try {
      await sendCode();
    } catch (submitError) {
      setError(errorMessage(submitError, t("settings.general.account.discordCodeError")));
    } finally {
      setVerifying(false);
    }
  }

  async function onConfirmDiscordCode(event: FormEvent) {
    event.preventDefault();
    if (confirmingCode) return;
    setConfirmingCode(true);
    setError("");
    try {
      await ghostboxApi.confirmDiscordVerificationCode(code.trim());
      setCodePrompt(false);
      setCode("");
      await refreshAccount();
    } catch (submitError) {
      setError(errorMessage(submitError, t("settings.general.account.discordCodeError")));
    } finally {
      setConfirmingCode(false);
    }
  }

  const verified = account.emailVerified || account.verifiedVia !== null;

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
              {verified ? (
                <span className="account-section__verified">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {account.verifiedVia === "discord"
                    ? t("settings.general.account.verifiedViaDiscord")
                    : t("settings.general.account.verified")}
                </span>
              ) : (
                !codePrompt && (
                  <button
                    type="button"
                    className="account-section__action"
                    onClick={() => void onVerifyClick()}
                    disabled={verifying}
                  >
                    {verifying ? (
                      <Loader2 size={12} className="account-section__spinner" aria-hidden="true" />
                    ) : null}
                    {verifying
                      ? t("settings.general.account.discordCodeSending")
                      : t("settings.general.account.verifyByDiscord")}
                  </button>
                )
              )}
            </div>

            {codePrompt && (
              <form className="account-section__code" onSubmit={onConfirmDiscordCode}>
                <span className="account-section__value">
                  {t("settings.general.account.discordCodePrompt")}
                </span>
                <input
                  className="account-section__code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  aria-label={t("settings.general.account.discordCodePrompt")}
                />
                <button
                  type="submit"
                  className="account-section__action"
                  disabled={confirmingCode || code.length !== 6}
                >
                  {confirmingCode ? (
                    <Loader2 size={12} className="account-section__spinner" aria-hidden="true" />
                  ) : null}
                  {t("settings.general.account.discordCodeConfirm")}
                </button>
                {/* Without these the prompt was a dead end: an expired code, a
                    DM that never arrived, or five wrong guesses (the worker
                    drops the code at that point) all left the user with an
                    input that could no longer succeed and no way back. */}
                <button
                  type="button"
                  className="account-section__action"
                  onClick={() => void onResendClick()}
                  disabled={verifying || confirmingCode}
                >
                  {t("settings.general.account.discordCodeResend")}
                </button>
                <button
                  type="button"
                  className="account-section__action"
                  onClick={() => {
                    setCodePrompt(false);
                    setCode("");
                    setError("");
                  }}
                  disabled={confirmingCode}
                >
                  {t("settings.general.account.discordCodeCancel")}
                </button>
              </form>
            )}

            <div className="account-section__row">
              <span className="account-section__label">{t("settings.general.account.username")}</span>
              <span className="account-section__value">{account.username}</span>
              <button
                type="button"
                className="account-section__icon"
                onClick={() => void logout()}
                aria-label={t("settings.general.account.signOut")}
                title={t("settings.general.account.signOut")}
              >
                <LogOut size={15} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="account-section__error">{error}</p>}
    </section>
  );
}
