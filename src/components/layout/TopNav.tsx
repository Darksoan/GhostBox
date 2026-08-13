import { memo, useEffect, useState } from "react";
import type { Page } from "../../types";
import { useSettings } from "../../context/settings";
import {
  downloadTasksChangedEvent,
  getActiveDownloadCount,
} from "../../lib/downloadManager";
import { primaryNavigation, secondaryNavigation } from "./navigationItems";

const navigationItems = [...primaryNavigation, ...secondaryNavigation];

interface TopNavProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

export const TopNav = memo(function TopNav({
  activePage,
  onNavigate,
}: TopNavProps) {
  const { t } = useSettings();
  const [activeDownloadCount, setActiveDownloadCount] = useState(() =>
    getActiveDownloadCount()
  );

  useEffect(() => {
    const refresh = () => setActiveDownloadCount(getActiveDownloadCount());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, []);

  return (
    <nav className="top-nav" aria-label="Navegação principal">
      <ul className="top-nav__list">
        {navigationItems.map(({ id, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          const isActive = activePage === id;

          return (
            <li key={id}>
              <button
                type="button"
                className={`top-nav__tab${isActive ? " top-nav__tab--active" : ""}`}
                onClick={() => onNavigate(id)}
                aria-current={isActive ? "page" : undefined}
                title={label}
              >
                <Icon
                  className="top-nav__icon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="top-nav__label">{label}</span>
                {id === "downloads" && activeDownloadCount > 0 && (
                  <strong className="top-nav__badge">
                    {activeDownloadCount > 99 ? "99+" : activeDownloadCount}
                  </strong>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
});
