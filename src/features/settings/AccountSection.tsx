import { LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/settings";
import "./AccountSection.scss";

export function AccountSection() {
  const { t } = useSettings();
  const { account, logout } = useAuth();

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

            </div>
        </div>
      </div>

    </section>
  );
}
