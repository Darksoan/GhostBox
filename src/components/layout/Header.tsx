import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Crown,
  Download,
  Heart,
  Info,
  LoaderCircle,
  MessageSquareShare,
  Minus,
  Settings2,
  UserCog,
  Search,
  X,
} from "lucide-react";
import { memo, useState, useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import {
  appNotificationsChangedEvent,
  getUnreadAppNotificationCount,
  markAppNotificationsSeen,
} from "../../lib/appNotifications";
import type { SubscriptionPortalFlow, UpdateCheckResult } from "../../lib/ghostboxApi.types";
import { preloadGameModalAssetsThrottled } from "../../utils/image";
import {
  readNotificationsLastSeenAt,
  writeNotificationsLastSeenAt,
} from "../../utils/storage";
import { SearchSuggestionsLoadingState } from "../ui/LoadingStates";
import { FeedbackModal } from "../modals/FeedbackModal";


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
  hasNoSearchResults?: boolean;
  showAppIdPrompt?: boolean;
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
  onOpenSubscriptionPortal?: (flow: SubscriptionPortalFlow) => void;
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
  hasNoSearchResults = false,
  showAppIdPrompt = false,
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
  onOpenSubscriptionPortal,
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
  const [isSubscriptionMenuOpen, setIsSubscriptionMenuOpen] = useState(false);
  const lastSeenRef = useRef<number>(readNotificationsLastSeenAt());
  const subscriptionMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const titlebarDragRef = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    originX: number;
    originY: number;
    lastScreenX: number;
    lastScreenY: number;
    frame: number | null;
  } | null>(null);
  const showDropdown =
    (page !== "catalogue" || allowSearchDropdown) &&
    focused &&
    Boolean(query.trim()) &&
    (suggestions.length > 0 || hasNoSearchResults || showAppIdPrompt);

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
        setFocused(false);
      }
    },
    []
  );

  const handleFocus = useCallback(() => {
    setFocused(true);
  }, []);

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

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || isSearching) return;
      const firstSuggestion = suggestions[0];
      if (!firstSuggestion) return;
      event.preventDefault();
      setFocused(false);
      onSelectSuggestion(firstSuggestion);
    },
    [isSearching, onSelectSuggestion, suggestions]
  );

  const refreshUnreadNotifications = useCallback(() => {
    if (page === "notifications") {
      const now = Date.now();
      lastSeenRef.current = now;
      writeNotificationsLastSeenAt(now);
      setUnreadNotificationCount(0);
      return;
    }
    setUnreadNotificationCount(getUnreadAppNotificationCount());
  }, [page]);

  useEffect(() => {
    refreshUnreadNotifications();
    window.addEventListener(appNotificationsChangedEvent, refreshUnreadNotifications);
    return () => {
      window.removeEventListener(appNotificationsChangedEvent, refreshUnreadNotifications);
    };
  }, [refreshUnreadNotifications]);

  // Entering the page clears the unread watermark.
  useEffect(() => {
    if (page !== "notifications") return;
    const now = Date.now();
    lastSeenRef.current = now;
    markAppNotificationsSeen(now);
    setUnreadNotificationCount(0);
  }, [page]);

  useEffect(() => {
    if (!isSubscriptionMenuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!subscriptionMenuRef.current?.contains(event.target as Node)) {
        setIsSubscriptionMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSubscriptionMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isSubscriptionMenuOpen]);

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
  const openSubscriptionPortal = (flow: SubscriptionPortalFlow) => {
    setIsSubscriptionMenuOpen(false);
    onOpenSubscriptionPortal?.(flow);
  };

  const handleMinimize = useCallback(() => void ghostboxApi.minimize(), []);
  const handleClose = useCallback(() => void ghostboxApi.close(), []);

  const titlebarInteractiveSelector =
    "button, input, a, label, [role='button'], [role='menu'], [role='menuitem'], .header__search-shell, .header__subscription-menu, .header__window-controls";

  const flushTitlebarDrag = useCallback(() => {
    const drag = titlebarDragRef.current;
    if (!drag) return;
    drag.frame = null;
    const nextX = drag.originX + (drag.lastScreenX - drag.startScreenX);
    const nextY = drag.originY + (drag.lastScreenY - drag.startScreenY);
    void getCurrentWindow().setPosition(new LogicalPosition(nextX, nextY));
  }, []);

  const endTitlebarDrag = useCallback((pointerId?: number) => {
    const drag = titlebarDragRef.current;
    if (!drag) return;
    if (pointerId != null && drag.pointerId !== pointerId) return;
    if (drag.frame != null) {
      window.cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
    titlebarDragRef.current = null;
  }, []);

  const handleTitlebarPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest(titlebarInteractiveSelector)) {
      return;
    }

    // Keep grab offset exact: sync screen coords + window origin (no startDragging jump).
    event.preventDefault();
    titlebarDragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      originX: window.screenX,
      originY: window.screenY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      frame: null,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; move/up still work on the header.
    }
  }, []);

  const handleTitlebarPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = titlebarDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      if (drag.frame != null) return;
      drag.frame = window.requestAnimationFrame(flushTitlebarDrag);
    },
    [flushTitlebarDrag]
  );

  const handleTitlebarPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endTitlebarDrag(event.pointerId);
    },
    [endTitlebarDrag]
  );

  useEffect(() => {
    return () => {
      const drag = titlebarDragRef.current;
      if (drag?.frame != null) window.cancelAnimationFrame(drag.frame);
      titlebarDragRef.current = null;
    };
  }, []);

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
    <header
      className="header"
      onPointerDown={handleTitlebarPointerDown}
      onPointerMove={handleTitlebarPointerMove}
      onPointerUp={handleTitlebarPointerUp}
      onPointerCancel={handleTitlebarPointerUp}
      onLostPointerCapture={handleTitlebarPointerUp}
    >
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

      <div className="header__section header__section--actions">
        <button
          type="button"
          className="header__icon-button header__feedback-button"
          aria-label={t("header.feedback")}
          onClick={handleFeedbackClick}
        >
          <MessageSquareShare
            className="header__feedback-icon"
            size={18}
            strokeWidth={2}
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
          <svg
            role="img"
            viewBox="0 -28.5 256 256"
            width={18}
            height={18}
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
              fillRule="nonzero"
            />
          </svg>
          <span className="header__tooltip">
            Discord
          </span>
        </button>
        <div
          ref={subscriptionMenuRef}
          className={`header__subscription-menu${isSubscriptionMenuOpen ? " header__subscription-menu--open" : ""}`}
        >
          {isPremium ? (
            <div className="header__premium-indicator header__premium-indicator--split">
              <button
                type="button"
                className="header__premium-indicator-main"
                aria-label={
                  appearance.language === "en"
                    ? "Subscription panel"
                    : "Painel de assinatura"
                }
                onClick={onClickPremium}
              >
                <Crown className="header__premium-crown" size={18} aria-hidden="true" />
                <span className="header__premium-label">
                  {appearance.language === "en" ? "Subscription" : "Assinatura"}
                </span>
              </button>
              <button
                type="button"
                className="header__premium-indicator-arrow"
                aria-label={
                  appearance.language === "en"
                    ? "Toggle subscription menu"
                    : "Alternar menu de assinatura"
                }
                aria-expanded={isSubscriptionMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsSubscriptionMenuOpen((open) => !open)}
              >
                <ChevronDown
                  className="header__premium-chevron"
                  size={14}
                  strokeWidth={2.15}
                  aria-hidden="true"
                />
              </button>
              <span className="header__tooltip header__tooltip--premium">
                {premiumExpiryText ? (
                  <>
                    {appearance.language === "en" ? "Expires on " : "Expira em "}
                    <span className="header__tooltip-date">{premiumExpiryText.date}</span>
                    <span className="header__tooltip-connector">
                      {appearance.language === "en" ? " at " : " às "}
                    </span>
                    <span className="header__tooltip-date">{premiumExpiryText.time}</span>
                    {"."}
                  </>
                ) : appearance.language === "en" ? (
                  "Active subscription."
                ) : (
                  "Assinatura ativa."
                )}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="header__premium-indicator"
              aria-label={
                appearance.language === "en"
                  ? "Become premium"
                  : "Seja premium"
              }
              onClick={onClickPremium}
            >
              <Crown className="header__premium-crown" size={18} aria-hidden="true" />
              <span className="header__premium-label">
                {appearance.language === "en"
                  ? "Become premium"
                  : "Seja premium"}
              </span>
              <span className="header__tooltip header__tooltip--premium">
                {appearance.language === "en"
                  ? "Unlock GhostBox Premium."
                  : "Desbloqueie o GhostBox Premium."}
              </span>
            </button>
          )}
          {isPremium && isSubscriptionMenuOpen && (
            <div className="header__subscription-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="header__subscription-menu-item"
                onClick={() => {
                  setIsSubscriptionMenuOpen(false);
                  onClickPremium?.();
                }}
              >
                <Settings2 size={17} strokeWidth={2.25} aria-hidden="true" />
                {appearance.language === "en" ? "Subscription panel" : "Painel de assinatura"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="header__subscription-menu-item"
                onClick={() => openSubscriptionPortal("manage")}
              >
                <UserCog size={17} strokeWidth={2.25} aria-hidden="true" />
                {appearance.language === "en" ? "Manage" : "Gerenciar"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="header__subscription-menu-item"
                onClick={() => openSubscriptionPortal("payment_method_update")}
              >
                <CreditCard size={17} strokeWidth={2.25} aria-hidden="true" />
                {appearance.language === "en" ? "Change payment method" : "Alterar método de pagamento"}
              </button>
            </div>
          )}
        </div>
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
            markAppNotificationsSeen(now);
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
              ref={searchInputRef}
              value={query}
              onChange={handleChange}
              onKeyDown={handleSearchKeyDown}
              onFocus={handleFocus}
              placeholder={t("header.searchPlaceholder")}
            />
            <span className="header__search-trailing" aria-hidden="true">
              {isSearching && <span className="header__search-loader" />}
            </span>
          </label>
          <span className="header__tooltip header__tooltip--search">
            Pesquisar
          </span>

          {showDropdown && (
            <div className="header__search-dropdown">
              {suggestions.length > 0 ? (
                <>
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
                                  fill={isFavorite ? "var(--text-primary)" : "none"}
                                  stroke={isFavorite ? "var(--text-primary)" : "currentColor"}
                                />
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {showAppIdPrompt ? (
                    <div className="header__search-empty header__search-empty--after-results">
                      <Info className="header__search-empty-icon" size={16} aria-hidden="true" />
                      <div className="header__search-empty-content">
                        <p className="header__search-empty-title">
                          {t("header.searchNoResultsTitle")}
                        </p>
                        <p className="header__search-empty-copy">
                          {t("header.searchNoResultsAppIdHint")}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : isSearching ? (
                <div className="header__search-dropdown-loading" role="status">
                  <SearchSuggestionsLoadingState count={6} />
                </div>
              ) : (
                <div className="header__search-empty">
                  <Info className="header__search-empty-icon" size={16} aria-hidden="true" />
                  <div className="header__search-empty-content">
                    <p className="header__search-empty-title">
                      {t("header.searchNoResultsTitle")}
                    </p>
                    <p className="header__search-empty-copy">
                      {t("header.searchNoResultsAppIdHint")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

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
      </div>

      <div className="header__window-controls">
        <button
          type="button"
          className="header__window-button"
          aria-label={appearance.language === "en" ? "Minimize" : "Minimizar"}
          onClick={handleMinimize}
        >
          <Minus size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
        </button>
        <button
          type="button"
          className="header__window-button header__window-button--close"
          aria-label={appearance.language === "en" ? "Close" : "Fechar"}
          onClick={handleClose}
        >
          <X size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
        </button>
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
