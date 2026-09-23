import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../../components/ui/ModalCloseIcon";
import "./AccountSection.scss";

export function AccountSection() {
  const { t } = useSettings();
  const { account, logout } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelRef.current?.focus();
  }, [confirmOpen]);

  const closeConfirm = () => {
    setConfirmOpen(false);
    triggerRef.current?.focus();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeConfirm();
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  if (!account) return null;

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
                ref={triggerRef}
                type="button"
                className="account-section__icon"
                onClick={() => setConfirmOpen(true)}
                aria-label={t("settings.general.account.signOut")}
              >
                <LogOut size={20} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>

            <div className="account-section__row">
              <span className="account-section__label">{t("settings.general.account.email")}</span>
              <span className="account-section__value">
                {account.email || t("settings.general.account.noEmail")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && typeof document !== "undefined" && createPortal(
        <div className="backdrop backdrop--confirm" onClick={closeConfirm}>
          <div
            className="collection-modal account-section__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="account-sign-out-title"
            aria-describedby="account-sign-out-description"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
          >
            <header className="collection-modal__header">
              <div>
                <h3 id="account-sign-out-title">{t("settings.general.account.signOutConfirmTitle")}</h3>
                <p id="account-sign-out-description">{t("settings.general.account.signOutDescription")}</p>
              </div>
              <button
                type="button"
                className="collection-modal__close"
                onClick={closeConfirm}
                aria-label={t("settings.general.account.signOutClose")}
              >
                <ModalCloseIcon />
              </button>
            </header>
            <div className="collection-modal__content">
              <div className="collection-modal__actions">
                <button ref={cancelRef} type="button" className="button button--outline" onClick={closeConfirm}>
                  {t("settings.general.account.signOutCancel")}
                </button>
                <button type="button" className="button button--primary" onClick={() => void logout()}>
                  {t("settings.general.account.signOut")}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
