import { useRef, useState, type FormEvent } from "react";
import { Loader2, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import "./AccountSection.scss";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

const DELETE_CONFIRM_PT = "EXCLUIR";
const DELETE_CONFIRM_EN = "DELETE";

export function AccountSection() {
  const { t, appearance } = useSettings();
  const { account, logout, deleteAccount } = useAuth();
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [confirmInvalid, setConfirmInvalid] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  if (!account) return null;

  const confirmWord = appearance.language === "en" ? DELETE_CONFIRM_EN : DELETE_CONFIRM_PT;

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    if (deleting) return;
    if (confirmText.trim().toUpperCase() !== confirmWord) {
      setConfirmInvalid(true);
      setError(t("settings.general.account.deleteConfirmError"));
      confirmInputRef.current?.focus();
      return;
    }
    setDeleting(true);
    setConfirmInvalid(false);
    setError("");
    try {
      await deleteAccount();
    } catch (deleteError) {
      setError(errorMessage(deleteError, t("settings.general.account.deleteError")));
      setDeleting(false);
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
              <span className="account-section__label">{t("settings.general.account.username")}</span>
              <span className="account-section__value">{account.username}</span>
              <button
                type="button"
                className="account-section__icon"
                onClick={() => void logout()}
                aria-label={t("settings.general.account.signOut")}
              >
                <LogOut size={15} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>

            <div className="account-section__row">
              <span className="account-section__label">{t("settings.general.account.email")}</span>
              <span className="account-section__value">
                {account.email || t("settings.general.account.noEmail")}
              </span>
            </div>

            <p className="account-section__note">{t("settings.general.account.providersNote")}</p>
          </div>
        </div>
      </div>

      <form className="account-section__danger" onSubmit={onDelete}>
        <h3>{t("settings.general.account.deleteTitle")}</h3>
        <p>{t("settings.general.account.deleteDescription")}</p>
        <label className="auth-field">
          <span className="auth-field__label">{t("settings.general.account.deleteConfirmLabel")}</span>
          <input
            ref={confirmInputRef}
            name="delete-confirmation"
            className="auth-field__input"
            type="text"
            value={confirmText}
            onChange={(event) => {
              setConfirmText(event.target.value);
              setConfirmInvalid(false);
            }}
            placeholder={t("settings.general.account.deleteConfirmPlaceholder")}
            autoComplete="off"
            aria-invalid={confirmInvalid}
            aria-describedby={confirmInvalid ? "account-delete-error" : undefined}
          />
        </label>
        <button
          type="submit"
          className="account-section__danger-button"
          disabled={deleting}
        >
          {deleting ? <Loader2 size={14} className="account-section__spinner" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
          {deleting ? t("settings.general.account.deleting") : t("settings.general.account.delete")}
        </button>
      </form>

      {error && <p id="account-delete-error" className="account-section__error" role="alert">{error}</p>}
    </section>
  );
}
