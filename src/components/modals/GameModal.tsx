import {
  ChevronDown,
  Cpu,
  Download,
  Heart,
  Image as ImageIcon,
  Lock,
  Play,
  Settings,
  Tags as TagsIcon,
  Trash2,
} from "lucide-react";
import { Cup } from "reicon-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  GhostBoxGame,
  GameRequirements,
  SteamAchievement,
} from "../../data";
import type { SteamProfile, UserCollection } from "../../types";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { mergeGameDetailsPreservingAchievements } from "../../lib/profileHistoryGames";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
} from "../../utils/gameCache";
import { mergeAchievementDetailsIntoGame } from "../../utils/steamAchievementMerge";
import {
  imageSourceCache,
  preloadImageSources,
  runWhenIdle,
  uniqueSources,
} from "../../utils/imageCache";
import {
  gameHeroSources,
  gameLogoSources,
  gameStyle,
  getPriorityScreenshotSources,
  withoutHeroImageSources,
} from "../../utils/image";
import { lazy, Suspense } from "react";
import { useSettings } from "../../context/settings";
import { useMetricsUnlocked } from "../../context/MetricsVisibilityContext";

const LazyGallerySlider = lazy(() =>
  import("../ui/GallerySlider").then((m) => ({ default: m.GallerySlider }))
);
const LazyGameBackupOptionsModal = lazy(() =>
  import("./GameBackupOptionsModal").then((m) => ({ default: m.GameBackupOptionsModal }))
);

const GameRequirementsSection = memo(function GameRequirementsSection({
  requirements,
}: {
  requirements?: GameRequirements;
}) {
  const { appearance } = useSettings();
  const requirementsId = useId();
  const requirementsSectionPanelId = `${requirementsId}-section-panel`;
  const minimum = requirements?.minimum ?? [];
  const recommended = requirements?.recommended ?? [];
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeRequirement, setActiveRequirement] = useState<
    "minimum" | "recommended"
  >(minimum.length ? "minimum" : "recommended");

  useEffect(() => {
    if (activeRequirement === "minimum" && !minimum.length && recommended.length) {
      setActiveRequirement("recommended");
    }
    if (activeRequirement === "recommended" && !recommended.length && minimum.length) {
      setActiveRequirement("minimum");
    }
  }, [activeRequirement, minimum.length, recommended.length]);

  if (!minimum.length && !recommended.length) return null;

  const activeItems = activeRequirement === "minimum" ? minimum : recommended;
  return (
    <section
      className="modal__requirements-section"
      aria-label={
        appearance.language === "en"
          ? "System requirements"
          : "Requisitos do sistema"
      }
    >
      <button
        type="button"
        className="modal__requirements-header modal__sidebar-section-toggle"
        aria-expanded={!isCollapsed}
        aria-controls={requirementsSectionPanelId}
        onClick={() => setIsCollapsed((value) => !value)}
      >
        <Cpu size={18} aria-hidden="true" />
        <strong>
          {appearance.language === "en" ? "Requirements" : "Requisitos"}
        </strong>
        <ChevronDown
          className="modal__sidebar-section-chevron"
          size={16}
          aria-hidden="true"
        />
      </button>
      <div
        className="modal__sidebar-section-content"
        id={requirementsSectionPanelId}
        aria-hidden={isCollapsed}
        data-collapsed={isCollapsed ? "true" : "false"}
      >
        <div className="modal__sidebar-section-panel modal__requirements-panel">
          <div
            className="modal__requirements-tabs"
            role="tablist"
            aria-label={
              appearance.language === "en"
                ? "Requirement options"
                : "Opções de requisitos"
            }
          >
            <button
              type="button"
              className={`modal__requirements-tab ${activeRequirement === "minimum" ? "modal__requirements-tab--active" : ""}`}
              onClick={() => setActiveRequirement("minimum")}
              disabled={!minimum.length}
              role="tab"
              id={`${requirementsId}-minimum-tab`}
              aria-selected={activeRequirement === "minimum"}
              aria-controls={`${requirementsId}-panel`}
            >
              {appearance.language === "en" ? "Minimum" : "Mínimos"}
            </button>
            <button
              type="button"
              className={`modal__requirements-tab ${activeRequirement === "recommended" ? "modal__requirements-tab--active" : ""}`}
              onClick={() => setActiveRequirement("recommended")}
              disabled={!recommended.length}
              role="tab"
              id={`${requirementsId}-recommended-tab`}
              aria-selected={activeRequirement === "recommended"}
              aria-controls={`${requirementsId}-panel`}
            >
              {appearance.language === "en" ? "Recommended" : "Recomendados"}
            </button>
          </div>

          <div
            className="modal__requirements-content"
            role="tabpanel"
            id={`${requirementsId}-panel`}
            aria-labelledby={`${requirementsId}-${activeRequirement}-tab`}
          >
            {activeItems.length ? (
              <ul>
                {activeItems.map((item) => (
                  <RequirementItem item={item} key={item} />
                ))}
              </ul>
            ) : (
              <p>
                {appearance.language === "en"
                  ? "Not provided by Steam."
                  : "Não informado pela Steam."}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

const RequirementItem = memo(function RequirementItem({ item }: { item: string }) {
  const separatorIndex = item.indexOf(":");
  if (separatorIndex <= 0) return <li>{item}</li>;

  return (
    <li>
      <strong>{item.slice(0, separatorIndex + 1)}</strong>{" "}
      {item.slice(separatorIndex + 1).trim()}
    </li>
  );
});

function normalizeSteamHtml(value: string) {
  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function safeMediaSource(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value, "https://store.steampowered.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

// Steam ships untrusted HTML. Parse into an inert document (never the live one,
// so nothing fetches or fires handlers mid-sanitize) and strip every attribute
// we do not explicitly allow.
function sanitizeSteamAboutHtml(value: string) {
  const document = new DOMParser().parseFromString(
    normalizeSteamHtml(value),
    "text/html"
  );
  const blockedElements = document.querySelectorAll(
    "script, style, iframe, frame, object, embed, link, meta, base"
  );
  blockedElements.forEach((element) => element.remove());

  // TreeWalker instead of querySelectorAll("*"): no static NodeList of every
  // element gets materialized just to be iterated once.
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT
  );
  for (
    let element = walker.currentNode as Element | null;
    element;
    element = walker.nextNode() as Element | null
  ) {
    // Backwards over the live NamedNodeMap: removals do not shift indices we
    // still have to visit, so no per-element array copy is needed.
    const attributes = element.attributes;
    for (let index = attributes.length - 1; index >= 0; index -= 1) {
      const attribute = attributes[index];
      const name = attribute.name.toLowerCase();

      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "href" || name === "src" || name === "poster") {
        const source = safeMediaSource(attribute.value);
        if (source) element.setAttribute(attribute.name, source);
        else element.removeAttribute(attribute.name);
      }
    }
  }

  document.body.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  document.body.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.removeAttribute("width");
    image.removeAttribute("height");
  });

  document.body.querySelectorAll("video").forEach((video) => {
    video.removeAttribute("controls");
    video.removeAttribute("autoplay");
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    // Nothing downloads until the video scrolls into view; GameModal flips this
    // and starts playback from an IntersectionObserver.
    video.preload = "none";
    video.removeAttribute("width");
    video.removeAttribute("height");
  });

  return document.body.innerHTML;
}

// Sanitizing a long Steam description costs a full HTML parse plus a walk over
// every element. Reopening the same game should not pay it twice.
// Keyed by the raw description, so a changed payload can never serve stale HTML.
// Descriptions run to tens of KB, hence the low ceiling: this holds both the raw
// key and the sanitized value for each entry.
const sanitizedAboutHtmlCache = new Map<string, string>();
const sanitizedAboutHtmlCacheLimit = 12;

function getSanitizedSteamAboutHtml(value?: string) {
  if (!value || typeof window === "undefined") return "";

  const cached = sanitizedAboutHtmlCache.get(value);
  if (cached !== undefined) return cached;

  const html = sanitizeSteamAboutHtml(value);

  // Insertion-ordered Map: the oldest key is the first one iterated.
  if (sanitizedAboutHtmlCache.size >= sanitizedAboutHtmlCacheLimit) {
    const oldestKey = sanitizedAboutHtmlCache.keys().next().value;
    if (oldestKey !== undefined) sanitizedAboutHtmlCache.delete(oldestKey);
  }
  sanitizedAboutHtmlCache.set(value, html);

  return html;
}

function formatAchievementPercent(
  value: number | undefined,
  language: string
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  const locale = language === "en" ? "en-US" : "pt-BR";
  return `${value.toLocaleString(locale, {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  })}%`;
}

const AchievementIcon = memo(function AchievementIcon({
  achievement,
  onSelect,
  interactive = true,
}: {
  achievement: SteamAchievement;
  onSelect?: () => void;
  interactive?: boolean;
}) {
  const { appearance } = useSettings();
  const itemRef = useRef<HTMLLIElement>(null);
  const isUnlocked = achievement.unlocked === true;
  const isRare =
    isUnlocked &&
    typeof achievement.globalPercent === "number" &&
    Number.isFinite(achievement.globalPercent) &&
    achievement.globalPercent <= 10;
  const preferredSource = isUnlocked
    ? achievement.icon || achievement.iconGray
    : achievement.iconGray || achievement.icon;
  const [source, setSource] = useState(preferredSource);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const globalPercent = formatAchievementPercent(achievement.globalPercent, appearance.language);
  const globalPercentLabel =
    appearance.language === "en" ? "of players" : "dos jogadores";
  const fallbackPercentLabel =
    appearance.language === "en"
      ? "Global percentage unavailable"
      : "Percentual global indisponível";
  const ariaLabel =
    typeof achievement.globalPercent === "number"
      ? `${achievement.title}, ${globalPercent} ${globalPercentLabel}`
      : `${achievement.title}, ${fallbackPercentLabel}`;

  useEffect(() => {
    setSource(preferredSource);
  }, [preferredSource]);

  function showTooltip() {
    const item = itemRef.current;
    if (!item || typeof window === "undefined") return;

    const rect = item.getBoundingClientRect();
    const tooltipWidth = 240;
    const horizontalPadding = 12;
    const left = Math.min(
      Math.max(
        rect.left + rect.width / 2,
        tooltipWidth / 2 + horizontalPadding
      ),
      window.innerWidth - tooltipWidth / 2 - horizontalPadding
    );

    setTooltipPosition({
      left,
      top: Math.max(horizontalPadding, rect.top - 18),
    });
  }

  function hideTooltip() {
    setTooltipPosition(null);
  }

  const tooltip = (
    <span
      className="modal__achievement-tooltip modal__achievement-tooltip--portal"
      role="tooltip"
      style={
        tooltipPosition
          ? {
              left: tooltipPosition.left,
              top: tooltipPosition.top,
            }
          : undefined
      }
    >
      <strong>{achievement.title}</strong>
      <span>
        {typeof achievement.globalPercent === "number"
          ? `${globalPercent} ${globalPercentLabel}`
          : fallbackPercentLabel}
      </span>
    </span>
  );

  return (
    <li
      className={`modal__achievement-item ${isUnlocked ? "modal__achievement-item--unlocked" : "modal__achievement-item--locked"}${isRare ? " modal__achievement-item--rare" : ""}${onSelect && interactive ? " modal__achievement-item--clickable" : ""}`}
      tabIndex={interactive ? 0 : -1}
      aria-hidden={!interactive}
      aria-label={interactive ? ariaLabel : undefined}
      ref={itemRef}
      onBlur={interactive ? hideTooltip : undefined}
      onFocus={interactive ? showTooltip : undefined}
      onMouseEnter={interactive ? showTooltip : undefined}
      onMouseLeave={interactive ? hideTooltip : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={(event) => {
        if (!interactive || !onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <img
        src={source}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
        onError={() => {
          if (source !== achievement.iconGray) {
            setSource(achievement.iconGray);
          }
        }}
      />
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(tooltip, document.body)
        : null}
    </li>
  );
});

function achievementImageSourceList(achievements: SteamAchievement[]) {
  return uniqueSources(
    achievements.flatMap((achievement) => [
      achievement.icon,
      achievement.iconGray,
    ])
  );
}

const GameDetailsLoadingSections = memo(function GameDetailsLoadingSections() {
  return (
    <div className="modal__details-loading" role="status" aria-hidden="true">
      <section className="modal__achievements-section modal__details-loading-section">
        <div className="modal__achievements-heading modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__sidebar-section-content modal__details-loading-content">
          <div className="modal__sidebar-section-panel modal__achievements-panel">
          <ul className="modal__achievements-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <li className="modal__achievement-item modal__achievement-item--skeleton loading-wave" key={`achievement-loading-${index}`} />
            ))}
          </ul>
          </div>
        </div>
      </section>

      <section className="modal__requirements-section modal__details-loading-section">
        <div className="modal__requirements-header modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__sidebar-section-content modal__details-loading-content">
          <div className="modal__sidebar-section-panel modal__requirements-panel">
          <div className="modal__requirements-tabs">
            <span className="modal__requirements-tab modal__requirements-tab--skeleton loading-wave" />
            <span className="modal__requirements-tab modal__requirements-tab--skeleton loading-wave" />
          </div>
          <div className="modal__requirements-content modal__requirements-content--skeleton">
            <ul>
              {Array.from({ length: 4 }, (_, index) => (
                <li key={`requirement-loading-${index}`}>
                  <span className="modal__details-loading-line loading-wave" />
                </li>
              ))}
            </ul>
          </div>
          </div>
        </div>
      </section>

      <section className="modal__chips-section modal__details-loading-section">
        <div className="modal__chips-heading modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__sidebar-section-content modal__details-loading-content">
          <div className="modal__sidebar-section-panel modal__chips">
            {Array.from({ length: 6 }, (_, index) => (
              <span className="modal__chip modal__chip--skeleton loading-wave" key={`chip-loading-${index}`} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
});

interface ModalActionsProps {
  isAdding: boolean;
  isInstalled: boolean;
  isDownloaded: boolean;
  isAdded: boolean;
  isRemoving: boolean;
  isPlaying: boolean;
  isSessionActive: boolean;
  isFavorite: boolean;
  isBackupOptionsOpen: boolean;
  language: string;
  game: GhostBoxGame;
  onPlay: (game: GhostBoxGame) => void;
  onRemove: (game: GhostBoxGame) => void;
  onQueue: (game: GhostBoxGame) => void;
  onToggleFavorite: (game: GhostBoxGame) => void;
  onOpenBackupOptions: () => void;
}

const ModalActions = memo(function ModalActions({
  isAdding,
  isInstalled,
  isDownloaded,
  isAdded,
  isRemoving,
  isPlaying,
  isSessionActive,
  isFavorite,
  isBackupOptionsOpen,
  language,
  game,
  onPlay,
  onRemove,
  onQueue,
  onToggleFavorite,
  onOpenBackupOptions,
}: ModalActionsProps) {
  return (
    <div className={`modal__actions ${isAdding ? "modal__actions--adding" : ""}`}>
      {isInstalled && isDownloaded && (
        <button
          type="button"
          className="button button--primary modal__play-button"
          onClick={() => {
            if (isPlaying || isSessionActive) return;
            onPlay(game);
          }}
          disabled={isPlaying || isSessionActive}
          aria-busy={isPlaying}
        >
          {isPlaying ? (
            <span
              className="modal__add-spinner modal__add-spinner--light"
              aria-hidden="true"
            />
          ) : (
            <Play size={20} strokeWidth={2.0} />
          )}
          <span className="button__label modal__action-label">
            {isSessionActive
              ? language === "en"
                ? "Playing"
                : "Jogando"
              : isPlaying
                ? language === "en"
                  ? "Launching"
                  : "Iniciando"
                : language === "en"
                  ? "Play"
                  : "Jogar"}
          </span>
        </button>
      )}
      {isAdding ? (
        <div
          className="modal__adding-state"
          aria-label={
            language === "en" ? "Adding game" : "Adicionando jogo"
          }
        >
          <span className="modal__add-progress" />
        </div>
      ) : isAdded ? (
        <>
          <button
            type="button"
            className="button button--primary modal__remove-button"
            onClick={() => onRemove(game)}
            disabled={isRemoving}
          >
            {isRemoving ? (
              <>
                <span
                  className="modal__add-spinner modal__add-spinner--light"
                  aria-hidden="true"
                />
                <span className="button__label modal__action-label">
                  {language === "en" ? "Removing" : "Removendo"}
                </span>
              </>
            ) : (
              <>
                <Trash2 size={18} aria-hidden="true" />
                <span className="button__label modal__action-label">
                  {language === "en" ? "Remove" : "Remover"}
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""}`}
            onClick={() => onToggleFavorite(game)}
            aria-pressed={isFavorite}
            aria-label={
              isFavorite
                ? language === "en"
                  ? `Remove ${game.title} from favorites`
                  : `Remover ${game.title} dos favoritos`
                : language === "en"
                  ? `Add ${game.title} to favorites`
                  : `Adicionar ${game.title} aos favoritos`
            }
          >
            <Heart
              size={20}
              fill={isFavorite ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}`}
            onClick={onOpenBackupOptions}
            aria-label={
              language === "en" ? "Backup settings" : "Ajustes de backup"
            }
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="button button--primary modal__add-button"
            onClick={() => onQueue(game)}
          >
            <Download size={20} />
            <span className="button__label modal__action-label">
              {language === "en" ? "Add" : "Adicionar"}
            </span>
          </button>
          <button
            type="button"
            className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""}`}
            onClick={() => onToggleFavorite(game)}
            aria-pressed={isFavorite}
            aria-label={
              isFavorite
                ? language === "en"
                  ? `Remove ${game.title} from favorites`
                  : `Remover ${game.title} dos favoritos`
                : language === "en"
                  ? `Add ${game.title} to favorites`
                  : `Adicionar ${game.title} aos favoritos`
            }
          >
            <Heart
              size={20}
              fill={isFavorite ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}`}
            onClick={onOpenBackupOptions}
            aria-label={
              language === "en" ? "Backup settings" : "Ajustes de backup"
            }
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
});

interface GameModalProps {
  game: GhostBoxGame | null;
  isAdding: boolean;
  isAdded: boolean;
  isInstalled: boolean;
  isDownloaded: boolean;
  isRemoving: boolean;
  isPlaying: boolean;
  isSessionActive?: boolean;
  isFavorite: boolean;
  userCollections: UserCollection[];
  steamProfile: SteamProfile | null;
  onClose: () => void;
  onQueueGame: (game: GhostBoxGame) => void | Promise<void>;
  onRemoveGame: (game: GhostBoxGame) => void | Promise<void>;
  onToggleFavorite: (game: GhostBoxGame) => void;
  onAddGameToCollection: (
    game: GhostBoxGame,
    collectionId: string
  ) => void | Promise<void>;
  onRemoveGameFromCollection: (
    game: GhostBoxGame,
    collectionId: string
  ) => void | Promise<void>;
  onPlayGame: (game: GhostBoxGame) => void | Promise<void>;
  onDetailsLoaded?: (game: GhostBoxGame) => void;
  onViewAchievements?: (game: GhostBoxGame) => void;
}

export function GameModal({
  game,
  isAdding,
  isAdded,
  isInstalled,
  isDownloaded = false,
  isRemoving,
  isPlaying,
  isSessionActive = false,
  isFavorite,
  userCollections,
  steamProfile,
  onClose,
  onQueueGame,
  onRemoveGame,
  onToggleFavorite,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  onPlayGame,
  onDetailsLoaded,
  onViewAchievements,
}: GameModalProps) {
  const { appearance, t } = useSettings();
  const areMetricsUnlocked = useMetricsUnlocked();
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const [detailGame, setDetailGame] = useState<GhostBoxGame | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const loadedScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const failedScreenshotSourcesRef = useRef<Set<string>>(new Set());
  const [screenshotSourcesVersion, setScreenshotSourcesVersion] = useState(0);
  const [failedLogoSources, setFailedLogoSources] = useState<Set<string>>(
    () => new Set()
  );
  const [loadedLogoSource, setLoadedLogoSource] = useState("");
  const [visibleScreenshotSource, setVisibleScreenshotSource] = useState("");
  const [isBackupOptionsOpen, setIsBackupOptionsOpen] = useState(false);
  const achievementsPanelId = useId();
  const chipsPanelId = useId();
  const [isAchievementsCollapsed, setIsAchievementsCollapsed] = useState(false);
  const [achievementLoadState, setAchievementLoadState] = useState<
    "idle" | "loading" | "ready" | "empty" | "unavailable"
  >("idle");
  const [isChipsCollapsed, setIsChipsCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const aboutContentShellRef = useRef<HTMLDivElement | null>(null);
  const aboutContentRef = useRef<HTMLDivElement | null>(null);
  const aboutActionsRef = useRef<HTMLDivElement | null>(null);
  const [isAboutOverflowing, setIsAboutOverflowing] = useState(false);

  useEffect(() => {
    setActiveScreenshot(0);
    loadedScreenshotSourcesRef.current = new Set();
    failedScreenshotSourcesRef.current = new Set();
    setScreenshotSourcesVersion(0);
    setFailedLogoSources(new Set());
    setLoadedLogoSource("");
    setVisibleScreenshotSource("");
    setIsBackupOptionsOpen(false);
  }, [game?.id]);

  useEffect(() => {
    let cancelled = false;
    setDetailGame(game);
    setAchievementLoadState("loading");

    if (!game)
      return () => {
        cancelled = true;
      };

    setIsLoadingDetails(true);
    let pendingRequests = 2;
    const finishRequest = () => {
      pendingRequests -= 1;
      if (!cancelled && pendingRequests === 0) setIsLoadingDetails(false);
    };
    const mergeStoreDetails = (details: GhostBoxGame | null) => {
      if (cancelled || !details) return;

      // Store/catalogue payloads often ship empty achievementList. Merge must
      // never wipe achievements already loaded by the achievements request.
      setDetailGame((current) => {
        const base = current ?? game;
        return {
          ...mergeGameDetailsPreservingAchievements(base, details),
          playTimeInMilliseconds:
            current?.playTimeInMilliseconds ?? game.playTimeInMilliseconds,
          lastTimePlayed: current?.lastTimePlayed ?? game.lastTimePlayed,
        };
      });
      onDetailsLoaded?.(details);
    };
    const mergeAchievementDetails = (details: GhostBoxGame | null) => {
      if (cancelled) return;
      if (!details) {
        setAchievementLoadState("empty");
        return;
      }

      const hasIncoming =
        (details.achievementList?.length ?? 0) > 0 ||
        (details.achievements?.total ?? 0) > 0;
      if (!hasIncoming) {
        setAchievementLoadState(
          details.achievementMetadata?.status === "unavailable" ||
          details.achievementMetadata?.status === "rate-limited"
            ? "unavailable"
            : "empty"
        );
        return;
      }

      setDetailGame((current) => {
        const base = current ?? game;
        const merged = mergeAchievementDetailsIntoGame(base, details);
        return {
          ...merged,
          // Keep Steam-synced personal progress already attached to the game.
          playTimeInMilliseconds:
            base.playTimeInMilliseconds ?? game.playTimeInMilliseconds,
          lastTimePlayed: base.lastTimePlayed ?? game.lastTimePlayed,
        };
      });
      setAchievementLoadState("ready");
      onDetailsLoaded?.(details);
    };
    const detailsGameId = game.appId || game.id;

    loadGameStoreDetailsCached(detailsGameId)
      .then(mergeStoreDetails)
      .catch(() => undefined)
      .finally(finishRequest);

    loadGameAchievementDetailsCached(detailsGameId)
      .then(mergeAchievementDetails)
      .catch(() => {
        if (!cancelled) setAchievementLoadState("unavailable");
      })
      .finally(finishRequest);

    return () => {
      cancelled = true;
    };
  }, [game?.appId, game?.id, onDetailsLoaded]);

  useEffect(() => {
    if (!game) return;

    setDetailGame((current) => {
      if (!current) return current;
      const sameGame =
        current.id === game.id ||
        (Boolean(current.appId) && current.appId === game.appId);
      if (!sameGame) return current;

      return {
        ...current,
        playTimeInMilliseconds: game.playTimeInMilliseconds,
        lastTimePlayed: game.lastTimePlayed,
        sessionActive: game.sessionActive,
      };
    });
  }, [
    game?.appId,
    game?.id,
    game?.lastTimePlayed,
    game?.playTimeInMilliseconds,
    game?.sessionActive,
  ]);

  useEffect(() => {
    if (!game) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [game, onClose]);

  const displayGame = detailGame ?? game;

  const imageDerivatives = useMemo(() => {
    const stableScreenshots = game?.screenshots.length ? game.screenshots : [];
    const displayScreenshots = displayGame?.screenshots ?? [];
    const rawScreenshots =
      isLoadingDetails && stableScreenshots.length
        ? stableScreenshots
        : displayScreenshots.length
          ? displayScreenshots
          : stableScreenshots;
    const screenshots = withoutHeroImageSources(rawScreenshots);
    const heroSources = displayGame ? gameHeroSources(displayGame) : [];
    const modalHeroSources = heroSources.filter(
      (source) => !screenshots.includes(source)
    );
    const heroScreenshotFallback =
      screenshots.find((source) => modalHeroSources.includes(source)) ??
      screenshots[0] ??
      "";
    const showcaseScreenshots = heroScreenshotFallback
      ? screenshots.filter((source) => source !== heroScreenshotFallback)
      : screenshots;
    const showcaseSources = displayGame
      ? uniqueSources([modalHeroSources[0], ...showcaseScreenshots])
      : showcaseScreenshots;
    const preloadShowcaseSources = uniqueSources([
      ...showcaseSources,
      ...modalHeroSources,
      heroScreenshotFallback,
    ]);
    const logoSources = displayGame ? gameLogoSources(displayGame) : [];
    return {
      screenshots,
      modalHeroSources,
      heroScreenshotFallback,
      showcaseSources,
      preloadShowcaseSources,
      logoSources,
    };
  }, [displayGame, game, isLoadingDetails]);

  const {
    screenshots,
    modalHeroSources,
    heroScreenshotFallback,
    showcaseSources,
    preloadShowcaseSources,
    logoSources,
  } = imageDerivatives;

  const cachedScreenshotSources = useCachedImageSources(showcaseSources);
  const cachedLogoSources = useCachedImageSources(logoSources);

  const achievements = useMemo(
    () =>
      [...(displayGame?.achievementList ?? [])].sort(
        (a, b) => Number(b.unlocked === true) - Number(a.unlocked === true)
      ),
    [displayGame?.achievementList]
  );
  // Stable identity: this array feeds `keyDerivatives`, whose memo would never
  // hit if the slice were recreated on every render.
  const visibleAchievements = useMemo(
    () => achievements.slice(0, 12),
    [achievements]
  );
  const hasMoreAchievements = achievements.length > 12;
  const shouldShowAchievementsSection =
    achievements.length > 0 ||
    achievementLoadState === "empty" ||
    achievementLoadState === "unavailable";

  const keyDerivatives = useMemo(() => {
    const logoCandidates = uniqueSources([...cachedLogoSources, ...logoSources]);
    const currentLogoSource =
      logoCandidates.find((source) => !failedLogoSources.has(source)) ?? "";
    const screenshotsKey = showcaseSources.join("\n");
    const modalHeroSourcesKey = modalHeroSources.join("\n");
    const cachedScreenshotsKey = cachedScreenshotSources.join("\n");
    const achievementImageSources =
      achievementImageSourceList(visibleAchievements);
    const achievementImageSourcesKey = achievementImageSources.join("\n");
    return {
      currentLogoSource,
      screenshotsKey,
      modalHeroSourcesKey,
      cachedScreenshotsKey,
      achievementImageSources,
      achievementImageSourcesKey,
    };
  }, [
    cachedLogoSources,
    logoSources,
    failedLogoSources,
    showcaseSources,
    modalHeroSources,
    cachedScreenshotSources,
    visibleAchievements,
  ]);

  const {
    currentLogoSource,
    screenshotsKey,
    modalHeroSourcesKey,
    cachedScreenshotsKey,
    achievementImageSources,
    achievementImageSourcesKey,
  } = keyDerivatives;

  const screenshotItems = useMemo(
    () =>
      showcaseSources.map((source, index) => {
        const isHeroItem =
          index === 0 && modalHeroSources.includes(source);
        const heroCandidates = isHeroItem ? modalHeroSources : [];
        const screenshotFallback =
          isHeroItem && heroScreenshotFallback ? [heroScreenshotFallback] : [];
        const sourceCandidates = isHeroItem
          ? [...heroCandidates, ...screenshotFallback]
          : [source];
        const candidates = uniqueSources(
          sourceCandidates.flatMap((candidate) => [
            imageSourceCache.get(candidate),
            candidate,
          ])
        );
        const loadedSource = candidates.find(
          (candidate) =>
            loadedScreenshotSourcesRef.current.has(candidate) &&
            !failedScreenshotSourcesRef.current.has(candidate)
        );
        const displaySource =
          loadedSource ??
          candidates.find(
            (candidate) => !failedScreenshotSourcesRef.current.has(candidate)
          ) ??
          "";
        const isHeroDisplay = isHeroItem
          ? heroCandidates.some(
              (candidate) =>
                displaySource === candidate ||
                displaySource === imageSourceCache.get(candidate)
            )
          : false;
        return { source, index, displaySource, isHeroDisplay };
      }),
    [
      screenshotsKey,
      modalHeroSourcesKey,
      heroScreenshotFallback,
      cachedScreenshotsKey,
      screenshotSourcesVersion,
    ]
  );

  const visibleShowcaseItems = screenshotItems.filter((item) => {
    const distance = Math.abs(item.index - activeScreenshot);
    return distance <= 1;
  });

  const currentScreenshotItem = screenshotItems[activeScreenshot];
  const currentScreenshotSource = currentScreenshotItem?.displaySource ?? "";
  const isCurrentItemHero = Boolean(
    currentScreenshotItem && currentScreenshotItem.isHeroDisplay
  );
  const hasVisibleScreenshot = displayGame
    ? Boolean(
        currentScreenshotSource &&
        visibleScreenshotSource === currentScreenshotSource
      )
    : false;
  const shouldShowLogoOverlay = Boolean(
    loadedLogoSource &&
    currentScreenshotSource &&
    currentScreenshotItem &&
    hasVisibleScreenshot &&
    isCurrentItemHero
  );

  useEffect(() => {
    if (activeScreenshot > 0 && activeScreenshot >= showcaseSources.length) {
      setActiveScreenshot(0);
    }
  }, [activeScreenshot, showcaseSources.length]);

  useEffect(() => {
    preloadImageSources(
      getPriorityScreenshotSources(preloadShowcaseSources, activeScreenshot),
      {
        limit: 2,
        decode: true,
      }
    );
    preloadImageSources(preloadShowcaseSources, { limit: 4, idle: true });
  }, [activeScreenshot, screenshotsKey, modalHeroSourcesKey]);

  useEffect(() => {
    preloadImageSources(achievementImageSources, {
      limit: achievementImageSources.length,
      idle: true,
      decode: true,
    });
  }, [achievementImageSourcesKey]);

  useEffect(() => {
    setLoadedLogoSource((source) =>
      source === currentLogoSource ? source : ""
    );
    if (!currentLogoSource || typeof Image === "undefined") return;

    let cancelled = false;
    let settled = false;
    const image = new Image();
    const failLogoSource = () => {
      if (cancelled || settled) return;

      settled = true;
      setFailedLogoSources((failedSources) =>
        new Set(failedSources).add(currentLogoSource)
      );
    };
    const timeoutId = window.setTimeout(failLogoSource, 4500);

    image.decoding = "async";
    image.onload = async () => {
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }

      if (cancelled || settled) return;

      settled = true;
      window.clearTimeout(timeoutId);
      setLoadedLogoSource(currentLogoSource);
    };
    image.onerror = failLogoSource;
    image.src = currentLogoSource;

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentLogoSource]);

  useEffect(() => {
    if (
      currentScreenshotSource &&
      loadedScreenshotSourcesRef.current.has(currentScreenshotSource)
    ) {
      setVisibleScreenshotSource(currentScreenshotSource);
    }
  }, [currentScreenshotSource, screenshotSourcesVersion]);

  useEffect(() => {
    setIsAboutExpanded(false);
  }, [displayGame?.id]);

  const visibleTags = displayGame?.tags.slice(0, 8) ?? [];
  const visibleGenres = displayGame
    ? displayGame.genres.length
      ? displayGame.genres
      : displayGame.tags.slice(0, 3)
    : [];
  const visibleChips = [...new Set([...visibleGenres, ...visibleTags])];
  const [aboutTheGameHtml, setAboutTheGameHtml] = useState("");
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAboutTheGameHtml("");

    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      setAboutTheGameHtml(getSanitizedSteamAboutHtml(displayGame?.aboutTheGame));
    }, 800);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [displayGame?.aboutTheGame]);

  // Steam descriptions embed autoplaying clips. The sanitizer ships them with
  // preload="none" and no autoplay, so only the ones actually on screen decode.
  useEffect(() => {
    const content = aboutContentRef.current;
    if (!content || !aboutTheGameHtml) return;

    const videos = content.querySelectorAll("video");
    if (!videos.length) return;

    const startPlayback = (video: HTMLVideoElement) => {
      if (video.preload === "none") video.preload = "auto";
      void video.play().catch(() => undefined);
    };

    if (typeof IntersectionObserver === "undefined") {
      videos.forEach(startPlayback);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) startPlayback(video);
          else video.pause();
        }
      },
      { rootMargin: "200px 0px" }
    );
    videos.forEach((video) => observer.observe(video));

    return () => observer.disconnect();
  }, [aboutTheGameHtml]);

  const hasRequirements = Boolean(
    displayGame?.pcRequirements?.minimum.length ||
    displayGame?.pcRequirements?.recommended.length
  );
  const shouldShowDetailLoading =
    isLoadingDetails &&
    !visibleChips.length &&
    !achievements.length &&
    !hasRequirements;

  // A altura colapsada do "sobre" alinha com o fim da sidebar, que vive na outra
  // coluna do grid — CSS não expressa isso, então medimos. Mas o resultado vai
  // direto para uma custom property no elemento: escrever no DOM não re-renderiza
  // o modal. Só `isAboutOverflowing` continua em state, porque decide se o botão
  // "Ver mais" existe, e é booleano (React descarta o set quando não muda).
  useEffect(() => {
    const shell = aboutContentShellRef.current;

    if (!aboutTheGameHtml || isAboutExpanded) {
      shell?.style.removeProperty("--about-collapsed-height");
      setIsAboutOverflowing(false);
      return;
    }

    let frameId = 0;
    const updateCollapsedHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const sidebar = sidebarRef.current;
        const currentShell = aboutContentShellRef.current;
        const actions = aboutActionsRef.current;
        if (!sidebar || !currentShell) return;

        const sidebarBottom = sidebar.getBoundingClientRect().bottom;
        const shellTop = currentShell.getBoundingClientRect().top;
        const actionsHeight = actions?.getBoundingClientRect().height ?? 36;
        const nextHeight = Math.max(
          160,
          Math.floor(sidebarBottom - shellTop - actionsHeight - 10)
        );
        const content = currentShell.firstElementChild;
        const contentHeight =
          content instanceof HTMLElement
            ? content.scrollHeight
            : currentShell.scrollHeight;

        currentShell.style.setProperty(
          "--about-collapsed-height",
          `${nextHeight}px`
        );
        setIsAboutOverflowing(contentHeight > nextHeight + 1);
      });
    };

    updateCollapsedHeight();

    // Uma única observação. As ações são deliberadamente não observadas: quando
    // elas entram ou saem, o próprio shell muda de tamanho e o observer dispara.
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateCollapsedHeight)
        : null;
    if (observer) {
      if (sidebarRef.current) observer.observe(sidebarRef.current);
      if (shell) observer.observe(shell);
    }

    let handleResize: (() => void) | null = null;
    if (!observer) {
      handleResize = updateCollapsedHeight;
      window.addEventListener("resize", handleResize);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      if (handleResize) window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [aboutTheGameHtml, isAboutExpanded, displayGame?.id, shouldShowDetailLoading]);

  const handleViewAchievements = useCallback(() => {
    if (!displayGame || !onViewAchievements) return;
    onViewAchievements(displayGame);
  }, [displayGame, onViewAchievements]);

  const handleOpenBackupOptions = useCallback(() => {
    setIsBackupOptionsOpen(true);
  }, []);

  return (
    <>
      {displayGame && (
        <div
          className={`backdrop backdrop--details${appearance.reduceAllAnimations ? "" : " content-overlay-enter"}`}
          key={game?.id ?? displayGame.id}
          onClick={onClose}
        >
          <article
            className="modal modal--details"
            style={gameStyle(displayGame)}
            onClick={(event) => event.stopPropagation()}
          >
            <section className="modal__showcase">
              <div className="modal__showcase-media">
                {currentScreenshotItem ? (
                  <div
                    className={`modal__showcase-image-shell ${hasVisibleScreenshot ? "modal__showcase-image-shell--loaded" : ""}`}
                    role="img"
                    aria-label={
                      appearance.language === "en"
                        ? `Screenshot of ${displayGame.title}`
                        : `Screenshot de ${displayGame.title}`
                    }
                  >
                    <div
                      className="modal__showcase-placeholder"
                      aria-hidden="true"
                    />
                    {visibleShowcaseItems.map(
                      (item) =>
                        item.displaySource && (
                          <img
                            className={`modal__showcase-image ${item.displaySource === currentScreenshotSource && item.displaySource === visibleScreenshotSource ? "modal__showcase-image--visible" : ""}`}
                            src={item.displaySource}
                            key={`${item.index}-${item.source}`}
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            fetchPriority={
                              item.index === activeScreenshot ? "high" : "low"
                            }
                            loading={item.index === activeScreenshot ? "eager" : "lazy"}
                            onLoad={async (event) => {
                              const image = event.currentTarget;
                              if (typeof image.decode === "function") {
                                await image.decode().catch(() => undefined);
                              }
                              if (!loadedScreenshotSourcesRef.current.has(item.displaySource)) {
                                loadedScreenshotSourcesRef.current.add(item.displaySource);
                                setScreenshotSourcesVersion((v) => v + 1);
                              }
                              if (
                                item.displaySource === currentScreenshotSource
                              ) {
                                setVisibleScreenshotSource(item.displaySource);
                              }
                            }}
                            onError={() => {
                              if (!failedScreenshotSourcesRef.current.has(item.displaySource)) {
                                failedScreenshotSourcesRef.current.add(item.displaySource);
                                setScreenshotSourcesVersion((v) => v + 1);
                              }
                            }}
                          />
                        )
                    )}
                    {shouldShowLogoOverlay && (
                      <img
                        className="modal__showcase-logo modal__showcase-logo--visible"
                        src={loadedLogoSource}
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                        loading="eager"
                        onError={() => {
                          setFailedLogoSources((failedSources) =>
                            new Set(failedSources).add(loadedLogoSource)
                          );
                          setLoadedLogoSource("");
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="modal__showcase-empty">
                    <ImageIcon size={28} />
                  </div>
                )}

                <ModalActions
                  isAdding={isAdding}
                  isInstalled={isInstalled}
                  isDownloaded={isDownloaded}
                  isAdded={isAdded}
                  isRemoving={isRemoving}
                  isPlaying={isPlaying}
                  isSessionActive={isSessionActive}
                  isFavorite={isFavorite}
                  isBackupOptionsOpen={isBackupOptionsOpen}
                  language={appearance.language}
                  game={displayGame}
                  onPlay={onPlayGame}
                  onRemove={onRemoveGame}
                  onQueue={onQueueGame}
                  onToggleFavorite={onToggleFavorite}
                  onOpenBackupOptions={handleOpenBackupOptions}
                />
              </div>
            </section>

            <section className="modal__details">
              <div className="modal__details-main">
                {(screenshots.length > 0 || Boolean(displayGame.movies?.length)) && (
                  <Suspense fallback={null}>
                    <LazyGallerySlider
                      screenshots={screenshots}
                      movies={displayGame.movies}
                      gameTitle={displayGame.title}
                      language={appearance.language}
                    />
                  </Suspense>
                )}

                {aboutTheGameHtml && (
                  <section
                    className="modal__about-section"
                    aria-label={
                      appearance.language === "en"
                        ? "About the game"
                        : "Sobre o jogo"
                    }
                  >
                    <div
                      ref={aboutContentShellRef}
                      className={`modal__about-content-shell ${isAboutExpanded ? "modal__about-content-shell--expanded" : ""} ${!isAboutExpanded && isAboutOverflowing ? "modal__about-content-shell--clamped" : ""}`}
                    >
                      <div
                        ref={aboutContentRef}
                        className="modal__about-content"
                        dangerouslySetInnerHTML={{ __html: aboutTheGameHtml }}
                      />
                      {!isAboutExpanded && isAboutOverflowing && (
                        <div className="modal__about-fade" aria-hidden="true" />
                      )}
                    </div>
                    {(isAboutOverflowing || isAboutExpanded) && (
                      <div className="modal__about-actions" ref={aboutActionsRef}>
                        <button
                          type="button"
                          className="button button--outline modal__about-toggle"
                          onClick={() => setIsAboutExpanded((value) => !value)}
                        >
                          {isAboutExpanded
                            ? appearance.language === "en"
                              ? "Show less"
                              : "Ver menos"
                            : appearance.language === "en"
                              ? "Show more"
                              : "Ver mais"}
                        </button>
                      </div>
                    )}
                  </section>
                )}
              </div>

              <aside className="modal__sidebar" ref={sidebarRef}>
                {shouldShowDetailLoading ? (
                  <GameDetailsLoadingSections />
                ) : (
                  <>
                    {shouldShowAchievementsSection && (
                      <section
                        className="modal__achievements-section"
                        aria-label={
                          appearance.language === "en"
                            ? "Achievements"
                            : "Conquistas"
                        }
                      >
                        <button
                          type="button"
                          className="modal__achievements-heading modal__sidebar-section-toggle"
                          aria-expanded={!isAchievementsCollapsed}
                          aria-controls={achievementsPanelId}
                          onClick={() =>
                            setIsAchievementsCollapsed((value) => !value)
                          }
                        >
                          <Cup size={18} weight="Filled" strokeWidth={2.0} />
                          <strong>
                            {appearance.language === "en"
                              ? "Achievements"
                              : "Conquistas"}
                          </strong>
                          <ChevronDown
                            className="modal__sidebar-section-chevron"
                            size={16}
                            aria-hidden="true"
                          />
                        </button>

                        <div
                          className="modal__sidebar-section-content"
                          id={achievementsPanelId}
                          aria-hidden={isAchievementsCollapsed}
                          data-collapsed={
                            isAchievementsCollapsed ? "true" : "false"
                          }
                        >
                          <div className="modal__sidebar-section-panel modal__achievements-panel">
                          {achievements.length > 0 ? (
                            <div className="modal__achievements-locked-wrapper">
                              <ul
                                className={`modal__achievements-grid ${!areMetricsUnlocked ? "modal__achievements-grid--locked" : ""}`}
                                aria-hidden={!areMetricsUnlocked}
                              >
                                {visibleAchievements.map((achievement) => (
                                  <AchievementIcon
                                    achievement={achievement}
                                    key={achievement.name}
                                    interactive={areMetricsUnlocked}
                                    onSelect={
                                      areMetricsUnlocked && onViewAchievements
                                        ? handleViewAchievements
                                        : undefined
                                    }
                                  />
                                ))}
                              </ul>
                              {!areMetricsUnlocked && (
                                <div
                                  className="modal__achievements-locked-overlay"
                                  role="status"
                                >
                                  <Lock size={18} strokeWidth={2.0} aria-hidden="true" />
                                  <span>{t("metrics.lockedAchievements")}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="modal__achievements-state">
                              {achievementLoadState === "unavailable"
                                ? appearance.language === "en"
                                  ? "Steam achievements are temporarily unavailable. We'll keep the last cached data when available."
                                  : "Conquistas da Steam temporariamente indisponíveis. Dados em cache serão mantidos quando existirem."
                                : appearance.language === "en"
                                  ? "No Steam achievements were found for this game yet."
                                  : "Nenhuma conquista da Steam foi encontrada para este jogo por enquanto."}
                            </p>
                          )}

                          {areMetricsUnlocked && hasMoreAchievements && onViewAchievements && (
                            <button
                              type="button"
                              className="modal__achievements-toggle"
                              onClick={handleViewAchievements}
                            >
                              {t("achievements.viewMore")}
                              <ChevronDown size={16} />
                            </button>
                          )}
                          </div>
                        </div>
                      </section>
                    )}

                    <GameRequirementsSection
                      requirements={displayGame.pcRequirements}
                    />

                    {visibleChips.length > 0 && (
                      <section
                        className="modal__chips-section"
                        aria-label={
                          appearance.language === "en"
                            ? "Genres and tags"
                            : "Gêneros e Tags"
                        }
                      >
                        <button
                          type="button"
                          className="modal__chips-heading modal__sidebar-section-toggle"
                          aria-expanded={!isChipsCollapsed}
                          aria-controls={chipsPanelId}
                          onClick={() => setIsChipsCollapsed((value) => !value)}
                        >
                          <TagsIcon size={18} />
                          <strong>
                            {appearance.language === "en"
                              ? "Genres and tags"
                              : "Gêneros e Tags"}
                          </strong>
                          <ChevronDown
                            className="modal__sidebar-section-chevron"
                            size={16}
                            aria-hidden="true"
                          />
                        </button>
                        <div
                          className="modal__sidebar-section-content"
                          id={chipsPanelId}
                          aria-hidden={isChipsCollapsed}
                          data-collapsed={isChipsCollapsed ? "true" : "false"}
                        >
                          <div className="modal__sidebar-section-panel modal__chips">
                            {visibleChips.map((chip) => (
                              <span className="modal__chip" key={chip}>
                                {chip}
                              </span>
                            ))}
                          </div>
                        </div>
                      </section>
                    )}

                  </>
                )}
              </aside>

            </section>
          </article>
        </div>
      )}
      {isBackupOptionsOpen && (
        <Suspense fallback={null}>
          <LazyGameBackupOptionsModal
            open={Boolean(displayGame)}
            gameId={displayGame?.id ?? ""}
            game={displayGame}
            gameTitle={displayGame?.title ?? ""}
            steamProfile={steamProfile}
            userCollections={userCollections}
            onClose={() => setIsBackupOptionsOpen(false)}
            onAddGameToCollection={(collectionId) => {
              if (!displayGame) return;
              onAddGameToCollection?.(displayGame, collectionId);
            }}
            onRemoveGameFromCollection={(collectionId) => {
              if (!displayGame) return;
              onRemoveGameFromCollection(displayGame, collectionId);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
