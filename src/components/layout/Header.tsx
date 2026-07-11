import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  Heart,
  LoaderCircle,
  Minus,
  Search,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { memo, useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { GhostBoxGame } from "../../data";
import { loadGames } from "../../data";
import type { Page, SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { UpdateCheckResult } from "../../lib/ghostboxApi.types";
import { preloadGameModalAssetsThrottled } from "../../utils/image";
import {
  readNotificationsLastSeenAt,
  writeNotificationsLastSeenAt,
} from "../../utils/storage";
import { FeedbackModal } from "../modals/FeedbackModal";
import discordIcon from "../../../Icons/discord.svg";
import feedbackIcon from "../../assets/icons/message.png";

const discordInviteUrl = "https://discord.gg/Y7XTy5rKBc";

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
  canGoForward?: boolean;
  query: string;
  isSearching: boolean;
  suggestions: GhostBoxGame[];
  allowSearchDropdown?: boolean;
  favoriteGameIds?: Set<string>;
  addedGameAppIds?: Set<string>;
  steamProfile?: SteamProfile | null;
  isPremium?: boolean;
  subscriptionPeriodEnd?: string | null;
  onQueryChange: (query: string) => void;
  onSelectSuggestion: (game: GhostBoxGame) => void;
  onBack: () => void;
  onForward: () => void;
  onNavigateToNotifications?: () => void;
  onClickPremium?: () => void;
}

function formatSubscriptionExpiry(value: string | null | undefined, language: "pt" | "en") {
  if (!value) return null;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const parts = new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(timestamp);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = getPart("day");
  const month = getPart("month");
  const year = getPart("year");
  const hour = getPart("hour");
  const minute = getPart("minute");

  return {
    date: language === "en" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`,
    time: `${hour}:${minute}`,
  };
}

export const Header = memo(function Header({
  page,
  canGoBack = false,
  canGoForward = false,
  query,
  isSearching,
  suggestions,
  allowSearchDropdown = false,
  favoriteGameIds = new Set(),
  addedGameAppIds = new Set(),
  steamProfile = null,
  isPremium = false,
  subscriptionPeriodEnd = null,
  onQueryChange,
  onSelectSuggestion,
  onBack,
  onForward,
  onNavigateToNotifications,
  onClickPremium,
}: HeaderProps) {
  const { t, appearance } = useSettings();
  const [focused, setFocused] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updatePercent, setUpdatePercent] = useState(0);
  const [updatePhase, setUpdatePhase] = useState<"download" | "install" | "error">("download");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const lastSeenRef = useRef<number>(readNotificationsLastSeenAt());
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
  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a, [role='button']")) return;

    void getCurrentWindow().startDragging();
  }, []);

  const refreshUnreadNotifications = useCallback(() => {
    const seenAt = lastSeenRef.current;
    void loadGames({ limit: 200, sort: "recentlyAdded" })
      .then((database) => {
        const count = database.games.reduce((total, game) => {
          const addedAt = game.databaseAddedAt ?? 0;
          return addedAt > seenAt ? total + 1 : total;
        }, 0);
        setUnreadNotificationCount(count);
      })
      .catch(() => setUnreadNotificationCount(0));
  }, []);

  // Badge count is independent of the active page: refresh on mount, on
  // catalogue cache updates, and when the notifications page is left.
  useEffect(() => {
    refreshUnreadNotifications();
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      refreshUnreadNotifications();
    });
  }, [refreshUnreadNotifications]);

  // Mark as seen when entering the notifications page; update the seen
  // watermark and clear the badge without re-running loadGames.
  useEffect(() => {
    if (page !== "notifications") return;
    const now = Date.now();
    lastSeenRef.current = now;
    writeNotificationsLastSeenAt(now);
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
    if (!update?.updateAvailable || isUpdating) return;

    setIsUpdating(true);
    setUpdatePercent(0);
    setUpdatePhase("download");
    setUpdateError(null);

    void ghostboxApi
      .installUpdate((progress) => {
        if (progress.event === "Started" || progress.event === "Progress") {
          setUpdatePhase("download");
          setUpdatePercent(progress.percent);
        }
        if (progress.event === "Finished") {
          setUpdatePhase("install");
          setUpdatePercent(100);
        }
      })
      .then((result) => {
        if (!result.success) {
          setUpdatePhase("error");
          setUpdateError(result.error || (appearance.language === "en" ? "Update failed." : "Falha na atualização."));
          setIsUpdating(false);
        }
      })
      .catch((error: unknown) => {
        setUpdatePhase("error");
        setUpdateError(
          error instanceof Error
            ? error.message
            : appearance.language === "en"
              ? "Update failed."
              : "Falha na atualização."
        );
        setIsUpdating(false);
      });
  }, [appearance.language, isUpdating, update?.updateAvailable]);

  const updateLabel = appearance.language === "en"
    ? `Update GhostBox ${update?.latestVersion ?? ""}`
    : `Atualizar GhostBox ${update?.latestVersion ?? ""}`;

  const tooltipText = appearance.language === "en"
    ? `New version available: v${update?.latestVersion ?? ""}`
    : `Nova versão disponível: v${update?.latestVersion ?? ""}`;
  const premiumExpiryText = formatSubscriptionExpiry(subscriptionPeriodEnd, appearance.language);

  const updateStatusText =
    updatePhase === "error"
      ? updateError || (appearance.language === "en" ? "Update failed." : "Falha na atualização.")
      : updatePhase === "install"
        ? appearance.language === "en"
          ? "Installing update…"
          : "instalando atualização…"
        : appearance.language === "en"
          ? `Downloading update… ${updatePercent}%`
          : `baixando atualização… ${updatePercent}%`;

  const updateSplashStyle = {
    ["--app-splash-progress"]: `${updatePercent}%`,
  } as CSSProperties;

  return (
    <header className="header" onPointerDown={handleHeaderPointerDown}>
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
        <button
          type="button"
          className="header__nav-btn"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label={t("header.forward")}
        >
          <ChevronRight size={17} strokeWidth={2.0} aria-hidden="true" />
        </button>
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
        {isPremium && (
          <button
            type="button"
            className="header__premium-indicator"
            aria-label="Premium"
            onClick={onClickPremium}
          >
            <Crown className="header__premium-crown" size={18} aria-hidden="true" />
            <span className="header__premium-label">
              {appearance.language === "en" ? "Subscription" : "Assinatura"}
            </span>
            <span className="header__tooltip header__tooltip--premium">
              {premiumExpiryText ? (
                <>
                  {appearance.language === "en" ? "Expires on " : "Expira em "}
                  <span className="header__tooltip-date">{premiumExpiryText.date}</span>
                  <span className="header__tooltip-connector">{appearance.language === "en" ? " at " : " às "}</span>
                  <span className="header__tooltip-date">{premiumExpiryText.time}</span>
                  {"."}
                </>
              ) : (
                appearance.language === "en" ? "Active subscription." : "Assinatura ativa."
              )}
            </span>
          </button>
        )}
        <button
          type="button"
          className="header__icon-button header__notification-button"
          aria-label={
            unreadNotificationCount > 0
              ? `${t("header.notifications")} (${unreadNotificationCount})`
              : t("header.notifications")
          }
          onClick={() => {
            const now = Date.now();
            lastSeenRef.current = now;
            writeNotificationsLastSeenAt(now);
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
                          onFocus={() => preloadGameModalAssetsThrottled(game)}
                          onMouseEnter={() => preloadGameModalAssetsThrottled(game)}
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
      {isUpdating && (
        <div className="update-splash" role="dialog" aria-modal="true" aria-label={updateStatusText}>
          <div className="update-splash__panel">
            <img className="update-splash__icon" src="/ghost-solid.png" alt="" />
            <div
              className="update-splash__spinner"
              style={updateSplashStyle}
              aria-hidden="true"
            />
            <p className="update-splash__title">
              {appearance.language === "en" ? "Updating GhostBox" : "Atualizando GhostBox"}
            </p>
            <p className="update-splash__status">{updateStatusText}</p>
            {updatePhase === "error" && (
              <button
                type="button"
                className="update-splash__dismiss"
                onClick={() => {
                  setIsUpdating(false);
                  setUpdateError(null);
                  setUpdatePhase("download");
                  setUpdatePercent(0);
                }}
              >
                {appearance.language === "en" ? "Close" : "Fechar"}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
});
