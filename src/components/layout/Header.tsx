import {
  Bell,
  ChevronLeft,
  Download,
  Heart,
  LoaderCircle,
  Minus,
  Search,
  X,
} from "lucide-react";
import { memo, useState, useCallback, useEffect, useMemo } from "react";
import type { GhostBoxGame } from "../../data";
import { loadGames } from "../../data";
import type { Page, SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { UpdateCheckResult } from "../../lib/ghostboxApi.types";
import { preloadGameModalAssets } from "../../utils/image";
import {
  readNotificationsLastSeenAt,
  writeNotificationsLastSeenAt,
} from "../../utils/storage";
import { FeedbackModal } from "../modals/FeedbackModal";
import discordIcon from "../../../Icons/discord.svg";
import feedbackIcon from "../../assets/icons/message.png";

const discordInviteUrl = "https://discord.gg/Y7XTy5rKBc";

const pageTitleKeys: Record<Page, string> = {
  home: "header.home",
  catalogue: "header.catalogue",
  library: "header.library",
  favorites: "header.favorites",
  settings: "header.settings",
  profile: "header.profile",
  notifications: "header.notifications",
};

const HighlightedSearchText = memo(function HighlightedSearchText({
  text,
}: {
  text: string;
}) {
  return <>{text}</>;
});

interface HeaderProps {
  page: Page;
  canGoBack?: boolean;
  /** Overrides the tab label (e.g. game title while a modal is open). */
  navigationTitle?: string | null;
  query: string;
  isSearching: boolean;
  suggestions: GhostBoxGame[];
  allowSearchDropdown?: boolean;
  favoriteGameIds?: Set<string>;
  addedGameAppIds?: Set<string>;
  steamProfile?: SteamProfile | null;
  onQueryChange: (query: string) => void;
  onSelectSuggestion: (game: GhostBoxGame) => void;
  onBack: () => void;
  onNavigateToNotifications?: () => void;
}

export const Header = memo(function Header({
  page,
  canGoBack = false,
  navigationTitle = null,
  query,
  isSearching,
  suggestions,
  allowSearchDropdown = false,
  favoriteGameIds = new Set(),
  addedGameAppIds = new Set(),
  steamProfile = null,
  onQueryChange,
  onSelectSuggestion,
  onBack,
  onNavigateToNotifications,
}: HeaderProps) {
  const { t, appearance } = useSettings();
  const pageTitle = useMemo(() => {
    const override = navigationTitle?.trim();
    if (override) return override;
    return t(pageTitleKeys[page]);
  }, [navigationTitle, page, t]);
  const [focused, setFocused] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const showDropdown =
    (page !== "catalogue" || allowSearchDropdown) &&
    focused &&
    Boolean(query.trim()) &&
    (suggestions.length > 0 || isSearching);

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !event.currentTarget.contains(nextTarget))
        setFocused(false);
    },
    []
  );

  const handleFocus = useCallback(() => setFocused(true), []);

  const handleFeedbackClick = useCallback(() => {
    setFeedbackModalOpen(true);
  }, []);

  const handleDiscordClick = useCallback(() => {
    void ghostboxApi.openExternalUrl(discordInviteUrl);
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onQueryChange(event.target.value),
    [onQueryChange]
  );

  const handleMinimize = useCallback(() => void ghostboxApi.minimize(), []);
  const handleClose = useCallback(() => void ghostboxApi.close(), []);

  const refreshUnreadNotifications = useCallback(() => {
    if (page === "notifications") {
      setUnreadNotificationCount(0);
      return;
    }

    void loadGames({ limit: 200, sort: "recentlyAdded" })
      .then((database) => {
        const lastSeen = readNotificationsLastSeenAt();
        const count = database.games.reduce((total, game) => {
          const addedAt = game.databaseAddedAt ?? 0;
          return addedAt > lastSeen ? total + 1 : total;
        }, 0);
        setUnreadNotificationCount(count);
      })
      .catch(() => setUnreadNotificationCount(0));
  }, [page]);

  useEffect(() => {
    refreshUnreadNotifications();
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      refreshUnreadNotifications();
    });
  }, [refreshUnreadNotifications]);

  useEffect(() => {
    if (page !== "notifications") return;
    writeNotificationsLastSeenAt(Date.now());
    setUnreadNotificationCount(0);
  }, [page]);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = () => {
      void ghostboxApi.checkForUpdates().then((result) => {
        if (!cancelled) setUpdate(result?.updateAvailable ? result : null);
      });
    };

    checkForUpdates();
    const interval = window.setInterval(checkForUpdates, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const handleInstallUpdate = useCallback(() => {
    if (!update?.installerUrl || isUpdating) return;

    setIsUpdating(true);
    void ghostboxApi.installUpdate(update.installerUrl).finally(() => {
      setIsUpdating(false);
    });
  }, [isUpdating, update?.installerUrl]);

  const updateLabel = appearance.language === "en"
    ? `Download GhostBox ${update?.latestVersion ?? ""}`
    : `Baixar GhostBox ${update?.latestVersion ?? ""}`;

  const tooltipText = appearance.language === "en"
    ? `New version available: v${update?.latestVersion ?? ""}`
    : `Nova versão disponível: v${update?.latestVersion ?? ""}`;

  return (
    <header className="header">
      <div className="header__section header__section--left header__navigation-controls">
        <button
          type="button"
          className="header__nav-btn"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label={t("header.back")}
        >
          <ChevronLeft size={17} strokeWidth={2.0} aria-hidden="true" />
        </button>
        <span className="header__page-title" title={pageTitle}>
          {pageTitle}
        </span>
      </div>

      <div className="header__section">
        <button
          type="button"
          className="header__icon-button header__feedback-button"
          aria-label={t("header.feedback")}
          onClick={handleFeedbackClick}
        >
          <img
            className="header__feedback-icon"
            src={feedbackIcon}
            alt=""
            width={20}
            height={20}
            draggable={false}
            decoding="async"
            aria-hidden="true"
          />
          <span className="header__tooltip">
            {t("header.feedback")}
          </span>
        </button>
        <button
          type="button"
          className="header__icon-button header__discord-button"
          aria-label={t("header.discord")}
          onClick={handleDiscordClick}
        >
          <img src={discordIcon} alt="" aria-hidden="true" />
          <span className="header__tooltip">
            Discord
          </span>
        </button>
        <button
          type="button"
          className="header__icon-button header__notification-button"
          aria-label={
            unreadNotificationCount > 0
              ? `${t("header.notifications")} (${unreadNotificationCount})`
              : t("header.notifications")
          }
          onClick={() => {
            writeNotificationsLastSeenAt(Date.now());
            setUnreadNotificationCount(0);
            onNavigateToNotifications?.();
          }}
        >
          <Bell size={18} />
          {unreadNotificationCount > 0 && (
            <span className="header__notification-badge" aria-hidden="true">
              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
            </span>
          )}
          <span className="header__tooltip">
            {t("header.notifications")}
          </span>
        </button>
        <div
          className="header__search-shell"
          onBlur={handleBlur}
        >
          <label
            className={`header__search ${focused ? "header__search--focused" : ""} ${isSearching ? "header__search--loading" : ""}`}
          >
            <Search size={16} />
            <input
              value={query}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder={t("header.searchPlaceholder")}
            />
            {isSearching && (
              <span className="header__search-loader" aria-hidden="true" />
            )}
          </label>

          {showDropdown && (
            <div className="header__search-dropdown">
              {suggestions.length > 0 ? (
                <ul className="header__search-dropdown-list">
                  {suggestions.map((game) => {
                    const isFavorite = favoriteGameIds.has(game.id);
                    const isAdded = addedGameAppIds.has(game.appId);
                    return (
                      <li key={game.id}>
                        <button
                          type="button"
                          className="header__search-dropdown-item"
                          onMouseDown={(event) => event.preventDefault()}
                          onFocus={() => preloadGameModalAssets(game)}
                          onMouseEnter={() => preloadGameModalAssets(game)}
                          onClick={() => {
                            setFocused(false);
                            onSelectSuggestion(game);
                          }}
                        >
                          <span>
                            <HighlightedSearchText
                              text={game.title}
                            />
                          </span>
                          <div className="header__search-dropdown-item__icons">
                            {isAdded && (
                              <Heart
                                size={14}
                                fill={isFavorite ? "#d3d3d3" : "none"}
                                stroke={isFavorite ? "#d3d3d3" : "currentColor"}
                              />
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="header__search-dropdown-loading">
                  {t("header.searching")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="header__window-controls">
          {update && (
            <button
              type="button"
              className="header__window-controls-update"
              aria-label={updateLabel}
              onClick={handleInstallUpdate}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <LoaderCircle className="header__window-controls-spinner" size={17} />
              ) : (
                <Download size={17} />
              )}
              <span className="header__tooltip">
                {tooltipText}
              </span>
            </button>
          )}
          <button
            type="button"
            className="header__window-controls-button"
            aria-label={appearance.language === "en" ? "Minimize" : "Minimizar"}
            onClick={handleMinimize}
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            className="header__window-controls-button header__window-controls-button--close"
            aria-label={appearance.language === "en" ? "Close" : "Fechar"}
            onClick={handleClose}
          >
            <X size={17} />
          </button>
        </div>
      </div>
      <FeedbackModal
        open={feedbackModalOpen}
        steamProfile={steamProfile}
        onClose={() => setFeedbackModalOpen(false)}
      />
    </header>
  );
});