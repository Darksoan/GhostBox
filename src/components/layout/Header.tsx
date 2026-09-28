import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Info,
  Maximize2,
  MessageSquareShare,
  Minus,
  Search,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState, useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWindowMaximized } from "../../hooks/useWindowMaximized";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { gameSmallCapsuleSources, preloadGameModalAssetsThrottled } from "../../utils/image";
import {
  cacheImageSourceAfterLoad,
  forgetCachedImageSource,
  markImageSourceLoaded,
  withCachedImageSources,
} from "../../utils/imageCache";
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

const SearchSuggestionThumbnail = memo(function SearchSuggestionThumbnail({
  game,
}: {
  game: GhostBoxGame;
}) {
  const rawSources = useMemo(() => gameSmallCapsuleSources(game), [game]);
  const sourceKey = rawSources.join("\n");
  const sources = useMemo(
    () =>
      withCachedImageSources(rawSources, {
        requestManifests: false,
        preserveSourceOrder: true,
        prioritizeCached: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceKey],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setIsLoaded(false);
  }, [sourceKey]);

  const source = sources[sourceIndex] ?? "";

  useEffect(() => {
    setIsLoaded(false);
  }, [source]);

  if (!source) {
    return <span className="header__search-dropdown-thumbnail" aria-hidden="true" />;
  }

  return (
    <img
      className="header__search-dropdown-thumbnail"
      src={source}
      width={120}
      height={45}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      aria-hidden="true"
      style={isLoaded ? undefined : { opacity: 0 }}
      onLoad={() => {
        setIsLoaded(true);
        markImageSourceLoaded(source);
        if (!/^https?:\/\//i.test(source)) return;
        cacheImageSourceAfterLoad(source);
      }}
      onError={() => {
        forgetCachedImageSource(source);
        if (sourceIndex + 1 < sources.length) {
          setSourceIndex(sourceIndex + 1);
        } else {
          setSourceIndex(sources.length);
        }
      }}
    />
  );
});

const SearchSuggestionItem = memo(function SearchSuggestionItem({
  game,
  onSelect,
}: {
  game: GhostBoxGame;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="header__search-dropdown-item"
        onMouseDown={(event) => event.preventDefault()}
        onFocus={() => preloadGameModalAssetsThrottled(game)}
        onMouseEnter={() => preloadGameModalAssetsThrottled(game)}
        onClick={onSelect}
      >
        <SearchSuggestionThumbnail game={game} />
        <span className="header__search-dropdown-item-title">
          <HighlightedSearchText text={game.title} />
        </span>
      </button>
    </li>
  );
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
  searchInPage?: boolean;
  steamProfile?: SteamProfile | null;
  isPremium?: boolean;
  subscriptionPeriodEnd?: string | null;
  subscriptionAccessType?: "free" | "stripe" | "lifetime" | null;
  onQueryChange: (query: string) => void;
  onSelectSuggestion: (game: GhostBoxGame) => void;
  onBack: () => void;
  onForward: () => void;
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
  hasNoSearchResults = false,
  showAppIdPrompt = false,
  allowSearchDropdown = false,
  searchInPage = false,
  steamProfile = null,
  isPremium = false,
  subscriptionPeriodEnd = null,
  subscriptionAccessType = null,
  onQueryChange,
  onSelectSuggestion,
  onBack,
  onForward,
  onClickPremium,
}: HeaderProps) {
  const { t, appearance } = useSettings();
  const [focused, setFocused] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
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
  // Bumped on every release so a pointerdown still awaiting window queries can
  // tell that its gesture is already over and skip arming the drag.
  const titlebarGestureRef = useRef(0);
  const showDropdown =
    !searchInPage &&
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
    // `discordInviteUrl` é constante e está na allowlist; o catch existe só
    // para o caso de o próprio opener do SO falhar.
    void ghostboxApi.openExternalUrl(discordInviteUrl).catch(() => undefined);
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onQueryChange(event.target.value),
    [onQueryChange]
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      // Resultado local é instantâneo: Enter abre a primeira sugestão mesmo
      // com o remoto ainda carregando (antes bloqueava e parecia "sem resultado").
      const firstSuggestion = suggestions[0];
      if (!firstSuggestion) return;
      event.preventDefault();
      setFocused(false);
      onSelectSuggestion(firstSuggestion);
    },
    [onSelectSuggestion, suggestions]
  );

  const premiumExpiryText = formatSubscriptionExpiry(subscriptionPeriodEnd, appearance.language);

  const handleMinimize = useCallback(() => void ghostboxApi.minimize(), []);
  const handleClose = useCallback(() => void ghostboxApi.close(), []);
  const isMaximized = useWindowMaximized();

  const handleToggleMaximize = useCallback(() => {
    void getCurrentWindow().toggleMaximize();
  }, []);

  const titlebarInteractiveSelector =
    "button, input, a, label, [role='button'], .header__search-shell, .header__window-controls";

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
    if (drag && pointerId != null && drag.pointerId !== pointerId) return;
    titlebarGestureRef.current += 1;
    if (drag?.frame != null) {
      window.cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
    titlebarDragRef.current = null;
  }, []);

  const handleTitlebarPointerDown = useCallback(async (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest(titlebarInteractiveSelector)) {
      return;
    }

    // Keep grab offset exact: sync screen coords + window origin (no startDragging jump).
    event.preventDefault();

    // Capture now, while the synthetic event still has a currentTarget: the awaits
    // below outlive the dispatch, and without capture the release can land on
    // another element and leave the window stuck to the cursor.
    const header = event.currentTarget;
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; move/up still work on the header.
    }

    const gestureId = ++titlebarGestureRef.current;
    const win = getCurrentWindow();
    let originX = window.screenX;
    let originY = window.screenY;

    if (await win.isMaximized()) {
      if (titlebarGestureRef.current !== gestureId) return;
      // Frameless convention: dragging from a maximized window restores it and
      // keeps the grab point under the cursor, proportionally to where it sat
      // in the maximized titlebar.
      const grabRatioX = (event.screenX - window.screenX) / Math.max(1, window.outerWidth);
      const grabOffsetY = event.screenY - window.screenY;
      await win.unmaximize();
      const scale = await win.scaleFactor();
      const restoredSize = await win.outerSize();
      originX = Math.round(event.screenX - grabRatioX * (restoredSize.width / scale));
      originY = Math.round(event.screenY - grabOffsetY);
      await win.setPosition(new LogicalPosition(originX, originY));
    }

    // Released while the window queries were in flight: no drag to arm.
    if (titlebarGestureRef.current !== gestureId) return;

    titlebarDragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      originX,
      originY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      frame: null,
    };
  }, []);

  const handleTitlebarPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = titlebarDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // No button held anymore: the release was swallowed (alt-tab, native menu,
      // lost capture). Drop the drag instead of following the cursor.
      if (event.buttons === 0) {
        endTitlebarDrag(event.pointerId);
        return;
      }

      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      if (drag.frame != null) return;
      drag.frame = window.requestAnimationFrame(flushTitlebarDrag);
    },
    [endTitlebarDrag, flushTitlebarDrag]
  );

  const handleTitlebarPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endTitlebarDrag(event.pointerId);
    },
    [endTitlebarDrag]
  );

  const handleTitlebarDoubleClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(titlebarInteractiveSelector)) {
      return;
    }
    handleToggleMaximize();
  }, [handleToggleMaximize]);

  useEffect(() => {
    const stop = () => endTitlebarDrag();
    // Focus loss (alt-tab, tray click, OS dialog) never delivers pointerup.
    window.addEventListener("blur", stop);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      const drag = titlebarDragRef.current;
      if (drag?.frame != null) window.cancelAnimationFrame(drag.frame);
      titlebarDragRef.current = null;
    };
  }, [endTitlebarDrag]);

  return (
    <header
      className="header"
      onPointerDown={handleTitlebarPointerDown}
      onPointerMove={handleTitlebarPointerMove}
      onPointerUp={handleTitlebarPointerUp}
      onPointerCancel={handleTitlebarPointerUp}
      onLostPointerCapture={handleTitlebarPointerUp}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="header__section header__section--left">
        <div className="header__navigation-controls">
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
        <button
          type="button"
          className="header__premium-indicator"
          aria-label={
            isPremium
              ? appearance.language === "en"
                ? "Subscription"
                : "Assinatura"
              : appearance.language === "en"
                ? "Become premium"
                : "Seja premium"
          }
          onClick={onClickPremium}
        >
          <Crown className="header__premium-crown" size={18} aria-hidden="true" />
          <span className="header__premium-label">
            {isPremium
              ? appearance.language === "en"
                ? "Subscription"
                : "Assinatura"
              : appearance.language === "en"
                ? "Become premium"
                : "Seja premium"}
          </span>
          <span className="header__tooltip header__tooltip--premium">
            {isPremium ? (
              subscriptionAccessType === "lifetime" ? (
                appearance.language === "en" ? "Lifetime Premium access." : "Acesso Premium vitalício."
              ) : premiumExpiryText ? (
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
              )
            ) : appearance.language === "en" ? (
              "Unlock GhostBox Premium."
            ) : (
              "Desbloqueie o GhostBox Premium."
            )}
          </span>
        </button>
        <div
          className="header__search-shell"
          onBlur={handleBlur}
        >
          <label
            className={`header__search ${isSearching ? "header__search--loading" : ""}`}
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
                      return (
                        <SearchSuggestionItem
                          key={game.id}
                          game={game}
                          onSelect={() => {
                            setFocused(false);
                            onSelectSuggestion(game);
                          }}
                        />
                      );
                    })}
                  </ul>
                  {showAppIdPrompt ? (
                    <div className="header__search-empty header__search-empty--after-results">
                      <Info className="header__search-empty-icon" size={18} aria-hidden="true" />
                      <div className="header__search-empty-content">
                        <p className="header__search-empty-copy">
                          {t("header.searchNoResultsAppIdHint")}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : isSearching ? (
                <div className="header__search-dropdown-loading" role="status">
                  <SearchSuggestionsLoadingState count={8} />
                </div>
              ) : (
                <div className="header__search-empty">
                  <Info className="header__search-empty-icon" size={18} aria-hidden="true" />
                  <div className="header__search-empty-content">
                    <p className="header__search-empty-copy">
                      {t("header.searchNoResultsAppIdHint")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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
          className="header__window-button"
          aria-label={
            appearance.language === "en"
              ? isMaximized
                ? "Restore"
                : "Maximize"
              : isMaximized
                ? "Restaurar"
                : "Maximizar"
          }
          onClick={handleToggleMaximize}
        >
          {isMaximized ? (
            <Copy size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
          ) : (
            <Maximize2 size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
          )}
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
    </header>
  );
});
