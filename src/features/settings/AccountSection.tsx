import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import "./AccountSection.scss";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function AccountSection() {
  const { t } = useSettings();
  const { account, logout, changePassword } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  if (!account) return null;

  function resetForm() {
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setError("");
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await changePassword(currentPassword, newPassword);
      setSaved(true);
      resetForm();
    } catch (submitError) {
      setError(errorMessage(submitError, t("auth.errors.auth_error")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-section">
      <header className="account-section__header">
        <h2>{t("settings.general.account.title")}</h2>
      </header>

      <div className="account-section__info">
        <div className="account-section__row">
          <span className="account-section__label">{t("settings.general.account.email")}</span>
          <span className="account-section__value">{account.email}</span>
          <span
            className={`account-section__badge${
              account.emailVerified ? " account-section__badge--verified" : ""
            }`}
          >
            {account.emailVerified
              ? t("settings.general.account.verified")
              : t("settings.general.account.unverified")}
          </span>
        </div>
        <div className="account-section__row">
          <span className="account-section__label">{t("settings.general.account.username")}</span>
          <span className="account-section__value">{account.username}</span>
        </div>
      </div>

      {changingPassword ? (
        <form className="account-section__password-form" onSubmit={handleSave}>
          <input
            className="account-section__input"
            type="password"
            autoComplete="current-password"
            placeholder={t("settings.general.account.currentPassword")}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <input
            className="account-section__input"
            type="password"
            autoComplete="new-password"
            placeholder={t("settings.general.account.newPassword")}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            required
          />
          {error && <p className="account-section__error">{error}</p>}
          <div className="account-section__actions">
            <button type="submit" className="account-section__button account-section__button--primary" disabled={saving}>
              {saving ? <Loader2 size={14} className="account-section__spinner" aria-hidden="true" /> : null}
              {saving ? t("settings.general.account.saving") : t("settings.general.account.save")}
            </button>
            <button type="button" className="account-section__button" onClick={resetForm}>
              {t("feedback.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="account-section__actions">
          <button
            type="button"
            className="account-section__button"
            onClick={() => {
              setSaved(false);
              setChangingPassword(true);
            }}
          >
            {t("settings.general.account.changePassword")}
          </button>
          <button
            type="button"
            className="account-section__button account-section__button--danger"
            onClick={() => void logout()}
          >
            {t("settings.general.account.signOut")}
          </button>
        </div>
      )}

      {saved && !changingPassword && (
        <p className="account-section__saved">{t("settings.general.account.saved")}</p>
      )}
    </section>
  );
}
