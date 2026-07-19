import {
  ChevronDown,
  Cpu,
  Download,
  Heart,
  Image as ImageIcon,
  Play,
  Settings,
  Tags as TagsIcon,
  Trash2,
} from "lucide-react";
import { Cup } from "reicon-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
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
import { useCollapsiblePanelHeight } from "../../hooks/useCollapsiblePanelHeight";

const LazyGallerySlider = lazy(() =>
  import("../ui/GallerySlider").then((m) => ({ default: m.GallerySlider }))
);
const LazyGameReviewsSection = lazy(() =>
  import("./GameReviewsSection").then((m) => ({ default: m.GameReviewsSection }))
);
const LazyGameBackupOptionsModal = lazy(() =>
  import("./GameBackupOptionsModal").then((m) => ({ default: m.GameBackupOptionsModal }))
);

function GameRequirementsSection({
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
  const [requirementsPanelRef, requirementsPanelHeight] =
    useCollapsiblePanelHeight();
  const [activeRequirement, setActiveRequirement] = useState<
    "minimum" | "recommended"
  >(minimum.length ? "minimum" : "recommended");

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
        ref={requirementsPanelRef}
        className="modal__requirements-panel modal__sidebar-section-content"
        id={requirementsSectionPanelId}
        aria-hidden={isCollapsed}
        data-collapsed={isCollapsed ? "true" : "false"}
        style={{
          height: isCollapsed ? 0 : requirementsPanelHeight,
        } as CSSProperties}
      >
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
    </section>
  );
}

function RequirementItem({ item }: { item: string }) {
  const separatorIndex = item.indexOf(":");
  if (separatorIndex <= 0) return <li>{item}</li>;

  return (
    <li>
      <strong>{item.slice(0, separatorIndex + 1)}</strong>{" "}
      {item.slice(separatorIndex + 1).trim()}
    </li>
  );
}

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

function getSanitizedSteamAboutHtml(value?: string) {
  if (!value || typeof window === "undefined") return "";

  const document = new DOMParser().parseFromString(
    normalizeSteamHtml(value),
    "text/html"
  );
  const blockedElements = document.querySelectorAll(
    "script, style, iframe, object, embed, link, meta"
  );
  blockedElements.forEach((element) => element.remove());

  document.body.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "style") {
        element.removeAttribute(attribute.name);
        return;
      }

      if (name === "href") {
        const href = safeMediaSource(attributeValue);
        if (href) element.setAttribute(attribute.name, href);
        else element.removeAttribute(attribute.name);
        return;
      }

      if (name === "src" || name === "poster") {
        const source = safeMediaSource(attributeValue);
        if (source) element.setAttribute(attribute.name, source);
        else element.removeAttribute(attribute.name);
      }
    });
  });

  document.body.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
    image.removeAttribute("width");
    image.removeAttribute("height");
  });

  document.body.querySelectorAll("video").forEach((video) => {
    video.removeAttribute("controls");
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.removeAttribute("width");
    video.removeAttribute("height");
  });

  return document.body.innerHTML;
}

function formatAchievementPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  })}%`;
}

function AchievementIcon({
  achievement,
  onSelect,
}: {
  achievement: SteamAchievement;
  onSelect?: () => void;
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
  const globalPercent = formatAchievementPercent(achievement.globalPercent);
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
      className={`modal__achievement-item ${isUnlocked ? "modal__achievement-item--unlocked" : "modal__achievement-item--locked"}${isRare ? " modal__achievement-item--rare" : ""}${onSelect ? " modal__achievement-item--clickable" : ""}`}
      tabIndex={0}
      aria-label={ariaLabel}
      ref={itemRef}
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
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
}

function achievementImageSourceList(achievements: SteamAchievement[]) {
  return uniqueSources(
    achievements.flatMap((achievement) => [
      achievement.icon,
      achievement.iconGray,
    ])
  );
}

function GameDetailsLoadingSections() {
  return (
    <div className="modal__details-loading" role="status" aria-hidden="true">
      <section className="modal__achievements-section modal__details-loading-section">
        <div className="modal__achievements-heading modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__sidebar-section-content modal__details-loading-content">
          <ul className="modal__achievements-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <li className="modal__achievement-item modal__achievement-item--skeleton loading-wave" key={`achievement-loading-${index}`} />
            ))}
          </ul>
        </div>
      </section>

      <section className="modal__requirements-section modal__details-loading-section">
        <div className="modal__requirements-header modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__requirements-panel modal__sidebar-section-content modal__details-loading-content">
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
      </section>

      <section className="modal__chips-section modal__details-loading-section">
        <div className="modal__chips-heading modal__sidebar-section-toggle modal__sidebar-section-toggle--skeleton">
          <span className="modal__details-loading-icon loading-wave" />
          <strong className="modal__details-loading-title loading-wave" />
          <span className="modal__details-loading-chevron loading-wave" />
        </div>
        <div className="modal__chips modal__sidebar-section-content modal__details-loading-content">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="modal__chip modal__chip--skeleton loading-wave" key={`chip-loading-${index}`} />
          ))}
        </div>
      </section>
    </div>
  );
}

interface GameModalProps {
  game: GhostBoxGame | null;
  isAdding: boolean;
  isAdded: boolean;
  isInstalled: boolean;
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
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const [detailGame, setDetailGame] = useState<GhostBoxGame | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [loadedScreenshotSources, setLoadedScreenshotSources] = useState<
    Set<string>
  >(() => new Set());
  const [failedScreenshotSources, setFailedScreenshotSources] = useState<
    Set<string>
  >(() => new Set());
  const [failedLogoSources, setFailedLogoSources] = useState<Set<string>>(
    () => new Set()
  );
  const [loadedLogoSource, setLoadedLogoSource] = useState("");
  const [visibleScreenshotSource, setVisibleScreenshotSource] = useState("");
  const [isBackupOptionsOpen, setIsBackupOptionsOpen] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [reviewSummaryContainer, setReviewSummaryContainer] =
    useState<HTMLDivElement | null>(null);
  const achievementsPanelId = useId();
  const chipsPanelId = useId();
  const [isAchievementsCollapsed, setIsAchievementsCollapsed] = useState(false);
  const [isChipsCollapsed, setIsChipsCollapsed] = useState(false);
  const [achievementsPanelRef, achievementsPanelHeight] =
    useCollapsiblePanelHeight();
  const [chipsPanelRef, chipsPanelHeight] = useCollapsiblePanelHeight();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const aboutContentShellRef = useRef<HTMLDivElement | null>(null);
  const aboutActionsRef = useRef<HTMLDivElement | null>(null);
  const pressTimeoutRef = useRef<number | null>(null);
  const [aboutCollapsedMaxHeight, setAboutCollapsedMaxHeight] = useState<
    number | null
  >(null);

  useEffect(() => {
    setActiveScreenshot(0);
    setLoadedScreenshotSources(new Set());
    setFailedScreenshotSources(new Set());
    setFailedLogoSources(new Set());
    setLoadedLogoSource("");
    setVisibleScreenshotSource("");
    setIsBackupOptionsOpen(false);
    setIsPressing(false);
  }, [game?.id]);

  useEffect(() => {
    return () => {
      if (pressTimeoutRef.current !== null) {
        window.clearTimeout(pressTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetailGame(game);

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
      if (cancelled || !details) return;

      const hasIncoming =
        (details.achievementList?.length ?? 0) > 0 ||
        (details.achievements?.total ?? 0) > 0;
      if (!hasIncoming) return;

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
      onDetailsLoaded?.(details);
    };
    const detailsGameId = game.appId || game.id;

    loadGameStoreDetailsCached(detailsGameId)
      .then(mergeStoreDetails)
      .catch(() => undefined)
      .finally(finishRequest);

    loadGameAchievementDetailsCached(detailsGameId)
      .then(mergeAchievementDetails)
      .catch(() => undefined)
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

  function triggerPressAnimation() {
    if (pressTimeoutRef.current !== null) return;

    requestAnimationFrame(() => {
      setIsPressing(true);
      pressTimeoutRef.current = window.setTimeout(() => {
        setIsPressing(false);
        pressTimeoutRef.current = null;
      }, 180);
    });
  }

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
  const cachedScreenshotSources = useCachedImageSources(showcaseSources);
  const logoSources = displayGame ? gameLogoSources(displayGame) : [];
  const cachedLogoSources = useCachedImageSources(logoSources);
  const logoCandidates = uniqueSources([...cachedLogoSources, ...logoSources]);
  const currentLogoSource =
    logoCandidates.find((source) => !failedLogoSources.has(source)) ?? "";
  const achievements = useMemo(
    () =>
      [...(displayGame?.achievementList ?? [])].sort(
        (a, b) => Number(b.unlocked === true) - Number(a.unlocked === true)
      ),
    [displayGame?.achievementList]
  );
  const visibleAchievements = achievements.slice(0, 12);
  const hasMoreAchievements = achievements.length > 12;
  const screenshotsKey = showcaseSources.join("\n");
  const modalHeroSourcesKey = modalHeroSources.join("\n");
  const cachedScreenshotsKey = cachedScreenshotSources.join("\n");
  const achievementImageSources =
    achievementImageSourceList(visibleAchievements);
  const achievementImageSourcesKey = achievementImageSources.join("\n");

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
            loadedScreenshotSources.has(candidate) &&
            !failedScreenshotSources.has(candidate)
        );
        const displaySource =
          loadedSource ??
          candidates.find(
            (candidate) => !failedScreenshotSources.has(candidate)
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
      loadedScreenshotSources,
      failedScreenshotSources,
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
      loadedScreenshotSources.has(currentScreenshotSource)
    ) {
      setVisibleScreenshotSource(currentScreenshotSource);
    }
  }, [currentScreenshotSource, loadedScreenshotSources]);

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
  const hasRequirements = Boolean(
    displayGame?.pcRequirements?.minimum.length ||
    displayGame?.pcRequirements?.recommended.length
  );
  const shouldShowDetailLoading =
    isLoadingDetails &&
    !visibleChips.length &&
    !achievements.length &&
    !hasRequirements;

  useEffect(() => {
    if (!aboutTheGameHtml || isAboutExpanded) {
      setAboutCollapsedMaxHeight(null);
      return;
    }

    let frameId = 0;
    const updateCollapsedHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const sidebar = sidebarRef.current;
        const shell = aboutContentShellRef.current;
        const actions = aboutActionsRef.current;
        if (!sidebar || !shell || !actions) return;

        const sidebarBottom = sidebar.getBoundingClientRect().bottom;
        const shellTop = shell.getBoundingClientRect().top;
        const actionsHeight = actions.getBoundingClientRect().height;
        const nextHeight = Math.max(
          160,
          Math.floor(sidebarBottom - shellTop - actionsHeight - 10)
        );

        setAboutCollapsedMaxHeight((current) =>
          current !== null && Math.abs(current - nextHeight) <= 1
            ? current
            : nextHeight
        );
      });
    };

    updateCollapsedHeight();
    window.addEventListener("resize", updateCollapsedHeight);

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateCollapsedHeight)
        : null;
    if (observer) {
      if (sidebarRef.current) observer.observe(sidebarRef.current);
      if (aboutContentShellRef.current) observer.observe(aboutContentShellRef.current);
      if (aboutActionsRef.current) observer.observe(aboutActionsRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateCollapsedHeight);
      observer?.disconnect();
    };
  }, [aboutTheGameHtml, isAboutExpanded, displayGame?.id, shouldShowDetailLoading]);

  function handleViewAchievements() {
    if (!displayGame || !onViewAchievements) return;
    onViewAchievements(displayGame);
  }

  return (
    <>
      {displayGame && (
        <div
          className="backdrop backdrop--details"
          key={displayGame.id}
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
                            key={`${item.index}-${item.source}-${item.displaySource}`}
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
                              setLoadedScreenshotSources((loadedSources) => {
                                if (loadedSources.has(item.displaySource))
                                  return loadedSources;
                                const nextLoadedSources = new Set(
                                  loadedSources
                                );
                                nextLoadedSources.add(item.displaySource);
                                return nextLoadedSources;
                              });
                              if (
                                item.displaySource === currentScreenshotSource
                              ) {
                                setVisibleScreenshotSource(item.displaySource);
                              }
                            }}
                            onError={() => {
                              setFailedScreenshotSources((failedSources) =>
                                new Set(failedSources).add(item.displaySource)
                              );
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

                <div
                  className={`modal__actions ${isAdding ? "modal__actions--adding" : ""}`}
                >
                  {isInstalled && (
                      <button
                        type="button"
                        className={`button button--primary modal__play-button${isPressing ? " modal__play-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => {
                          if (isPlaying || isSessionActive) return;
                          onPlayGame(displayGame);
                        }}
                        disabled={isPlaying || isSessionActive}
                        aria-busy={isPlaying}
                      >
                      {isPlaying ? (
                        <span className="modal__add-spinner modal__add-spinner--light" aria-hidden="true" />
                      ) : (
                        <Play size={20} strokeWidth={2.0} />
                      )}
                      <span className="button__label modal__action-label">
                        {isSessionActive
                          ? appearance.language === "en"
                            ? "Playing"
                            : "Jogando"
                          : isPlaying
                            ? appearance.language === "en"
                              ? "Launching"
                              : "Iniciando"
                            : appearance.language === "en"
                              ? "Play"
                              : "Jogar"}
                      </span>
                    </button>
                  )}
                  {isAdding ? (
                    <div
                      className="modal__adding-state"
                      aria-label={
                        appearance.language === "en"
                          ? "Adding game"
                          : "Adicionando jogo"
                      }
                    >
                      <span className="modal__add-progress" />
                    </div>
                  ) : isAdded ? (
                    <>
                      <button
                        type="button"
                        className={`button button--primary modal__remove-button${isPressing ? " modal__remove-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => onRemoveGame(displayGame)}
                        disabled={isRemoving}
                      >
                        {isRemoving ? (
                          <>
                            <span
                              className="modal__add-spinner modal__add-spinner--light"
                              aria-hidden="true"
                            />
                            <span className="button__label modal__action-label">
                              {appearance.language === "en"
                                ? "Removing"
                                : "Removendo"}
                            </span>
                          </>
                        ) : (
                          <>
                            <Trash2 size={18} aria-hidden="true" />
                            <span className="button__label modal__action-label">
                              {appearance.language === "en"
                                ? "Remove"
                                : "Remover"}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""} ${isPressing ? "modal__favorite-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => onToggleFavorite(displayGame)}
                        aria-pressed={isFavorite}
                        aria-label={
                          isFavorite
                            ? appearance.language === "en"
                              ? `Remove ${displayGame.title} from favorites`
                              : `Remover ${displayGame.title} dos favoritos`
                            : appearance.language === "en"
                              ? `Add ${displayGame.title} to favorites`
                              : `Adicionar ${displayGame.title} aos favoritos`
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
                        className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}${isPressing ? " modal__gear-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => setIsBackupOptionsOpen(true)}
                        aria-label={
                          appearance.language === "en"
                            ? "Backup settings"
                            : "Ajustes de backup"
                        }
                      >
                        <Settings size={20} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`button button--primary modal__add-button${isPressing ? " modal__add-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => onQueueGame(displayGame)}
                      >
                        <Download size={20} />
                        <span className="button__label modal__action-label">
                          {appearance.language === "en" ? "Add" : "Adicionar"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`modal__favorite-button ${isFavorite ? "modal__favorite-button--active" : ""} ${isPressing ? "modal__favorite-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => onToggleFavorite(displayGame)}
                        aria-pressed={isFavorite}
                        aria-label={
                          isFavorite
                            ? appearance.language === "en"
                              ? `Remove ${displayGame.title} from favorites`
                              : `Remover ${displayGame.title} dos favoritos`
                            : appearance.language === "en"
                              ? `Add ${displayGame.title} to favorites`
                              : `Adicionar ${displayGame.title} aos favoritos`
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
                        className={`modal__gear-button ${isBackupOptionsOpen ? "modal__gear-button--active" : ""}${isPressing ? " modal__gear-button--press" : ""}`}
                        onPointerDown={triggerPressAnimation}
                        onClick={() => setIsBackupOptionsOpen(true)}
                        aria-label={
                          appearance.language === "en"
                            ? "Backup settings"
                            : "Ajustes de backup"
                        }
                      >
                        <Settings size={20} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
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
                      className={`modal__about-content-shell ${isAboutExpanded ? "modal__about-content-shell--expanded" : ""}`}
                      style={
                        !isAboutExpanded && aboutCollapsedMaxHeight !== null
                          ? {
                              height: aboutCollapsedMaxHeight,
                              maxHeight: aboutCollapsedMaxHeight,
                            }
                          : undefined
                      }
                    >
                      <div
                        className="modal__about-content"
                        dangerouslySetInnerHTML={{ __html: aboutTheGameHtml }}
                      />
                      {!isAboutExpanded && (
                        <div className="modal__about-fade" aria-hidden="true" />
                      )}
                    </div>
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
                  </section>
                )}
              </div>

              <aside className="modal__sidebar" ref={sidebarRef}>
                {shouldShowDetailLoading ? (
                  <GameDetailsLoadingSections />
                ) : (
                  <>
                    {achievements.length > 0 && (
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
                          ref={achievementsPanelRef}
                          className="modal__sidebar-section-content"
                          id={achievementsPanelId}
                          aria-hidden={isAchievementsCollapsed}
                          data-collapsed={
                            isAchievementsCollapsed ? "true" : "false"
                          }
                          style={{
                            height: isAchievementsCollapsed
                              ? 0
                              : achievementsPanelHeight,
                          } as CSSProperties}
                        >
                          <ul className="modal__achievements-grid">
                            {visibleAchievements.map((achievement) => (
                              <AchievementIcon
                                achievement={achievement}
                                key={achievement.name}
                                onSelect={
                                  onViewAchievements
                                    ? handleViewAchievements
                                    : undefined
                                }
                              />
                            ))}
                          </ul>

                          {hasMoreAchievements && onViewAchievements && (
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
                          ref={chipsPanelRef}
                          className="modal__chips modal__sidebar-section-content"
                          id={chipsPanelId}
                          aria-hidden={isChipsCollapsed}
                          data-collapsed={isChipsCollapsed ? "true" : "false"}
                          style={{
                            height: isChipsCollapsed ? 0 : chipsPanelHeight,
                          } as CSSProperties}
                        >
                          {visibleChips.map((chip) => (
                            <span className="modal__chip" key={chip}>
                              {chip}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}

                    <div
                      className="modal__review-summary-slot"
                      ref={setReviewSummaryContainer}
                    />
                  </>
                )}
              </aside>

              <Suspense fallback={null}>
                <LazyGameReviewsSection
                  gameId={displayGame.appId || displayGame.id}
                  fallbackPositiveRatio={displayGame.steamPositiveRatio}
                  fallbackReviewCount={displayGame.steamReviewCount}
                  language={appearance.language}
                  summaryContainer={reviewSummaryContainer}
                />
              </Suspense>
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
