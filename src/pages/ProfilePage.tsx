import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  memo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  Camera,
  Folder,
  Layers,
  LogOut,
  Pencil,
  ShieldUser,
  User,
} from "lucide-react";
import { Cup, CupStar } from "reicon-react";
import type { GhostBoxGame, SteamAchievement } from "../data";
import type { SteamAccountStats, SteamProfile, UserCollection } from "../types";
import { GameGrid } from "../components/ui/GameCard";
import {
  ContextMenu,
} from "../components/ui/ContextMenu";
import { EmptyState } from "../components/ui/LoadingStates";
import { PaginationControls } from "../components/ui/PaginationControls";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { useGameIconUrl } from "../hooks/useGameIconUrl";
import steamIcon from "../../Icons/steam-colored.svg";
import { EditProfileModal } from "../components/modals/EditProfileModal";
import "./ProfilePage.scss";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import {
  gameSteamHeaderFirstSources,
  getGameAppId,
  layeredImageStyle,
  preloadGameListAssets,
  preloadProfileImages,
  profileBannerPlaceholderSource,
} from "../utils/image";
import { useSettings } from "../context/settings";
import { formatCompactPlaytime, parseLastPlayed } from "../utils/time";
import { mergeGameCardData } from "../utils/gameCardData";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
} from "../utils/gameCache";
import { sortOverviewGames } from "../utils/overviewSort";
import {
  getProfileAchievementTotal as getAchievementTotal,
  getProfileUnlockedAchievementCount as getUnlockedAchievementCount,
  getRicherProfileAchievementGame as getRicherAchievementGame,
  isProfileAchievementUnlocked as isAchievementUnlocked,
  isRecognizedSteamProfileGame,
} from "../utils/profileAchievements";
import {
  readStoredOverviewSortBy,
  writeStoredOverviewSortBy,
  type OverviewSortBy,
} from "../utils/storage";
import {
  buildSteamAchievementIndex,
  mergeAchievementDetailsIntoGame,
  mergeSteamAchievementsIntoGame,
  mergeSteamAchievementsIntoGames,
} from "../utils/steamAchievementMerge";
import { buildSteamOwnedGamesFromPlaytimes } from "../utils/steamLibraryMerge";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";
import { ghostboxApi } from "../lib/ghostboxApi";
import type { DiscordLinkStatus } from "../lib/ghostboxApi.types";

type BannerPosition = NonNullable<SteamProfile["bannerPosition"]>;

const emptyImageSources: string[] = [];
const recentActivityPageSize = 8;
const profileAchievementPageSize = 5;


const overviewSortOptions: OverviewSortBy[] = [
  "recent",
  "playtime",
  "title",
  "achievements",
  "perfect",
];

const ProfileActivityCard = memo(function ProfileActivityCard({
  game,
  displayGame,
  displayTitle,
  achievementTotal,
  achievementUnlocked,
  achievementProgress,
  latestAchievements,
  overflowCount,
  statusLabel,
  t,
  onOpenGame,
}: {
  game: GhostBoxGame;
  displayGame: GhostBoxGame;
  displayTitle: string;
  achievementTotal: number;
  achievementUnlocked: number;
  achievementProgress: number;
  latestAchievements: ProfileAchievementHighlight[];
  overflowCount: number;
  statusLabel: string | null;
  t: (key: string) => string;
  onOpenGame: (game: GhostBoxGame) => void;
}) {
  const appId = getGameAppId(game);
  const coverSources = useCachedImageSources(gameSteamHeaderFirstSources(game));
  const {
    source: headerSource,
    loaded: headerLoaded,
  } = useLoadableImageCover(coverSources, {
    appId,
    kind: "header",
  });

  function preloadActivityCover() {
    preloadGameListAssets([displayGame], {
      variant: "header",
      limit: 1,
      idle: false,
      nativeResolve: false,
    });
  }

  const isPerfect =
    achievementTotal > 0 && achievementUnlocked >= achievementTotal;
  const openGame = () => onOpenGame(displayGame);
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openGame();
  };

  return (
    <article
      className={`profile-page__activity-card${
        achievementTotal > 0 ? " profile-page__activity-card--with-achievements" : ""
      }${isPerfect ? " profile-page__activity-card--perfect" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={displayTitle}
      onClick={openGame}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={preloadActivityCover}
      onFocus={preloadActivityCover}
    >
      <span
        className="profile-page__activity-cover-button"
        aria-hidden="true"
      >
        <span
          className={`profile-page__activity-game-cover${
            headerLoaded && headerSource
              ? " profile-page__game-cover--loaded"
              : " profile-page__game-cover--loading"
          }`}
          style={layeredImageStyle(
            headerLoaded && headerSource ? [headerSource] : emptyImageSources,
            "",
          )}
          aria-hidden="true"
        />
      </span>

      <span
        className="profile-page__activity-main"
      >
        <span className="profile-page__activity-meta">
          <strong>{displayTitle}</strong>
        </span>
        <span className="profile-page__activity-side">
          <span className="profile-page__activity-hours">
            {formatCompactPlaytime(getGamePlaytime(game))} {t("profile.played")}
          </span>
          {statusLabel ? (
            <span className="profile-page__activity-status">{statusLabel}</span>
          ) : null}
        </span>
      </span>

      {achievementTotal > 0 ? (
        <div className="profile-page__activity-achievements">
          <span
            className="profile-page__activity-progress"
          >
            <span className="profile-page__activity-progress-label">
              {isPerfect ? (
                <CupStar
                  className="profile-page__activity-cup-icon profile-page__activity-cup-icon--perfect"
                  size={18}
                  weight="Filled"
                  strokeWidth={2.0}
                  color="var(--premium-gold)"
                  aria-hidden="true"
                />
              ) : (
                <Cup
                  className="profile-page__activity-cup-icon"
                  size={18}
                  weight="Filled"
                  strokeWidth={2.0}
                  color="var(--text-tertiary, var(--text-secondary))"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="profile-page__activity-progress-count">
              {achievementUnlocked} {t("profile.of")} {achievementTotal}
            </span>
            <span
              className="profile-page__progress-track profile-page__progress-track--compact"
              aria-hidden="true"
            >
              <span style={{ width: `${achievementProgress}%` }} />
            </span>
          </span>
          {latestAchievements.length > 0 ? (
            <div className="profile-page__activity-icons">
              {latestAchievements.map((achievement) => (
                <span
                  key={achievement.key}
                  className="profile-page__activity-icon"
                  aria-label={achievement.title}
                >
                  <img
                    src={achievement.icon}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="profile-page__activity-tooltip" role="tooltip">
                    <strong>{achievement.title}</strong>
                    {achievement.description ? <span>{achievement.description}</span> : null}
                    {typeof achievement.globalPercent === "number" ? (
                      <small>{achievement.globalPercent.toFixed(1)}% global</small>
                    ) : null}
                  </span>
                </span>
              ))}
              {overflowCount > 0 ? (
                <span className="profile-page__activity-icon-more">
                  +{overflowCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

function LoadedProfileAchievementGameIcon({ game }: { game: GhostBoxGame }) {
  const { url: iconUrl, loading: iconLoading } = useGameIconUrl(game);

  return (
    <span
      className={`profile-page__achievement-game-icon${
        !iconUrl && iconLoading ? " profile-page__achievement-game-icon--skeleton" : ""
      }`}
      aria-hidden="true"
    >
      {iconUrl ? <img src={iconUrl} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}

function ProfileAchievementGameIcon({ game }: { game: GhostBoxGame }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (shouldLoad) return <LoadedProfileAchievementGameIcon game={game} />;

  return (
    <span
      ref={containerRef}
      className="profile-page__achievement-game-icon profile-page__achievement-game-icon--skeleton"
      aria-hidden="true"
    />
  );
}

function ProfileAchievementCardRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{
    startClientX: number;
    startScrollLeft: number;
    maxScroll: number;
    thumbTravel: number;
  } | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isDraggingScrollbar, setIsDraggingScrollbar] = useState(false);
  const [scrollbarStyle, setScrollbarStyle] = useState<CSSProperties>({
    "--achievement-scrollbar-thumb-width": "100%",
    "--achievement-scrollbar-thumb-x": "0px",
  } as CSSProperties);

  const updateScrollbar = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;

    const maxScroll = row.scrollWidth - row.clientWidth;
    const nextIsScrollable = maxScroll > 1;
    setIsScrollable(nextIsScrollable);

    if (!nextIsScrollable) {
      setScrollbarStyle({
        "--achievement-scrollbar-thumb-width": "100%",
        "--achievement-scrollbar-thumb-x": "0px",
      } as CSSProperties);
      return;
    }

    const trackWidth = row.clientWidth;
    const thumbWidth = Math.max((row.clientWidth / row.scrollWidth) * trackWidth, 32);
    const thumbX = (row.scrollLeft / maxScroll) * (trackWidth - thumbWidth);

    setScrollbarStyle({
      "--achievement-scrollbar-thumb-width": `${thumbWidth}px`,
      "--achievement-scrollbar-thumb-x": `${thumbX}px`,
    } as CSSProperties);
  }, []);

  const scrollToScrollbarPosition = useCallback((clientX: number) => {
    const row = rowRef.current;
    const track = trackRef.current;
    if (!row || !track) return;

    const maxScroll = row.scrollWidth - row.clientWidth;
    if (maxScroll <= 1) return;

    const trackRect = track.getBoundingClientRect();
    const thumbWidth = Math.max((row.clientWidth / row.scrollWidth) * trackRect.width, 32);
    const thumbTravel = trackRect.width - thumbWidth;
    if (thumbTravel <= 0) return;

    const targetX = Math.min(
      thumbTravel,
      Math.max(0, clientX - trackRect.left - thumbWidth / 2)
    );
    row.scrollLeft = (targetX / thumbTravel) * maxScroll;
  }, []);

  const handleTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    scrollToScrollbarPosition(event.clientX);
  }, [scrollToScrollbarPosition]);

  const handleThumbPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    const row = rowRef.current;
    const track = trackRef.current;
    if (!row || !track) return;

    const maxScroll = row.scrollWidth - row.clientWidth;
    if (maxScroll <= 1) return;

    const trackWidth = track.getBoundingClientRect().width;
    const thumbWidth = Math.max((row.clientWidth / row.scrollWidth) * trackWidth, 32);
    const thumbTravel = trackWidth - thumbWidth;
    if (thumbTravel <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startClientX: event.clientX,
      startScrollLeft: row.scrollLeft,
      maxScroll,
      thumbTravel,
    };
    setIsDraggingScrollbar(true);
  }, []);

  useEffect(() => {
    if (!isDraggingScrollbar) return;

    function handlePointerMove(event: PointerEvent) {
      const row = rowRef.current;
      const drag = dragRef.current;
      if (!row || !drag) return;

      const deltaX = event.clientX - drag.startClientX;
      row.scrollLeft = drag.startScrollLeft +
        (deltaX / drag.thumbTravel) * drag.maxScroll;
    }

    function handlePointerUp() {
      dragRef.current = null;
      setIsDraggingScrollbar(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDraggingScrollbar]);

  useLayoutEffect(() => {
    updateScrollbar();

    const row = rowRef.current;
    if (!row) return;

    const resizeObserver = new ResizeObserver(updateScrollbar);
    resizeObserver.observe(row);

    return () => resizeObserver.disconnect();
  }, [children, updateScrollbar]);

  return (
    <div
      className={`profile-page__achievement-card-shell${
        isScrollable ? " profile-page__achievement-card-shell--scrollable" : ""
      }${
        isDraggingScrollbar ? " profile-page__achievement-card-shell--scrolling" : ""
      }`}
      style={scrollbarStyle}
    >
      <div
        ref={rowRef}
        className="profile-page__achievement-card-row"
        onScroll={updateScrollbar}
      >
        {children}
      </div>
      <span
        ref={trackRef}
        className="profile-page__achievement-card-scrollbar"
        aria-hidden="true"
        onPointerDown={handleTrackPointerDown}
      >
        <span
          className="profile-page__achievement-card-scrollbar-thumb"
          onPointerDown={handleThumbPointerDown}
        />
      </span>
    </div>
  );
}

function normalizeBannerPosition(
  position?: SteamProfile["bannerPosition"]
): BannerPosition {
  return {
    x: Math.min(100, Math.max(0, Math.round(position?.x ?? 50))),
    y: Math.min(100, Math.max(0, Math.round(position?.y ?? 50))),
    scale: Math.min(3, Math.max(1, Number((position?.scale ?? 1).toFixed(2)))),
  };
}

interface ProfilePageProps {
  steamProfile: SteamProfile | null;
  steamAccountStats?: SteamAccountStats | null;
  isCloudProfileRestoring?: boolean;
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  achievementHistoryGames?: GhostBoxGame[];
  userCollections: UserCollection[];
  activeCollectionId?: string;
  onSelectCollection?: (id: string) => void;
  onUpdateProfile: (
    displayName: string,
    avatarUrl: string,
    bannerUrl: string,
    bannerPosition: BannerPosition
  ) => Promise<void> | void;
  onOpenGame: (game: GhostBoxGame) => void;
  removableGameAppIds: Set<string>;
  libraryGameAppIds?: Set<string>;
  playableGameAppIds?: Set<string>;
  activeSessionAppIds?: Set<string>;
  addingGameId?: string | null;
  launchingGameId?: string | null;
  onAddGame?: (game: GhostBoxGame) => void;
  onRemoveGame: (game: GhostBoxGame) => void;
  onPlayGame?: (game: GhostBoxGame) => void;
  onRemoveGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
  favoriteGameIds?: Set<string>;
  onToggleFavorite?: (game: GhostBoxGame) => void;
  onAddGameToCollection?: (game: GhostBoxGame, collectionId: string) => void;
  onOpenGameAchievements?: (
    game: GhostBoxGame,
    achievementId?: string
  ) => void;
  onSignOut?: () => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
}

type ProfileCollection = {
  id: string;
  name: string;
  count: number;
};

type ProfileAchievementHighlight = {
  key: string;
  game?: GhostBoxGame;
  achievementId: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  gameTitle: string;
  globalPercent?: number;
  unlockedAt?: string;
};

type ProfileActivityViewModel = {
  game: GhostBoxGame;
  displayGame: GhostBoxGame;
  displayTitle: string;
  achievementTotal: number;
  achievementUnlocked: number;
  achievementProgress: number;
  latestAchievements: ProfileAchievementHighlight[];
  overflowCount: number;
  statusLabel: string | null;
};

// Candidates here are exactly the games Steam has no remote achievement data
// for, so local hydration is the only thing that can make them pass
// `isRecognizedSteamProfileGame` and show up on the profile at all. Capping the
// pass lower drops games from the page instead of merely delaying them, so the
// budget stays wide and the cost is paid down by idle batching + the staged
// flush below rather than by hydrating less.
const localAchievementHydrationLimit = 80;
const localAchievementHydrationBatchSize = 5;
let hasPreparedProfileOverviewData = false;


function getGamePlaytime(game: GhostBoxGame) {
  // Only Steam-synced totals (never catalogue `hours` or stale local cache).
  return game.playTimeInMilliseconds ?? 0;
}

function formatProfileLastSession(value: string | null | undefined, language: string) {
  const time = parseLastPlayed(value);
  if (!Number.isFinite(time)) {
    return language === "en" ? "Not recorded" : "Sem registro";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "short",
  }).format(time);
}

function getProfileGameTitle(
  game: GhostBoxGame,
  language: string,
  resolvedTitle?: string
) {
  const title = resolvedTitle?.trim() || game.title;

  return isSteamTitlePlaceholder(title, game.appId)
    ? language === "en"
      ? "Steam game"
      : "Jogo Steam"
    : title;
}

function withResolvedProfileGameTitle(
  game: GhostBoxGame,
  resolvedTitlesByAppId: Map<string, string>
): GhostBoxGame {
  const resolvedTitle = resolvedTitlesByAppId.get(game.appId)?.trim();
  if (!resolvedTitle || resolvedTitle === game.title) return game;
  return { ...game, title: resolvedTitle };
}

function mergeProfileGameCardData(game: GhostBoxGame, details: GhostBoxGame) {
  return mergeGameCardData(game, details);
}

function achievementShowcaseKey(
  game: GhostBoxGame,
  achievement: SteamAchievement
) {
  return `${game.id}-${achievement.name || achievement.title}`;
}

function achievementShowcaseIcon(
  achievement: SteamAchievement,
  unlocked: boolean
) {
  return unlocked
    ? achievement.icon || achievement.iconGray
    : achievement.iconGray || achievement.icon;
}

function achievementUnlockedTime(unlockedAt?: string) {
  const time = Date.parse(unlockedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

export function ProfilePage({
  steamProfile,
  steamAccountStats = null,
  isCloudProfileRestoring = false,
  favoriteGames,
  addedLibraryGames,
  achievementHistoryGames = [],
  userCollections,
  activeCollectionId: propActiveCollectionId,
  onSelectCollection,
  onUpdateProfile,
  onOpenGame,
  removableGameAppIds,
  libraryGameAppIds = new Set(),
  playableGameAppIds = new Set(),
  activeSessionAppIds = new Set(),
  addingGameId = null,
  launchingGameId = null,
  onAddGame,
  onRemoveGame,
  onPlayGame,
  onRemoveGameFromCollection,
  favoriteGameIds = new Set(),
  onToggleFavorite,
  onAddGameToCollection,
  onOpenGameAchievements,
  onSignOut,
  scrollElementRef,
}: ProfilePageProps) {
  const { appearance, t } = useSettings();
  const [internalActiveCollectionId, setInternalActiveCollectionId] =
    useState("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [renderedGameCount, setRenderedGameCount] = useState(40);
  const [expandedAchievementGameIds, setExpandedAchievementGameIds] = useState<Set<string>>(
    () => new Set()
  );
  const [localAchievementGamesByAppId, setLocalAchievementGamesByAppId] =
    useState<Map<string, GhostBoxGame>>(() => new Map());
  const localAchievementRequestedAppIdsRef = useRef(new Set<string>());
  const localAchievementCompletedAppIdsRef = useRef(new Set<string>());
  const localAchievementHydrationFailedUntilRef = useRef(new Map<string, number>());
  const [resolvedGameTitlesByAppId, setResolvedGameTitlesByAppId] =
    useState<Map<string, string>>(() => new Map());
  const resolvedGameTitleAppIdsRef = useRef(new Set<string>());
  const resolvedGameTitleCompletedAppIdsRef = useRef(new Set<string>());
  const [isOverviewDataReady, setIsOverviewDataReady] = useState(
    () => hasPreparedProfileOverviewData
  );
  const [recentActivityPage, setRecentActivityPage] = useState(1);
  const [achievementTabPage, setAchievementTabPage] = useState(1);
  const [overviewSortBy, setOverviewSortBy] = useState<OverviewSortBy>(() =>
    readStoredOverviewSortBy(),
  );
  const [overviewSortDropdownOpen, setOverviewSortDropdownOpen] = useState(false);
  const overviewSortDropdownRef = useRef<HTMLDivElement | null>(null);
  const loadMoreGamesRef = useRef<HTMLDivElement | null>(null);
  const [isSteamIdVisible, setIsSteamIdVisible] = useState(false);
  const [isSteamIdCopied, setIsSteamIdCopied] = useState(false);
  const steamIdCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [discordLink, setDiscordLink] = useState<DiscordLinkStatus | null>(() => {
    const steamId = steamProfile?.steamId?.trim();
    return steamId ? ghostboxApi.getCachedDiscordLinkStatus(steamId) : null;
  });
  const [steamLevel, setSteamLevel] = useState<number | null>(null);

  const activeCollectionId =
    propActiveCollectionId ?? internalActiveCollectionId;
  const setActiveCollectionId =
    onSelectCollection ?? setInternalActiveCollectionId;
  const previousActiveCollectionIdRef = useRef(activeCollectionId);

  const scrollContentToTop = useCallback(() => {
    scrollElementRef?.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollElementRef]);

  useEffect(() => {
    if (previousActiveCollectionIdRef.current === activeCollectionId) return;
    previousActiveCollectionIdRef.current = activeCollectionId;
    scrollContentToTop();
  }, [activeCollectionId, scrollContentToTop]);

  // Paginação também volta ao topo: sem isso a página 2 abre no meio da lista.
  const handleRecentActivityPageChange = useCallback(
    (page: number) => {
      setRecentActivityPage(page);
      scrollContentToTop();
    },
    [scrollContentToTop]
  );

  const handleAchievementTabPageChange = useCallback(
    (page: number) => {
      setAchievementTabPage(page);
      scrollContentToTop();
    },
    [scrollContentToTop]
  );

  const [gameContextMenu, setGameContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

  const toggleAchievementGameExpanded = useCallback((gameId: string) => {
    setExpandedAchievementGameIds((current) => {
      const next = new Set(current);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  }, []);

  const profileCollections = useMemo<ProfileCollection[]>(() => {
    return [
      {
        id: "overview",
        name: t("profile.overview"),
        count: addedLibraryGames.length,
      },
      {
        id: "library",
        name: t("profile.library"),
        count: addedLibraryGames.length,
      },
      {
        id: "achievements",
        name: t("achievements.title"),
        count: 0,
      },
    ];
  }, [addedLibraryGames.length, t]);

  const userCollectionById = useMemo(
    () =>
      new Map(userCollections.map((collection) => [collection.id, collection])),
    [userCollections]
  );

  const activeCollection = useMemo(
    () =>
      profileCollections.find(
        (collection) => collection.id === activeCollectionId
      ) ??
      (() => {
        const collection = userCollectionById.get(activeCollectionId);
        return collection
          ? {
              id: collection.id,
              name: collection.name,
              count: collection.gameIds.length,
            }
          : profileCollections[0];
      })(),
    [activeCollectionId, profileCollections, userCollectionById],
  );
  const activeTabId = activeCollection.id;
  const isOverviewActive = activeCollection.id === "overview";
  const isAchievementsActive = activeCollection.id === "achievements";
  const shouldBuildCollectionGameData = !isOverviewActive;
  const shouldComputeOverviewData = isOverviewActive
    ? isOverviewDataReady
    : isAchievementsActive;

  useEffect(() => {
    if (!isOverviewActive || isOverviewDataReady) return;

    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        startTransition(() => {
          hasPreparedProfileOverviewData = true;
          setIsOverviewDataReady(true);
        });
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [isOverviewActive, isOverviewDataReady]);

  const steamAchievementIndex = useMemo(
    () =>
      shouldComputeOverviewData
        ? buildSteamAchievementIndex(steamAccountStats)
        : new Map(),
    [shouldComputeOverviewData, steamAccountStats],
  );

  // Steam account games are not listed in the library, but profile recognition
  // still needs playtime + achievements from the owned stats payload.
  const steamOwnedProfileGames = useMemo(() => {
    if (!shouldComputeOverviewData || !steamAccountStats?.ownedPlaytimes?.length) {
      return [];
    }
    return mergeSteamAchievementsIntoGames(
      buildSteamOwnedGamesFromPlaytimes(steamAccountStats.ownedPlaytimes, {}),
      steamAccountStats,
      steamAchievementIndex,
    );
  }, [shouldComputeOverviewData, steamAccountStats, steamAchievementIndex]);

  const profileGameBase = useMemo(() => {
    if (!shouldComputeOverviewData) return [];

    const games = new Map<string, GhostBoxGame>();
    const addGame = (game: GhostBoxGame) => {
      games.set(
        game.appId,
        getRicherAchievementGame(games.get(game.appId), game),
      );
    };

    for (const game of achievementHistoryGames) addGame(game);
    for (const game of addedLibraryGames) addGame(game);
    for (const game of favoriteGames) addGame(game);
    for (const game of steamOwnedProfileGames) addGame(game);

    return [...games.values()];
  }, [
    achievementHistoryGames,
    addedLibraryGames,
    favoriteGames,
    shouldComputeOverviewData,
    steamOwnedProfileGames,
  ]);

  const overviewPreloadGames = useMemo(() => {
    return profileGameBase
      .filter((game) => isRecognizedSteamProfileGame(game, getGamePlaytime(game)))
      .sort((left, right) => {
        const lastPlayedDelta =
          parseLastPlayed(right.lastTimePlayed) -
          parseLastPlayed(left.lastTimePlayed);
        if (lastPlayedDelta !== 0) return lastPlayedDelta;
        return getGamePlaytime(right) - getGamePlaytime(left);
      });
  }, [
    profileGameBase,
  ]);

  useEffect(() => {
    if (!isOverviewActive || overviewPreloadGames.length === 0) return;

    preloadGameListAssets(overviewPreloadGames, {
      variant: "header",
      limit: recentActivityPageSize,
      sourceLimit: 4,
      idle: false,
      decode: true,
      nativeResolve: false,
      roundRobin: true,
      steamHeaderFirst: true,
    });
  }, [isOverviewActive, overviewPreloadGames]);

  const enrichedGameByAppId = useMemo(() => {
    const map = new Map<string, GhostBoxGame>();
    if (!shouldBuildCollectionGameData) return map;

    const addGame = (game: GhostBoxGame) => {
      const current = map.get(game.appId);
      map.set(game.appId, current ? mergeProfileGameCardData(current, game) : game);
    };

    for (const game of achievementHistoryGames) addGame(game);
    for (const game of addedLibraryGames) addGame(game);
    for (const game of favoriteGames) addGame(game);
    for (const collection of userCollections) {
      for (const game of collection.games ?? []) addGame(game);
    }

    return map;
  }, [achievementHistoryGames, addedLibraryGames, favoriteGames, shouldBuildCollectionGameData, userCollections]);

  const enrichedFavoriteGames = useMemo(
    () => {
      if (!shouldBuildCollectionGameData) return favoriteGames;

      return favoriteGames.map((game) => {
        const details = enrichedGameByAppId.get(game.appId);
        return details ? mergeProfileGameCardData(game, details) : game;
      });
    },
    [enrichedGameByAppId, favoriteGames, shouldBuildCollectionGameData]
  );

  const enrichedAddedLibraryGames = useMemo(
    () => {
      if (!shouldBuildCollectionGameData) return addedLibraryGames;

      return addedLibraryGames.map((game) => {
        const details = enrichedGameByAppId.get(game.appId);
        return details ? mergeProfileGameCardData(game, details) : game;
      });
    },
    [addedLibraryGames, enrichedGameByAppId, shouldBuildCollectionGameData]
  );

  const gamesById = useMemo(() => {
    const map = new Map<string, GhostBoxGame>();
    if (!shouldBuildCollectionGameData) return map;

    const addGame = (game: GhostBoxGame) => {
      const details = enrichedGameByAppId.get(game.appId);
      map.set(game.id, details ? mergeProfileGameCardData(game, details) : game);
    };

    for (const game of enrichedAddedLibraryGames) addGame(game);
    for (const game of enrichedFavoriteGames) addGame(game);
    for (const collection of userCollections) {
      for (const game of collection.games ?? []) addGame(game);
    }
    return map;
  }, [enrichedAddedLibraryGames, enrichedFavoriteGames, enrichedGameByAppId, shouldBuildCollectionGameData, userCollections]);

  const profileAchievementGames = useMemo(() => {
    if (!shouldComputeOverviewData) return [];

    const games = new Map(profileGameBase.map((game) => [game.appId, game]));
    // Freshly hydrated local achievement details are merged with remote Steam
    // account unlocks so the local appcache monitor stays additive instead of
    // wiping profile-level achievement data for uninstalled games.
    for (const game of localAchievementGamesByAppId.values()) {
      const base = games.get(game.appId);
      games.set(
        game.appId,
        base
          ? {
              ...mergeAchievementDetailsIntoGame(base, game),
              title:
                !isSteamTitlePlaceholder(game.title, game.appId)
                  ? game.title
                  : base.title,
            }
          : game
      );
    }

    return [...games.values()]
      .map((game) =>
        withResolvedProfileGameTitle(game, resolvedGameTitlesByAppId),
      )
      .map((game) =>
        mergeSteamAchievementsIntoGame(
          game,
          steamAccountStats,
          steamAchievementIndex,
        ),
      )
      .filter((game) =>
        isRecognizedSteamProfileGame(game, getGamePlaytime(game)),
      );
  }, [
    localAchievementGamesByAppId,
    profileGameBase,
    resolvedGameTitlesByAppId,
    shouldComputeOverviewData,
    steamAchievementIndex,
    steamAccountStats,
  ]);

  useEffect(() => {
    if (!shouldComputeOverviewData) return;

    let cancelled = false;
    const recentGameIndexes = new Map(
      achievementHistoryGames.map((game, index) => [game.appId, index])
    );
    const remoteAchievementAppIds = new Set(
      (steamAccountStats?.achievements ?? [])
        .filter((entry) => entry.achievements.length > 0)
        .map((entry) => entry.appId)
    );
    const now = Date.now();
    const failedUntil = localAchievementHydrationFailedUntilRef.current;
    const candidates = [
      ...achievementHistoryGames,
      ...addedLibraryGames,
      ...steamOwnedProfileGames,
    ]
      .filter((game) => {
        if (
          !game.appId ||
          localAchievementRequestedAppIdsRef.current.has(game.appId)
        ) {
          return false;
        }
        if (remoteAchievementAppIds.has(game.appId)) return false;
        return (failedUntil.get(game.appId) ?? 0) <= now;
      })
      .sort((left, right) => {
        const leftRecentIndex = recentGameIndexes.get(left.appId);
        const rightRecentIndex = recentGameIndexes.get(right.appId);
        if (leftRecentIndex !== undefined || rightRecentIndex !== undefined) {
          return (leftRecentIndex ?? Number.MAX_SAFE_INTEGER) -
            (rightRecentIndex ?? Number.MAX_SAFE_INTEGER);
        }

        const unlockedDelta =
          (right.achievements?.unlocked ?? 0) - (left.achievements?.unlocked ?? 0);
        if (unlockedDelta !== 0) return unlockedDelta;

        return getGamePlaytime(right) - getGamePlaytime(left);
      })
      .slice(0, localAchievementHydrationLimit);

    if (candidates.length === 0) return;
    for (const game of candidates) {
      localAchievementRequestedAppIdsRef.current.add(game.appId);
    }

    void (async () => {
      const pendingHydratedGames = new Map<string, GhostBoxGame>();
      const pendingResolvedTitles = new Map<string, string>();
      const flushPendingResults = () => {
        if (pendingHydratedGames.size > 0) {
          for (const appId of pendingHydratedGames.keys()) {
            localAchievementCompletedAppIdsRef.current.add(appId);
          }
          setLocalAchievementGamesByAppId((current) => {
            let changed = false;
            const next = new Map(current);
            for (const [appId, game] of pendingHydratedGames) {
              if (next.has(appId)) continue;
              next.set(appId, game);
              changed = true;
            }
            return changed ? next : current;
          });
          pendingHydratedGames.clear();
        }

        if (pendingResolvedTitles.size > 0) {
          setResolvedGameTitlesByAppId((current) => {
            let changed = false;
            const next = new Map(current);
            for (const [appId, title] of pendingResolvedTitles) {
              if (next.has(appId)) continue;
              next.set(appId, title);
              changed = true;
            }
            return changed ? next : current;
          });
          pendingResolvedTitles.clear();
        }
      };

      for (let index = 0; index < candidates.length; index += localAchievementHydrationBatchSize) {
        if (cancelled) return;

        // Yield to main thread between batches so the profile render isn't blocked
        await new Promise<void>((resolve) => {
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => resolve(), { timeout: 800 });
            return;
          }
          window.setTimeout(resolve, 50);
        });

        const hydratedGames = await Promise.all(
          candidates
            .slice(index, index + localAchievementHydrationBatchSize)
            .map(async (game) => {
            const gameId = game.id || `steam-${game.appId}`;
            const [details, storeDetails] = await Promise.all([
              loadGameAchievementDetailsCached(gameId).catch(() => null),
              loadGameStoreDetailsCached(gameId).catch(() => null),
            ]);
            if (!details?.achievementList?.length && !storeDetails) {
              localAchievementRequestedAppIdsRef.current.delete(game.appId);
              const retryAfter = details?.achievementMetadata?.retryAfter ?? 0;
              localAchievementHydrationFailedUntilRef.current.set(
                game.appId,
                Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 30 * 60 * 1000),
              );
              return null;
            }

            const resolvedTitle = storeDetails?.title?.trim();
            const title =
              resolvedTitle &&
              !isSteamTitlePlaceholder(resolvedTitle, game.appId)
                ? resolvedTitle
                : game.title;
            const enrichedGame = storeDetails
              ? mergeGameCardData(game, storeDetails)
              : game;
            const achievementGame = details?.achievementList?.length
              ? mergeAchievementDetailsIntoGame(enrichedGame, details)
              : enrichedGame;

            return {
              ...achievementGame,
              title,
            };
          })
        );
        if (cancelled) return;

        for (const game of hydratedGames) {
          if (!game) continue;
          pendingHydratedGames.set(game.appId, game);
          if (!isSteamTitlePlaceholder(game.title, game.appId)) {
            pendingResolvedTitles.set(game.appId, game.title);
          }
        }

        const batchNumber = Math.floor(index / localAchievementHydrationBatchSize) + 1;
        const isLastBatch =
          index + localAchievementHydrationBatchSize >= candidates.length;
        // Flush the first batch on its own so the top cards paint immediately,
        // then every 4th to keep the remaining re-renders down.
        if (batchNumber === 1 || batchNumber % 4 === 0 || isLastBatch) {
          flushPendingResults();
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const game of candidates) {
        if (!localAchievementCompletedAppIdsRef.current.has(game.appId)) {
          localAchievementRequestedAppIdsRef.current.delete(game.appId);
        }
      }
    };
  }, [
    achievementHistoryGames,
    addedLibraryGames,
    shouldComputeOverviewData,
    steamOwnedProfileGames,
    steamAccountStats,
  ]);

  useEffect(() => {
    if (
      profileCollections.some(
        (collection) => collection.id === activeCollectionId
      ) || userCollectionById.has(activeCollectionId)
    )
      return;
    setActiveCollectionId("overview");
  }, [activeCollectionId, profileCollections, userCollectionById]);

  const getGamesForCollection = useCallback(
    (collectionId: string): GhostBoxGame[] => {
      if (collectionId === "overview") return enrichedAddedLibraryGames.slice(0, 12);
      if (collectionId === "library") return enrichedAddedLibraryGames.slice(0, 12);
      if (collectionId === "favorites") return enrichedFavoriteGames.slice(0, 12);
      if (collectionId === "achievements") return profileAchievementGames.slice(0, 12);
      const collection = userCollectionById.get(collectionId);
      if (!collection) return [];
      const games: GhostBoxGame[] = [];
      for (const gameId of collection.gameIds) {
        const game = gamesById.get(gameId);
        if (game) games.push(game);
        if (games.length >= 12) break;
      }
      return games;
    },
    [
      enrichedAddedLibraryGames,
      enrichedFavoriteGames,
      gamesById,
      profileAchievementGames,
      userCollectionById,
    ]
  );

  const handleCollectionTabHover = useCallback(
    (collectionId: string) => {
      const games = getGamesForCollection(collectionId);
      if (!games.length) return;
      preloadGameListAssets(games, {
        variant: collectionId === "overview" ? "header" : "portrait",
        limit: 12,
        idle: false,
        nativeResolve: false,
        roundRobin: collectionId === "overview",
        steamHeaderFirst: collectionId === "overview",
      });
    },
    [getGamesForCollection]
  );

  const handleTabClick = useCallback(
    (collectionId: string) => {
      setActiveCollectionId(collectionId);
    },
    [setActiveCollectionId]
  );

  const visibleGames = useMemo(() => {
    const seen = new Set<string>();

    if (activeCollection.id === "overview" || activeCollection.id === "achievements") return [];

    if (activeCollection.id === "library") {
      const result: GhostBoxGame[] = [];
      for (const game of enrichedAddedLibraryGames) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);
        result.push(game);
      }
      return result;
    }
    if (activeCollection.id === "favorites") {
      const result: GhostBoxGame[] = [];
      for (const game of enrichedFavoriteGames) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);
        result.push(game);
      }
      return result;
    }

    const collection = userCollectionById.get(activeCollection.id);
    if (!collection) return [];

    const result: GhostBoxGame[] = [];

    for (const gameId of collection.gameIds) {
      const game = gamesById.get(gameId);

      if (game && !seen.has(game.id)) {
        seen.add(game.id);
        result.push(game);
      }
    }

    return result;
  }, [
    activeCollection.id,
    enrichedAddedLibraryGames,
    enrichedFavoriteGames,
    gamesById,
    userCollectionById,
  ]);

  useEffect(() => {
    return () => {
      if (steamIdCopiedTimeoutRef.current) {
        clearTimeout(steamIdCopiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopySteamId = useCallback(() => {
    if (!steamProfile?.steamId) return;
    void navigator.clipboard
      .writeText(steamProfile.steamId)
      .then(() => {
        setIsSteamIdCopied(true);
        if (steamIdCopiedTimeoutRef.current) {
          clearTimeout(steamIdCopiedTimeoutRef.current);
        }
        steamIdCopiedTimeoutRef.current = setTimeout(() => {
          setIsSteamIdCopied(false);
        }, 1800);
      })
      .catch(() => {});
  }, [steamProfile?.steamId]);

  const achievementTabGames = useMemo(() => {
    return profileAchievementGames
      .map((game) => ({
        game,
        unlocked: getUnlockedAchievementCount(game),
        total: getAchievementTotal(game),
      }))
      .sort((left, right) => {
        const unlockedDelta = right.unlocked - left.unlocked;
        if (unlockedDelta !== 0) return unlockedDelta;

        const totalDelta = right.total - left.total;
        if (totalDelta !== 0) return totalDelta;

        return left.game.title.localeCompare(right.game.title);
      })
      .map(({ game }) => game);
  }, [profileAchievementGames]);

  const achievementTabTotalPages = Math.max(
    1,
    Math.ceil(achievementTabGames.length / profileAchievementPageSize),
  );
  const currentAchievementTabPage = Math.min(
    achievementTabPage,
    achievementTabTotalPages,
  );
  const pagedAchievementTabGames = useMemo(() => {
    const startIndex = (currentAchievementTabPage - 1) * profileAchievementPageSize;
    return achievementTabGames.slice(
      startIndex,
      startIndex + profileAchievementPageSize,
    );
  }, [achievementTabGames, currentAchievementTabPage]);

  useEffect(() => {
    setAchievementTabPage(1);
  }, [achievementTabGames]);

  useEffect(() => {
    if (achievementTabPage > achievementTabTotalPages) {
      setAchievementTabPage(achievementTabTotalPages);
    }
  }, [achievementTabPage, achievementTabTotalPages]);

  const recentActivityGames = useMemo(
    () => sortOverviewGames(profileAchievementGames, overviewSortBy, appearance.language),
    [appearance.language, overviewSortBy, profileAchievementGames],
  );

  const steamOverviewMetrics = useMemo(() => {
    if (steamAccountStats) {
      return {
        games: steamAccountStats.gamesCount,
        achievements: steamAccountStats.unlockedAchievements,
        completion: Math.round(steamAccountStats.averageProgress),
        playtime: steamAccountStats.totalPlaytimeMinutes * 60_000,
      };
    }

    let achievements = 0;
    let completionTotal = 0;
    let gamesWithAchievements = 0;
    let playtime = 0;
    for (const game of profileAchievementGames) {
      const total = getAchievementTotal(game);
      const unlocked = getUnlockedAchievementCount(game);
      achievements += unlocked;
      playtime += getGamePlaytime(game);
      if (total <= 0) continue;
      completionTotal += (unlocked / total) * 100;
      gamesWithAchievements += 1;
    }

    return {
      games: profileAchievementGames.length,
      achievements,
      completion: gamesWithAchievements > 0
        ? Math.round(completionTotal / gamesWithAchievements)
        : 0,
      playtime,
    };
  }, [profileAchievementGames, steamAccountStats]);

  const steamMetricNumberFormatter = useMemo(
    () => new Intl.NumberFormat(appearance.language === "en" ? "en-US" : "pt-BR"),
    [appearance.language],
  );

  useEffect(() => {
    writeStoredOverviewSortBy(overviewSortBy);
  }, [overviewSortBy]);

  useEffect(() => {
    setRecentActivityPage(1);
  }, [overviewSortBy]);

  useEffect(() => {
    if (!overviewSortDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        overviewSortDropdownRef.current &&
        !overviewSortDropdownRef.current.contains(event.target as Node)
      ) {
        setOverviewSortDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverviewSortDropdownOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [overviewSortDropdownOpen]);
  const recentActivityTotalPages = Math.max(
    1,
    Math.ceil(recentActivityGames.length / recentActivityPageSize),
  );
  const currentRecentActivityPage = Math.min(
    recentActivityPage,
    recentActivityTotalPages,
  );
  const pagedRecentActivityGames = useMemo(() => {
    const startIndex = (currentRecentActivityPage - 1) * recentActivityPageSize;
    return recentActivityGames.slice(
      startIndex,
      startIndex + recentActivityPageSize,
    );
  }, [currentRecentActivityPage, recentActivityGames]);
  const nextRecentActivityGames = useMemo(() => {
    const startIndex = currentRecentActivityPage * recentActivityPageSize;
    return recentActivityGames.slice(
      startIndex,
      startIndex + recentActivityPageSize,
    );
  }, [currentRecentActivityPage, recentActivityGames]);

  useEffect(() => {
    if (recentActivityPage > recentActivityTotalPages) {
      setRecentActivityPage(recentActivityTotalPages);
    }
  }, [recentActivityPage, recentActivityTotalPages]);

  useEffect(() => {
    if (
      !isOverviewActive ||
      !isOverviewDataReady ||
      pagedRecentActivityGames.length === 0
    ) {
      return;
    }

    preloadGameListAssets(pagedRecentActivityGames, {
      variant: "header",
      limit: pagedRecentActivityGames.length,
      sourceLimit: 4,
      idle: false,
      decode: true,
      nativeResolve: false,
      roundRobin: true,
      steamHeaderFirst: true,
    });

    if (nextRecentActivityGames.length > 0) {
      preloadGameListAssets(nextRecentActivityGames, {
        variant: "header",
        limit: nextRecentActivityGames.length,
        sourceLimit: 2,
        idle: true,
        nativeResolve: false,
        roundRobin: true,
        steamHeaderFirst: true,
      });
    }
  }, [
    isOverviewActive,
    isOverviewDataReady,
    nextRecentActivityGames,
    pagedRecentActivityGames,
  ]);

  useEffect(() => {
    // Resolve real store titles for overview top games and the achievements
    // tab — history/local appcache entries often arrive as "STEAM APP 123456".
    const gamesToResolve = profileAchievementGames.filter(
      (game) =>
        game.appId &&
        isSteamTitlePlaceholder(game.title, game.appId) &&
        !resolvedGameTitleAppIdsRef.current.has(game.appId)
    );
    if (gamesToResolve.length === 0) return;

    for (const game of gamesToResolve) {
      resolvedGameTitleAppIdsRef.current.add(game.appId);
    }

    let cancelled = false;

    void Promise.all(
      gamesToResolve.map(async (game) => {
        const details = await loadGameStoreDetailsCached(
          game.id || `steam-${game.appId}`
        ).catch(() => null);
        const title = details?.title?.trim();
        if (!title || isSteamTitlePlaceholder(title, game.appId)) {
          return { appId: game.appId, title: null };
        }
        return { appId: game.appId, title };
      })
    ).then((resolvedTitles) => {
      if (cancelled) return;

      for (const resolvedTitle of resolvedTitles) {
        if (!resolvedTitle.title) {
          resolvedGameTitleAppIdsRef.current.delete(resolvedTitle.appId);
          continue;
        }
        resolvedGameTitleCompletedAppIdsRef.current.add(resolvedTitle.appId);
      }

      setResolvedGameTitlesByAppId((current) => {
        let changed = false;
        const next = new Map(current);
        for (const resolvedTitle of resolvedTitles) {
          if (!resolvedTitle.title || next.has(resolvedTitle.appId)) continue;
          next.set(resolvedTitle.appId, resolvedTitle.title);
          changed = true;
        }
        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
      for (const game of gamesToResolve) {
        if (!resolvedGameTitleCompletedAppIdsRef.current.has(game.appId)) {
          resolvedGameTitleAppIdsRef.current.delete(game.appId);
        }
      }
    };
  }, [profileAchievementGames]);

  const profileActivityViewModels = useMemo<ProfileActivityViewModel[]>(
    () =>
      pagedRecentActivityGames.map((game) => {
        const resolvedTitle = resolvedGameTitlesByAppId.get(game.appId);
        const displayGame = resolvedTitle
          ? { ...game, title: resolvedTitle }
          : game;
        const achievementTotal = getAchievementTotal(game);
        const achievementUnlocked = getUnlockedAchievementCount(game);
        const achievementProgress =
          achievementTotal > 0
            ? (achievementUnlocked / achievementTotal) * 100
            : 0;
        const latestAchievements = (game.achievementList ?? [])
          .filter(isAchievementUnlocked)
          .slice()
          .sort((left, right) => {
            const unlockTimeDelta =
              achievementUnlockedTime(right.unlockedAt) -
              achievementUnlockedTime(left.unlockedAt);
            if (unlockTimeDelta !== 0) return unlockTimeDelta;
            return (
              (right.globalPercent ?? 100) -
              (left.globalPercent ?? 100)
            );
          })
          .flatMap<ProfileAchievementHighlight>((achievement) => {
            const icon = achievementShowcaseIcon(achievement, true);
            if (!icon) return [];
            return [
              {
                key: achievementShowcaseKey(game, achievement),
                game: displayGame,
                achievementId: achievement.name || achievement.title,
                title: achievement.title,
                description: achievement.description,
                icon,
                unlocked: true,
                gameTitle: displayGame.title,
                globalPercent: achievement.globalPercent,
                unlockedAt: achievement.unlockedAt,
              },
            ];
          })
          .slice(0, 5);
        const overflowCount = Math.max(
          0,
          achievementUnlocked - latestAchievements.length,
        );
        const statusLabel = game.sessionActive
          ? t("profile.currentlyInGame")
          : Number.isFinite(parseLastPlayed(game.lastTimePlayed))
            ? `${t("profile.lastPlayed")} ${formatProfileLastSession(
                game.lastTimePlayed,
                appearance.language,
              )}`
            : null;

        return {
          game,
          displayGame,
          displayTitle: getProfileGameTitle(
            game,
            appearance.language,
            resolvedTitle,
          ),
          achievementTotal,
          achievementUnlocked,
          achievementProgress,
          latestAchievements,
          overflowCount,
          statusLabel,
        };
      }),
    [
      appearance.language,
      pagedRecentActivityGames,
      resolvedGameTitlesByAppId,
      t,
    ],
  );

  const profileImageKey = `${steamProfile?.avatarUrl ?? ""}\n${steamProfile?.bannerUrl ?? ""}`;
  const avatarSources = useCachedImageSources(
    steamProfile?.avatarUrl ? [steamProfile.avatarUrl] : []
  );
  const shouldUseBannerCache = !steamProfile?.bannerUrl?.startsWith("data:");
  const bannerUrl = steamProfile?.bannerUrl ?? "";
  const bannerSources = useCachedImageSources(
    shouldUseBannerCache && bannerUrl
      ? [bannerUrl]
      : shouldUseBannerCache
        ? [profileBannerPlaceholderSource]
        : []
  );
  const avatarSource = steamProfile?.avatarUrl?.startsWith("data:")
    ? steamProfile.avatarUrl
    : avatarSources[0] ?? steamProfile?.avatarUrl ?? "";
  const shouldHoldSteamAvatar = Boolean(
    isCloudProfileRestoring &&
      steamProfile?.avatarUrl &&
      !steamProfile.avatarUrl.startsWith("data:") &&
      !steamProfile.avatarUrl.includes("/storage/v1/object/public/profile-images/")
  );
  const cachedBannerSource = shouldUseBannerCache && bannerUrl
    ? bannerSources.find((source) => source !== bannerUrl)
    : "";
  const bannerImageSource = !shouldUseBannerCache && bannerUrl
    ? bannerUrl
    : cachedBannerSource || bannerUrl || bannerSources[0] || profileBannerPlaceholderSource;
  const isBannerPlaceholder = !steamProfile?.bannerUrl;

  useEffect(() => {
    preloadProfileImages(steamProfile);
  }, [profileImageKey]);

  useEffect(() => {
    const steamId = steamProfile?.steamId?.trim();
    if (!steamId) {
      setDiscordLink(null);
      return;
    }
    let cancelled = false;
    const cached = ghostboxApi.getCachedDiscordLinkStatus(steamId);
    if (cached) setDiscordLink(cached);
    ghostboxApi.getDiscordLinkStatus(steamId).then((status) => {
      if (!cancelled) setDiscordLink(status);
    });
    return () => { cancelled = true; };
  }, [steamProfile?.steamId]);

  useEffect(() => {
    const steamId = steamProfile?.steamId?.trim();
    if (!steamId) {
      setSteamLevel(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const level = await ghostboxApi.getSteamPlayerLevel(steamId);
        if (
          !cancelled &&
          typeof level === "number" &&
          Number.isFinite(level) &&
          level >= 0
        ) {
          setSteamLevel(Math.floor(level));
        }
      } catch {
        if (!cancelled) setSteamLevel(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [steamProfile?.steamId]);

  useEffect(() => {
    preloadGameListAssets(visibleGames, {
      variant: "portrait",
      limit: 8,
      idle: false,
    });
  }, [visibleGames]);

  useEffect(() => {
    setRenderedGameCount(Math.min(24, visibleGames.length));
  }, [visibleGames]);

  useEffect(() => {
    const sentinel = loadMoreGamesRef.current;
    if (!sentinel || renderedGameCount >= visibleGames.length) return;
    if (typeof IntersectionObserver === "undefined") {
      setRenderedGameCount((current) =>
        Math.min(current + 16, visibleGames.length),
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRenderedGameCount((current) => {
          if (current >= visibleGames.length) return current;
          return Math.min(current + 16, visibleGames.length);
        });
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [renderedGameCount, visibleGames.length]);

  const baseRenderedGames = useMemo(
    () => visibleGames.slice(0, renderedGameCount),
    [renderedGameCount, visibleGames],
  );
  const renderedGames = useEnrichedGameCards(baseRenderedGames);

  const contextMenuItems = useCollectionContextMenu({
    game: gameContextMenu?.game ?? null,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onOpenGame,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onToggleFavorite,
    directFavoriteAction: true,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  });

  const handleGameContextMenu = useCallback(
    (game: GhostBoxGame, x: number, y: number) =>
      setGameContextMenu({ game, x, y }),
    []
  );
  const bannerPosition = normalizeBannerPosition(steamProfile?.bannerPosition);
  const bannerImageStyle: CSSProperties | undefined = isBannerPlaceholder
    ? undefined
    : {
        objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
        transform: `scale(${bannerPosition.scale ?? 1})`,
      };

  if (!steamProfile) return null;

  return (
    <section className="profile-page">
      <header
        className={`profile-page__content-box${bannerImageSource ? "" : " profile-page__content-box--empty"}${isBannerPlaceholder ? " profile-page__content-box--placeholder" : " profile-page__content-box--cover"}`}
      >
        {bannerImageSource && (
          <div
            className="profile-page__banner-viewport"
          >
            <img
              className={`profile-page__banner-image${isBannerPlaceholder ? " profile-page__banner-image--placeholder" : ""}`}
              src={bannerImageSource}
              alt=""
              decoding="async"
              loading="eager"
              fetchPriority="high"
              style={bannerImageStyle}
            />
          </div>
        )}
        <div className="profile-page__background-overlay">
          <button
            type="button"
            className="profile-page__hero-action profile-page__hero-action--banner"
            onClick={() => setIsCoverModalOpen(true)}
            aria-label={t("profile.changeBanner")}
          >
            <Camera size={16} strokeWidth={2.25} aria-hidden="true" />
            <span className="profile-page__hero-action-label">
              {t("profile.changeBanner")}
            </span>
          </button>
          <div className="profile-page__identity">
            <div className="profile-page__avatar-button">
              {shouldHoldSteamAvatar ? (
                <span className="profile-page__avatar-skeleton" />
              ) : avatarSource ? (
                <img
                  src={avatarSource}
                  alt={steamProfile.displayName}
                  width={120}
                  height={120}
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <ShieldUser size={44} />
              )}
            </div>

            <div className="profile-page__identity-content">
              <div className="profile-page__display-name-row">
                <h2 className="profile-page__display-name">
                  {steamProfile.displayName}
                </h2>
                <span
                  className="profile-page__level"
                  title={
                    steamLevel === null
                      ? appearance.language === "en"
                        ? "Steam level unavailable"
                        : "Nível Steam indisponível"
                      : appearance.language === "en"
                        ? `Level ${steamLevel}`
                        : `Nível ${steamLevel}`
                  }
                  aria-label={
                    steamLevel === null
                      ? appearance.language === "en"
                        ? "Steam level unavailable"
                        : "Nível Steam indisponível"
                      : appearance.language === "en"
                        ? `Level ${steamLevel}`
                        : `Nível ${steamLevel}`
                  }
                >
                  <span className="profile-page__level-value">
                    {steamLevel ?? ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="profile-page__hero-action"
                  onClick={() => setIsEditModalOpen(true)}
                  aria-label={t("profile.editProfile")}
                >
                  <Pencil size={14} strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
              <div className="profile-page__steam-id-row">
                <div className="profile-page__steam-id-box">
                  <img src={steamIcon} alt="" className="profile-page__steam-id-icon" aria-hidden="true" />
                  <span
                    className={`profile-page__steam-id${
                      isSteamIdVisible
                        ? " profile-page__steam-id--revealed"
                        : " profile-page__steam-id--hidden"
                    }`}
                    key={isSteamIdVisible ? "visible" : "masked"}
                  >
                    {isSteamIdVisible ? steamProfile.steamId : "•••••••••"}
                  </span>
                  <button
                    type="button"
                    className="profile-page__steam-id-toggle"
                    onClick={() => setIsSteamIdVisible((v) => !v)}
                    aria-label={isSteamIdVisible ? t("profile.hideSteamId") : t("profile.showSteamId")}
                  >
                    {isSteamIdVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  {isSteamIdVisible && (
                    <button
                      type="button"
                      className={`profile-page__steam-id-toggle profile-page__steam-id-copy${
                        isSteamIdCopied ? " profile-page__steam-id-copy--copied" : ""
                      }`}
                      onClick={handleCopySteamId}
                      aria-label={isSteamIdCopied ? t("profile.steamIdCopied") : t("profile.copySteamId")}
                    >
                      <span className="profile-page__steam-id-copy-icon profile-page__steam-id-copy-icon--copy">
                        <Copy size={14} />
                      </span>
                      <span className="profile-page__steam-id-copy-icon profile-page__steam-id-copy-icon--check">
                        <Check size={14} />
                      </span>
                    </button>
                  )}
                </div>
                {discordLink?.linked && (
                  <div className="profile-page__discord-box">
                    <svg role="img" viewBox="0 -28.5 256 256" className="profile-page__discord-icon" aria-hidden="true">
                      <path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"/>
                    </svg>
                    <span className="profile-page__discord-id">
                      {discordLink.discordUsername}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="profile-page__content-section">
        <main className="profile-page__main">
          <>
            <div
              className="profile-page__tabs"
              aria-label={t("sidebar.collections")}
            >
              <div className="profile-page__collection-tabs">
                {profileCollections.map((collection) => {
                  const TabIcon =
                    collection.id === "overview"
                      ? User
                      : collection.id === "library"
                        ? Layers
                        : collection.id === "achievements"
                          ? Cup
                          : Folder;

                  return (
                    <button
                      key={collection.id}
                      data-tab-id={collection.id}
                      type="button"
                      aria-label={collection.name}
                      className={`profile-page__tab ${
                        activeTabId === collection.id
                          ? "profile-page__tab--active"
                          : ""
                      }`}
                      onClick={() => handleTabClick(collection.id)}
                      onMouseEnter={() =>
                        handleCollectionTabHover(collection.id)
                      }
                      onFocus={() => handleCollectionTabHover(collection.id)}
                    >
                      {collection.id === "achievements" ? (
                        <Cup
                          size={18}
                          weight="Filled"
                          strokeWidth={2.0}
                          aria-hidden="true"
                        />
                      ) : (
                        <TabIcon
                          size={18}
                          strokeWidth={2.0}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className="profile-page__tab-selector"
                        aria-hidden="true"
                      />
                      <span className="profile-page__tab-label">
                        {collection.name}
                      </span>

                    </button>
                  );
                })}
              </div>
              {onSignOut ? (
                <button
                  type="button"
                  className="profile-page__sign-out"
                  onClick={onSignOut}
                  aria-label={
                    appearance.language === "en"
                      ? "Sign out of Steam"
                      : "Sair da conta Steam"
                  }
                  title={appearance.language === "en" ? "Sign out" : "Sair"}
                >
                  <LogOut size={16} strokeWidth={2.15} aria-hidden="true" />
                </button>
              ) : null}
            </div>

          <div className="profile-page__collection-content">
            <div className="profile-page__tab-panel">
            {isOverviewActive ? (
              <div
                className="profile-page__overview"
                aria-label={t("profile.overview")}
              >
                <section className="profile-page__overview-console">
                  <div className="profile-page__activity-console">
                    {profileAchievementGames.length > 0 ? (
                      <>
                      <div
                        className="profile-page__activity-toolbar"
                        aria-label={t("profile.sortAria")}
                      >
                        <div
                          className="profile-page__activity-metrics"
                          aria-label={t("profile.steamMetrics")}
                        >
                          <span className="profile-page__activity-metric">
                            <strong>{steamMetricNumberFormatter.format(steamOverviewMetrics.games)}</strong>
                            <span>{t("profile.libraryGames")}</span>
                          </span>
                          <span className="profile-page__activity-metric">
                            <strong>{steamMetricNumberFormatter.format(steamOverviewMetrics.achievements)}</strong>
                            <span>{t("profile.unlockedAchievements")}</span>
                          </span>
                          <span className="profile-page__activity-metric">
                            <strong>{steamOverviewMetrics.completion}%</strong>
                            <span>{t("profile.completionPerGame")}</span>
                          </span>
                          <span className="profile-page__activity-metric">
                            <strong>{formatCompactPlaytime(steamOverviewMetrics.playtime)}</strong>
                            <span>{t("profile.totalPlaytimeLabel")}</span>
                          </span>
                        </div>
                        <div
                          className={`settings-dropdown profile-page__activity-sort ${
                            overviewSortDropdownOpen ? "settings-dropdown--open" : ""
                          }`}
                          ref={overviewSortDropdownRef}
                        >
                          <button
                            type="button"
                            className="settings-dropdown__trigger"
                            aria-haspopup="listbox"
                            aria-expanded={overviewSortDropdownOpen}
                            onClick={() =>
                              setOverviewSortDropdownOpen((current) => !current)
                            }
                          >
                            <span>{t(`profile.sort.${overviewSortBy}`)}</span>
                            <ChevronLeft size={14} />
                          </button>
                          {overviewSortDropdownOpen ? (
                            <div
                              className="settings-dropdown__menu"
                              role="listbox"
                              aria-label={t("profile.sortAria")}
                            >
                              {overviewSortOptions
                                .filter((option) => option !== overviewSortBy)
                                .map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    className="settings-dropdown__option"
                                    onClick={() => {
                                      setOverviewSortBy(option);
                                      setOverviewSortDropdownOpen(false);
                                    }}
                                  >
                                    <span>{t(`profile.sort.${option}`)}</span>
                                  </button>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="profile-page__activity-list">
                        {recentActivityGames.length > 0 ? profileActivityViewModels.map((viewModel) => (
                            <ProfileActivityCard
                              key={viewModel.game.id}
                              game={viewModel.game}
                              displayGame={viewModel.displayGame}
                              displayTitle={viewModel.displayTitle}
                              achievementTotal={viewModel.achievementTotal}
                              achievementUnlocked={viewModel.achievementUnlocked}
                              achievementProgress={viewModel.achievementProgress}
                              latestAchievements={viewModel.latestAchievements}
                              overflowCount={viewModel.overflowCount}
                              statusLabel={viewModel.statusLabel}
                              t={t}
                              onOpenGame={onOpenGame}
                            />
                        )) : (
                          <EmptyState
                            className="profile-page__no-games"
                            title={t("profile.noPerfectGames")}
                          />
                        )}
                      </div>
                      {recentActivityTotalPages > 1 ? (
                        <div className="profile-page__activity-pagination">
                          <PaginationControls
                            page={currentRecentActivityPage}
                            totalPages={recentActivityTotalPages}
                            onPageChange={handleRecentActivityPageChange}
                          />
                        </div>
                      ) : null}
                      </>
                    ) : !isOverviewDataReady ? (
                      <div
                        className="profile-page__activity-list profile-page__activity-list--skeleton"
                        aria-hidden="true"
                      >
                        {[0, 1, 2].map((index) => (
                          <div
                            key={index}
                            className="profile-page__activity-card profile-page__activity-card--skeleton"
                          >
                            <span className="profile-page__activity-cover-button" aria-hidden="true">
                              <span className="profile-page__activity-game-cover profile-page__skeleton-block" />
                            </span>
                            <span className="profile-page__activity-main" aria-hidden="true">
                              <span className="profile-page__activity-meta">
                                <span className="profile-page__skeleton-line profile-page__skeleton-line--title" />
                              </span>
                              <span className="profile-page__activity-side">
                                <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : isAchievementsActive ? (
              achievementTabGames.length > 0 ? (
                <div
                  className="profile-page__achievement-games"
                  aria-label={t("achievements.title")}
                >
                  {pagedAchievementTabGames.map((game) => {
                    const achievementTotal = getAchievementTotal(game);
                    const achievementUnlocked = getUnlockedAchievementCount(game);
                    const achievementProgress = achievementTotal > 0
                      ? Math.round((achievementUnlocked / achievementTotal) * 100)
                      : 0;
                    const sortedAchievements = (game.achievementList ?? [])
                      .filter((achievement) => achievement.icon || achievement.iconGray)
                      .slice()
                      .sort((left, right) => {
                        const unlockedDelta = Number(isAchievementUnlocked(right)) -
                          Number(isAchievementUnlocked(left));
                        if (unlockedDelta !== 0) return unlockedDelta;
                        const unlockTimeDelta =
                          achievementUnlockedTime(right.unlockedAt) -
                          achievementUnlockedTime(left.unlockedAt);
                        if (unlockTimeDelta !== 0) return unlockTimeDelta;
                        return (left.title || left.name).localeCompare(
                          right.title || right.name
                        );
                      });
                    const isExpanded = expandedAchievementGameIds.has(game.id);
                    const visibleAchievements = isExpanded
                      ? sortedAchievements
                      : sortedAchievements.slice(0, 4);
                    const hasMoreAchievements = sortedAchievements.length > 4;

                    return (
                      <section
                        key={game.id}
                        className="profile-page__achievement-game"
                      >
                        <div className="profile-page__achievement-game-title-row">
                          <h3>
                            <ProfileAchievementGameIcon game={game} />
                            <span>{game.title}</span>
                          </h3>
                          <div className="profile-page__achievement-game-actions">
                            <button
                              type="button"
                              className="profile-page__achievement-game-progress"
                              onClick={() => onOpenGameAchievements ? onOpenGameAchievements(game) : onOpenGame(game)}
                              aria-label={
                                appearance.language === "en"
                                  ? `${game.title} achievement progress: ${achievementUnlocked} of ${achievementTotal}`
                                  : `Progresso de conquistas de ${game.title}: ${achievementUnlocked} de ${achievementTotal}`
                              }
                            >
                              <Cup
                                className="profile-page__activity-cup-icon"
                                size={14}
                                weight="Filled"
                                strokeWidth={2.0}
                                color="var(--text-primary)"
                                aria-hidden="true"
                              />
                              <span className="profile-page__achievement-game-progress-bar" aria-hidden="true">
                                <span style={{ width: `${achievementProgress}%` }} />
                              </span>
                              <strong>{achievementUnlocked}/{achievementTotal}</strong>
                            </button>
                          </div>
                        </div>

                        <ProfileAchievementCardRow>
                          {visibleAchievements.map((achievement) => {
                            const unlocked = isAchievementUnlocked(achievement);
                            const icon = achievementShowcaseIcon(achievement, unlocked);
                            const achievementId = achievement.name || achievement.title;

                            return (
                              <button
                                key={achievementId}
                                type="button"
                                className={`profile-page__achievement-card ${
                                  unlocked
                                    ? "profile-page__achievement-card--unlocked"
                                    : "profile-page__achievement-card--locked"
                                }`}
                                aria-label={`${achievement.title}, ${game.title}`}
                                onClick={() =>
                                  onOpenGameAchievements
                                    ? onOpenGameAchievements(game, achievementId)
                                    : onOpenGame(game)
                                }
                              >
                                <span className="profile-page__achievement-card-media">
                                  <img
                                    src={icon}
                                    alt=""
                                    aria-hidden="true"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </span>
                                <span className="profile-page__achievement-card-content">
                                  <span className="profile-page__achievement-card-heading">
                                    <strong>{achievement.title || achievement.name}</strong>
                                  </span>
                                  {achievement.description ? (
                                    <span className="profile-page__achievement-card-description">
                                      {achievement.description}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            );
                          })}
                        </ProfileAchievementCardRow>
                        {hasMoreAchievements ? (
                          <button
                            type="button"
                            className={`profile-page__achievement-game-toggle${
                              isExpanded ? " profile-page__achievement-game-toggle--expanded" : ""
                            }`}
                            onClick={() => toggleAchievementGameExpanded(game.id)}
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? appearance.language === "en"
                                  ? `Show fewer achievements for ${game.title}`
                                  : `Ver menos conquistas de ${game.title}`
                                : appearance.language === "en"
                                  ? `See more achievements for ${game.title}`
                                  : `Ver mais conquistas de ${game.title}`
                            }
                          >
                            <ChevronDown size={18} strokeWidth={2.15} aria-hidden="true" />
                          </button>
                        ) : null}
                      </section>
                    );
                  })}
                  {achievementTabTotalPages > 1 ? (
                    <div className="profile-page__achievement-pagination">
                      <PaginationControls
                        page={currentAchievementTabPage}
                        totalPages={achievementTabTotalPages}
                        onPageChange={handleAchievementTabPageChange}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  className="profile-page__no-games"
                  title={t("profile.noAchievements")}
                />
              )
            ) : renderedGames.length > 0 ? (
                <>
                  <GameGrid
                    games={renderedGames}
                    className="profile-page__game-grid"
                    dense
                    portrait
                    animateLayout
                    onOpenGame={onOpenGame}
                    onGameContextMenu={handleGameContextMenu}
                    showAchievements
                    activeSessionAppIds={activeSessionAppIds}
                  />
                  {renderedGameCount < visibleGames.length && (
                    <div
                      ref={loadMoreGamesRef}
                      className="profile-page__load-more-sentinel"
                      aria-hidden="true"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  className="profile-page__no-games"
                  title={
                    appearance.language === "en"
                      ? `No games in ${activeCollection.name}`
                      : `Nenhum jogo em ${activeCollection.name}`
                  }
                />
              )}
            </div>
            </div>
          </>

          {gameContextMenu && contextMenuItems.length > 0 && (
            <ContextMenu
              x={gameContextMenu.x}
              y={gameContextMenu.y}
              items={contextMenuItems}
              onClose={() => setGameContextMenu(null)}
            />
          )}
        </main>

      </div>



      <EditProfileModal
        open={isEditModalOpen}
        mode="profile"
        profile={steamProfile}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={(name, avatar, banner, position) => {
          onUpdateProfile(name, avatar, banner, position);
          setIsEditModalOpen(false);
        }}
      />

      <EditProfileModal
        open={isCoverModalOpen}
        mode="cover"
        profile={steamProfile}
        onClose={() => setIsCoverModalOpen(false)}
        onSubmit={(name, avatar, banner, position) => {
          onUpdateProfile(name, avatar, banner, position);
          setIsCoverModalOpen(false);
        }}
      />
    </section>
  );
}
