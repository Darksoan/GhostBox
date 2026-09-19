import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  memo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { Cup, CupStar } from "reicon-react";
import type { GhostBoxGame, SteamAchievement } from "../data";
import type { SteamAccountStats, SteamProfile, UserCollection } from "../types";
import { GameGrid } from "../components/ui/GameCard";
import { isSteamConnected } from "../lib/steamProfile";
import {
  ContextMenu,
} from "../components/ui/ContextMenu";
import {
  EmptyState,
  ProfileActivityListSkeleton,
} from "../components/ui/LoadingStates";
import { PaginationControls } from "../components/ui/PaginationControls";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useWindowMaximized } from "../hooks/useWindowMaximized";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { useGameIconUrl } from "../hooks/useGameIconUrl";
import steamIcon from "../../Icons/steam-colored.svg";
import avatarPlaceholder from "../../Icons/userplaceholder.jpg";
import { EditProfileTab } from "../components/profile/EditProfileTab";
import "./ProfilePage.scss";
import {
  useCachedImageSources,
  useLoadableImageCover,
  useLoadableImageSource,
  useLoadableImageState,
} from "../hooks/useCachedImageSources";
import {
  gameCatalogueHeaderSources,
  layeredImageStyle,
  preloadGameListAssets,
  preloadProfileImages,
  profileBannerPlaceholderSource,
} from "../utils/image";
import { useSettings } from "../context/settings";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { formatCompactPlaytime, parseLastPlayed } from "../utils/time";
import { mergeGameCardData } from "../utils/gameCardData";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
} from "../utils/gameCache";
import { sortOverviewGames } from "../utils/overviewSort";
import {
  handleListboxKeyDown,
  handleListboxTriggerKeyDown,
} from "../utils/listboxNavigation";
import {
  getProfileAchievementTotal as getAchievementTotal,
  getProfileUnlockedAchievementCount as getUnlockedAchievementCount,
  getRicherProfileAchievementGame as getRicherAchievementGame,
  isProfileAchievementUnlocked as isAchievementUnlocked,
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
import { applySteamAppTypes, filterOutSteamDemos } from "../utils/steamAppType";
import { useSteamAppTypes } from "../hooks/useSteamAppTypes";
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
  // Capa da atividade: header capsule estrito (460×215). Só `header.jpg` nos
  // 4 hosts da Steam entra aqui — nada de capsule_616x353, hero ou screenshot,
  // que têm proporção diferente e deformam/cortam errado no slot travado.
  const coverSources = useCachedImageSources(gameCatalogueHeaderSources(game));
  const {
    source: headerSource,
    loaded: headerLoaded,
  } = useLoadableImageCover(coverSources);

  function preloadActivityCover() {
    preloadGameListAssets([displayGame], {
      variant: "catalogueHeader",
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

  const hasAchievements = achievementTotal > 0;
  return (
    <article
      className={`profile-page__activity-card${
        isPerfect ? " profile-page__activity-card--perfect" : ""
      }`}
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
          <span
            className={`profile-page__activity-status${
              !statusLabel ? " profile-page__activity-status--placeholder" : ""
            }`}
          >
            {statusLabel ?? t("profile.neverPlayed")}
          </span>
        </span>
      </span>

      {hasAchievements ? (
        <div className="profile-page__activity-achievements">
          <span className="profile-page__activity-progress">
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
                  role="img"
                  tabIndex={0}
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
                    {typeof achievement.globalPercent === "number" ? (
                      <small>
                        {achievement.globalPercent.toFixed(1)}% {t("achievements.globalPercent")}
                      </small>
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
      ) : (
        <div className="profile-page__activity-achievements">
          <span className="profile-page__activity-progress">
            <span className="profile-page__activity-progress-label">
              <Cup
                className="profile-page__activity-cup-icon"
                size={18}
                weight="Filled"
                strokeWidth={2.0}
                color="var(--text-tertiary, var(--text-secondary))"
                aria-hidden="true"
              />
            </span>
            <span className="profile-page__activity-progress-count">
              0 {t("profile.of")} 0
            </span>
            <span
              className="profile-page__progress-track profile-page__progress-track--compact"
              aria-hidden="true"
            >
              <span style={{ width: "0%" }} />
            </span>
          </span>
        </div>
      )}
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
  isPremium: boolean;
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
  activeSessionAppIds?: Set<string>;
  onOpenGameAchievements?: (
    game: GhostBoxGame,
    achievementId?: string
  ) => void;
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
const visibleAchievementPercentBatchSize = 2;
// A game whose store page resolved but whose achievement list did not is retried
// on the next hydration pass after this window, instead of staying blank.
const localAchievementRetryDelayMs = 5 * 60 * 1000;
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
  isPremium,
  favoriteGames,
  addedLibraryGames,
  achievementHistoryGames = [],
  userCollections,
  activeCollectionId: propActiveCollectionId,
  onSelectCollection,
  onUpdateProfile,
  onOpenGame,
  activeSessionAppIds = new Set(),
  onOpenGameAchievements,
  scrollElementRef,
}: ProfilePageProps) {
  const { appearance, t } = useSettings();
  const isMaximized = useWindowMaximized();
  const { account } = useAuth();
  const { showSteamGames, cloudSaveAppIds, hiddenProfileGameIds, refreshGameAchievements } = useAppData();
  const steamConnected = isSteamConnected(steamProfile);
  const shouldShowSteamContent = steamConnected && showSteamGames;
  const [internalActiveCollectionId, setInternalActiveCollectionId] =
    useState("overview");
  const [renderedGameCount, setRenderedGameCount] = useState(40);
  const [expandedAchievementGameIds, setExpandedAchievementGameIds] = useState<Set<string>>(
    () => new Set()
  );
  const [localAchievementGamesByAppId, setLocalAchievementGamesByAppId] =
    useState<Map<string, GhostBoxGame>>(() => new Map());
  const [achievementHydrationAttempt, setAchievementHydrationAttempt] =
    useState(0);
  const localAchievementRequestedAppIdsRef = useRef(new Set<string>());
  const localAchievementCompletedAppIdsRef = useRef(new Set<string>());
  const achievementPercentRequestedAppIdsRef = useRef(new Set<string>());
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
  const achievementGamesRef = useRef<HTMLDivElement | null>(null);
  const [isSteamIdVisible, setIsSteamIdVisible] = useState(false);
  const [isSteamIdCopied, setIsSteamIdCopied] = useState(false);
  const steamIdCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [discordLink, setDiscordLink] = useState<DiscordLinkStatus | null>(() =>
    ghostboxApi.getCachedDiscordLinkStatus(),
  );
  const [steamLevel, setSteamLevel] = useState<number | null>(null);
  // Avatar e capa vivem em URLs remotas (nuvem). Um erro de rede pontual não
  // pode deixá-las quebradas até a próxima navegação: mexer neste token refaz
  // a cadeia de carregamento com as mesmas URLs.
  const [imageRetryToken, setImageRetryToken] = useState(0);
  const bannerRetryCountRef = useRef(0);
  const lastPaintedBannerSourceRef = useRef("");

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
      achievementGamesRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    []
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
    // Geral do perfil espelha a Biblioteca global (Todos:
    // Steam owned + GhostBox), então a contagem usa a mesma união por appId.
    const uniqueAppIds = new Set<string>();
    for (const game of addedLibraryGames) {
      uniqueAppIds.add(game.appId || game.id);
    }
    if (shouldShowSteamContent) {
      for (const entry of steamAccountStats?.ownedPlaytimes ?? []) {
        const appId = entry.appId.trim();
        if (appId) uniqueAppIds.add(appId);
      }
    }
    const libraryUniqueCount = uniqueAppIds.size;
    return [
      {
        id: "overview",
        name: t("profile.overview"),
        count: libraryUniqueCount,
      },
      {
        id: "achievements",
        name: t("achievements.title"),
        count: 0,
      },
      {
        id: "editProfile",
        name: t("profile.editProfile"),
        count: 0,
      },
    ];
  }, [addedLibraryGames, shouldShowSteamContent, steamAccountStats?.ownedPlaytimes, t]);

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
  const isOverviewActive = activeCollection.id === "overview";
  const isAchievementsActive = activeCollection.id === "achievements";
  const isEditProfileActive = activeCollection.id === "editProfile";
  const shouldBuildCollectionGameData = !isOverviewActive && !isEditProfileActive;
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
      shouldComputeOverviewData && shouldShowSteamContent
        ? buildSteamAchievementIndex(steamAccountStats)
        : new Map(),
    [shouldComputeOverviewData, shouldShowSteamContent, steamAccountStats],
  );

  // Perfil espelha a Biblioteca global: todo owned Steam aparece (menos demos
  // confirmadas). O filtro permissivo evita esvaziar a lista quando a
  // classificação de appType atrasa/falha — mesmo comportamento da sidebar.
  const rawSteamOwnedProfileGames = useMemo(
    () => buildSteamOwnedGamesFromPlaytimes(steamAccountStats?.ownedPlaytimes ?? [], {}),
    [steamAccountStats?.ownedPlaytimes],
  );
  const shouldLoadSteamOwnedProfileGames =
    shouldShowSteamContent &&
    (shouldComputeOverviewData || shouldBuildCollectionGameData);
  const profileSteamAppTypes = useSteamAppTypes(
    rawSteamOwnedProfileGames,
    shouldLoadSteamOwnedProfileGames,
  );
  const steamOwnedProfileGames = useMemo(() => {
    if (!shouldLoadSteamOwnedProfileGames) return [];
    const visible = filterOutSteamDemos(
      applySteamAppTypes(rawSteamOwnedProfileGames, profileSteamAppTypes),
    );
    return mergeSteamAchievementsIntoGames(
      visible,
      steamAccountStats,
      steamAchievementIndex,
    );
  }, [
    profileSteamAppTypes,
    rawSteamOwnedProfileGames,
    shouldLoadSteamOwnedProfileGames,
    steamAccountStats,
    steamAchievementIndex,
  ]);

  const profileGameBase = useMemo(() => {
    if (!shouldComputeOverviewData) return [];

    const games = new Map<string, GhostBoxGame>();
    const addGame = (game: GhostBoxGame) => {
      if (hiddenProfileGameIds.has(game.appId)) return;
      games.set(
        game.appId,
        getRicherAchievementGame(games.get(game.appId), game),
      );
    };

    // With Steam hidden the profile only speaks for the GhostBox account, so
    // the local play history (appcache scan) is narrowed to the games the
    // account actually owns in the cloud — everything else is machine-local
    // noise that was never in the user's cloud database.
    for (const game of achievementHistoryGames) {
      if (!shouldShowSteamContent && !cloudSaveAppIds.has(game.appId)) continue;
      addGame(game);
    }
    for (const game of addedLibraryGames) addGame(game);
    for (const game of favoriteGames) addGame(game);
    for (const game of steamOwnedProfileGames) addGame(game);

    return [...games.values()];
  }, [
    achievementHistoryGames,
    addedLibraryGames,
    cloudSaveAppIds,
    favoriteGames,
    hiddenProfileGameIds,
    shouldComputeOverviewData,
    shouldShowSteamContent,
    steamOwnedProfileGames,
  ]);

  const overviewPreloadGames = useMemo(() => {
    // Geral lista todo owned (igual à Biblioteca): sem filtro de
    // reconhecimento por playtime/conquistas ou software.
    return [...profileGameBase].sort((left, right) => {
      const lastPlayedDelta =
        parseLastPlayed(right.lastTimePlayed) -
        parseLastPlayed(left.lastTimePlayed);
      if (lastPlayedDelta !== 0) return lastPlayedDelta;
      return getGamePlaytime(right) - getGamePlaytime(left);
    });
  }, [profileGameBase]);

  useEffect(() => {
    if (!isOverviewActive || overviewPreloadGames.length === 0) return;

    preloadGameListAssets(overviewPreloadGames, {
      variant: "catalogueHeader",
      limit: recentActivityPageSize,
      sourceLimit: 4,
      idle: false,
      decode: true,
      nativeResolve: false,
      roundRobin: true,
    });
  }, [isOverviewActive, overviewPreloadGames]);

  const enrichedGameByAppId = useMemo(() => {
    const map = new Map<string, GhostBoxGame>();
    if (!shouldBuildCollectionGameData) return map;

    const addGame = (game: GhostBoxGame) => {
      const current = map.get(game.appId);
      map.set(game.appId, current ? mergeGameCardData(current, game) : game);
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
        return details ? mergeGameCardData(game, details) : game;
      });
    },
    [enrichedGameByAppId, favoriteGames, shouldBuildCollectionGameData]
  );

  const enrichedAddedLibraryGames = useMemo(
    () => {
      if (!shouldBuildCollectionGameData) return addedLibraryGames;

      return addedLibraryGames.map((game) => {
        const details = enrichedGameByAppId.get(game.appId);
        return details ? mergeGameCardData(game, details) : game;
      });
    },
    [addedLibraryGames, enrichedGameByAppId, shouldBuildCollectionGameData]
  );

  const gamesById = useMemo(() => {
    const map = new Map<string, GhostBoxGame>();
    if (!shouldBuildCollectionGameData) return map;

    // Both lists were already merged against `enrichedGameByAppId` above. Merging
    // them again is not a no-op: the second pass re-runs the richer-game pick, and
    // an equal-length tie resolves to `details`, which can drop achievements that
    // only the game side carried.
    for (const game of enrichedAddedLibraryGames) map.set(game.id, game);
    for (const game of enrichedFavoriteGames) map.set(game.id, game);

    // Collection games are raw, so they still need the merge.
    for (const collection of userCollections) {
      for (const game of collection.games ?? []) {
        const details = enrichedGameByAppId.get(game.appId);
        map.set(game.id, details ? mergeGameCardData(game, details) : game);
      }
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
      if (hiddenProfileGameIds.has(game.appId)) continue;
      const base = games.get(game.appId);
      // Same rule as `profileGameBase`: with Steam hidden, a local-only game
      // that the account does not own in the cloud must not enter the list.
      if (!base && !shouldShowSteamContent && !cloudSaveAppIds.has(game.appId)) {
        continue;
      }
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

    const effectiveSteamAccountStats = shouldShowSteamContent ? steamAccountStats : null;
    const effectiveSteamIndex = shouldShowSteamContent ? steamAchievementIndex : new Map();
    // Geral e Conquistas listam todo owned (igual à Biblioteca): sem exigir
    // playtime/conquista desbloqueada e sem excluir software. Jogos 0/X ou
    // nunca jogados continuam na lista.
    return [...games.values()]
      .map((game) =>
        withResolvedProfileGameTitle(game, resolvedGameTitlesByAppId),
      )
      .map((game) =>
        mergeSteamAchievementsIntoGame(
          game,
          effectiveSteamAccountStats,
          effectiveSteamIndex,
        ),
      );
  }, [
    cloudSaveAppIds,
    hiddenProfileGameIds,
    localAchievementGamesByAppId,
    profileGameBase,
    resolvedGameTitlesByAppId,
    shouldComputeOverviewData,
    shouldShowSteamContent,
    steamAchievementIndex,
    steamAccountStats,
  ]);

  // Flipping the Steam toggle changes which games need local hydration, so the
  // in-flight/backoff bookkeeping is reset for everything that never produced a
  // local achievement list.
  useEffect(() => {
    localAchievementHydrationFailedUntilRef.current.clear();
    localAchievementRequestedAppIdsRef.current = new Set(
      localAchievementCompletedAppIdsRef.current,
    );
    setAchievementHydrationAttempt((current) => current + 1);
  }, [shouldShowSteamContent]);

  useEffect(() => {
    if (!shouldComputeOverviewData) return;

    let cancelled = false;
    const recentGameIndexes = new Map(
      achievementHistoryGames.map((game, index) => [game.appId, index])
    );
    // Remote unlocks only cover the card when Steam content is visible; with the
    // toggle off they are stripped from the merge, so those games must be
    // hydrated locally instead of skipped.
    const remoteAchievementAppIds = new Set(
      shouldShowSteamContent
        ? (steamAccountStats?.achievements ?? [])
            .filter((entry) => entry.achievements.length > 0)
            .map((entry) => entry.appId)
        : []
    );
    const now = Date.now();
    const failedUntil = localAchievementHydrationFailedUntilRef.current;
    const seenCandidateAppIds = new Set<string>();
    const candidates = [
      ...achievementHistoryGames,
      ...addedLibraryGames,
      ...favoriteGames,
      ...steamOwnedProfileGames,
    ]
      .filter((game) => {
        if (
          !game.appId ||
          // The source lists overlap (history/library/favorites), so the same
          // appId must not be hydrated twice in one pass.
          seenCandidateAppIds.has(game.appId) ||
          localAchievementRequestedAppIdsRef.current.has(game.appId)
        ) {
          return false;
        }
        // Jogos com save na nuvem precisam hidratar local mesmo com Steam visível:
        // o `steamAccountStats` pode dizer 0/3 mas o backup local tem desbloqueios
        // que só aparecem após `merge_game_achievement_details` (modal).
        if (
          remoteAchievementAppIds.has(game.appId) &&
          !cloudSaveAppIds.has(game.appId)
        )
          return false;
        if ((failedUntil.get(game.appId) ?? 0) > now) return false;
        seenCandidateAppIds.add(game.appId);
        return true;
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

    let earliestRetryDelay = Number.POSITIVE_INFINITY;
    let retryTimeoutId: number | undefined;

    void (async () => {
      const pendingHydratedGames = new Map<string, GhostBoxGame>();
      const pendingResolvedTitles = new Map<string, string>();
      const flushPendingResults = () => {
        if (pendingHydratedGames.size > 0) {
          setLocalAchievementGamesByAppId((current) => {
            let changed = false;
            const next = new Map(current);
            for (const [appId, game] of pendingHydratedGames) {
              // A retry must be able to upgrade an entry stored without
              // achievements — keeping the first result would pin games whose
              // achievement fetch failed (rate limit, cold cache) to "no
              // achievements" for the whole session.
              const merged = getRicherAchievementGame(next.get(appId), game);
              if (merged === next.get(appId)) continue;
              next.set(appId, merged);
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
            const hasAchievements = Boolean(details?.achievementList?.length);
            const achievementGame =
              details && hasAchievements
                ? mergeAchievementDetailsIntoGame(enrichedGame, details)
                : enrichedGame;

            return {
              game: { ...achievementGame, title },
              hasAchievements,
              retryAfterSeconds: details?.achievementMetadata?.retryAfter ?? 0,
            };
          })
        );
        if (cancelled) return;

        for (const result of hydratedGames) {
          if (!result) continue;
          const { game, hasAchievements, retryAfterSeconds } = result;
          pendingHydratedGames.set(game.appId, game);
          if (!isSteamTitlePlaceholder(game.title, game.appId)) {
            pendingResolvedTitles.set(game.appId, game.title);
          }

          if (hasAchievements) {
            localAchievementCompletedAppIdsRef.current.add(game.appId);
            localAchievementHydrationFailedUntilRef.current.delete(game.appId);
            continue;
          }

          // Store details came back but the achievement list did not. Keep the
          // card (title/cover already improved) and queue another attempt
          // instead of treating the empty list as the final answer.
          localAchievementRequestedAppIdsRef.current.delete(game.appId);
          const retryDelay =
            retryAfterSeconds > 0
              ? retryAfterSeconds * 1000
              : localAchievementRetryDelayMs;
          localAchievementHydrationFailedUntilRef.current.set(
            game.appId,
            Date.now() + retryDelay,
          );
          earliestRetryDelay = Math.min(earliestRetryDelay, retryDelay);
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

      if (cancelled || !Number.isFinite(earliestRetryDelay)) return;
      // Nothing else re-runs this effect on its own, so games left pending need
      // an explicit wake-up once their backoff window closes.
      retryTimeoutId = window.setTimeout(() => {
        setAchievementHydrationAttempt((current) => current + 1);
      }, earliestRetryDelay);
    })();

    return () => {
      cancelled = true;
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
      for (const game of candidates) {
        if (!localAchievementCompletedAppIdsRef.current.has(game.appId)) {
          localAchievementRequestedAppIdsRef.current.delete(game.appId);
        }
      }
    };
  }, [
    achievementHistoryGames,
    achievementHydrationAttempt,
    addedLibraryGames,
    cloudSaveAppIds,
    favoriteGames,
    shouldComputeOverviewData,
    shouldShowSteamContent,
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

  const visibleGames = useMemo(() => {
    const seen = new Set<string>();

    if (
      activeCollection.id === "overview" ||
      activeCollection.id === "achievements" ||
      activeCollection.id === "editProfile"
    )
      return [];

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
  const visibleAchievementPercentRequestKey = pagedAchievementTabGames
    .map((game) =>
      `${game.appId}:${game.achievementList?.some(
        (achievement) =>
          typeof achievement.globalPercent === "number" &&
          Number.isFinite(achievement.globalPercent),
      ) ? "ready" : "missing"}`,
    )
    .join("|");

  useEffect(() => {
    if (!isAchievementsActive) return;

    const candidates = pagedAchievementTabGames.filter(
      (game) =>
        game.appId &&
        game.achievementList?.length > 0 &&
        !game.achievementList.some(
          (achievement) =>
            typeof achievement.globalPercent === "number" &&
            Number.isFinite(achievement.globalPercent),
        ) &&
        !achievementPercentRequestedAppIdsRef.current.has(game.appId),
    );
    if (candidates.length === 0) return;

    candidates.forEach((game) =>
      achievementPercentRequestedAppIdsRef.current.add(game.appId),
    );
    let cancelled = false;

    void (async () => {
      for (
        let index = 0;
        index < candidates.length;
        index += visibleAchievementPercentBatchSize
      ) {
        const batch = await Promise.all(
          candidates
            .slice(index, index + visibleAchievementPercentBatchSize)
            .map(async (game) => ({
              game,
              details: await loadGameAchievementDetailsCached(
                game.id || `steam-${game.appId}`,
              ).catch(() => null),
            })),
        );
        if (cancelled) return;

        setLocalAchievementGamesByAppId((current) => {
          const next = new Map(current);
          let changed = false;
          for (const { game, details } of batch) {
            if (!details?.achievementList?.length) continue;
            const enriched = mergeAchievementDetailsIntoGame(game, details);
            const merged = getRicherAchievementGame(next.get(game.appId), enriched);
            if (merged === next.get(game.appId)) continue;
            next.set(game.appId, merged);
            changed = true;
          }
          return changed ? next : current;
        });
      }
    })();

    return () => {
      cancelled = true;
      candidates.forEach((game) =>
        achievementPercentRequestedAppIdsRef.current.delete(game.appId),
      );
    };
  }, [isAchievementsActive, visibleAchievementPercentRequestKey]);

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
    if (shouldShowSteamContent && steamAccountStats) {
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
  }, [profileAchievementGames, shouldShowSteamContent, steamAccountStats]);

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
      variant: "catalogueHeader",
      limit: pagedRecentActivityGames.length,
      sourceLimit: 4,
      idle: false,
      decode: true,
      nativeResolve: false,
      roundRobin: true,
    });

    if (nextRecentActivityGames.length > 0) {
      preloadGameListAssets(nextRecentActivityGames, {
        variant: "catalogueHeader",
        limit: nextRecentActivityGames.length,
        sourceLimit: 2,
        idle: true,
        nativeResolve: false,
        roundRobin: true,
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
  const avatarUrl = steamProfile?.avatarUrl ?? "";
  const isDataAvatar = avatarUrl.startsWith("data:");
  const avatarSources = useCachedImageSources(
    !isDataAvatar && avatarUrl ? [avatarUrl] : []
  );
  const loadableAvatarSource = useLoadableImageSource(
    isDataAvatar ? emptyImageSources : avatarSources,
    { retryToken: imageRetryToken },
  );
  const bannerUrl = steamProfile?.bannerUrl ?? "";
  const isDataBanner = bannerUrl.startsWith("data:");
  const cachedBannerSources = useCachedImageSources(
    !isDataBanner && bannerUrl ? [bannerUrl] : []
  );
  // A capa vem da nuvem (bucket `profile-images`) e pode falhar: URL ainda não
  // propagada, offline, ou um arquivo do cache em disco que sumiu. A cadeia
  // abaixo tenta cache -> URL remota e, só então, desiste para o placeholder,
  // em vez de deixar o `<img>` quebrado na tela.
  const bannerLoadSources = useMemo(
    () => (isDataBanner ? [bannerUrl] : cachedBannerSources),
    [bannerUrl, cachedBannerSources, isDataBanner],
  );
  const {
    source: loadedBannerSource,
    loaded: bannerLoaded,
    failed: bannerFailed,
  } = useLoadableImageState(bannerLoadSources, { retryToken: imageRetryToken });
  const avatarSource = isDataAvatar
    ? avatarUrl
    : loadableAvatarSource || avatarUrl;
  // Reopening the app paints the Steam summary (avatar, name, banner) before
  // the account's cloud profile lands. While the cloud sync is in flight,
  // hold the placeholder avatar/banner and no username instead of the
  // provisional Steam data.
  const isHoldingForCloudSync = Boolean(isCloudProfileRestoring);
  // Só pinta a arte depois que ela decodificou de fato. Pintar a URL "otimista"
  // é o que colocava o ícone de imagem quebrada na capa quando o download da
  // nuvem falhava.
  const isBannerReady = Boolean(bannerUrl) && bannerLoaded && Boolean(loadedBannerSource);
  // Trocar a capa muda a URL duas vezes (data: local -> URL pública do bucket).
  // Sem segurar a última arte já decodificada, cada troca abria uma janela de
  // "não carregado ainda" e a capa piscava para o placeholder no meio: capa ->
  // logo -> capa. A arte anterior fica na tela até a nova estar pronta.
  if (isBannerReady) {
    lastPaintedBannerSourceRef.current = loadedBannerSource;
  } else if (!bannerUrl || bannerFailed) {
    lastPaintedBannerSourceRef.current = "";
  }
  const paintedBannerSource = isBannerReady
    ? loadedBannerSource
    : lastPaintedBannerSourceRef.current;
  const isBannerPlaceholder = !paintedBannerSource || isHoldingForCloudSync;
  const bannerImageSource = isBannerPlaceholder
    ? profileBannerPlaceholderSource
    : paintedBannerSource;
  // A revelação só começa quando o próprio `<img>` da capa terminou de decodificar.
  // Trocar `src` e classe no mesmo commit fazia a animação rodar enquanto o
  // elemento ainda estava vazio: ela terminava antes do primeiro pixel e a capa
  // "aparecia de uma vez", sem entrada.
  const [revealedBannerSource, setRevealedBannerSource] = useState("");
  const isBannerRevealed =
    !isBannerPlaceholder && revealedBannerSource === paintedBannerSource;

  const revealBannerImage = useCallback((image: HTMLImageElement | null) => {
    if (!image) return;
    const source = image.getAttribute("src") ?? "";
    if (!source) return;
    const paint = () => setRevealedBannerSource(source);

    if (typeof image.decode !== "function") {
      paint();
      return;
    }

    void image.decode().then(paint, paint);
  }, []);

  // Cobre o caso em que o `src` já estava no cache do WebView e o `load` do
  // elemento disparou antes do React anexar o handler.
  const attachBannerImage = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth > 0) revealBannerImage(image);
    },
    [revealBannerImage],
  );

  useEffect(() => {
    if (isBannerPlaceholder) setRevealedBannerSource("");
  }, [isBannerPlaceholder]);

  useEffect(() => {
    preloadProfileImages(steamProfile);
  }, [profileImageKey]);

  useEffect(() => {
    const retryProfileImages = () => setImageRetryToken((token) => token + 1);
    window.addEventListener("online", retryProfileImages);
    return () => window.removeEventListener("online", retryProfileImages);
  }, []);

  useEffect(() => {
    bannerRetryCountRef.current = 0;
  }, [bannerUrl]);

  // Duas tentativas espaçadas cobrem o caso comum: a capa acabou de subir para
  // o bucket e a URL pública ainda não respondia no primeiro paint.
  useEffect(() => {
    if (!bannerFailed || !bannerUrl || bannerRetryCountRef.current >= 2) return;

    const timeout = window.setTimeout(() => {
      bannerRetryCountRef.current += 1;
      setImageRetryToken((token) => token + 1);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [bannerFailed, bannerUrl]);

  useEffect(() => {
    let cancelled = false;
    const cached = ghostboxApi.getCachedDiscordLinkStatus();
    if (cached) setDiscordLink(cached);
    ghostboxApi.getDiscordLinkStatus().then((status) => {
      if (!cancelled) setDiscordLink(status);
    });
    return () => { cancelled = true; };
  }, []);

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

  const contextMenuItems = useGameContextMenu({
    game: gameContextMenu?.game ?? null,
    onOpenGame,
    directFavoriteAction: true,
  });

  const handleGameContextMenu = useCallback(
    (game: GhostBoxGame, x: number, y: number) =>
      setGameContextMenu({ game, x, y }),
    []
  );
  const bannerPosition = normalizeBannerPosition(steamProfile?.bannerPosition);
  // O zoom da capa entra como variável, não como `transform` direto: a entrada
  // multiplica a mesma variável, então a animação e o enquadramento escolhido
  // pelo usuário convivem (antes a animação sobrescrevia o `transform` inline e
  // o zoom era descartado ao terminar).
  const bannerImageStyle: CSSProperties | undefined = isBannerPlaceholder
    ? undefined
    : ({
        objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
        "--profile-banner-scale": `${bannerPosition.scale}`,
      } as CSSProperties);

  // Steam and Discord are optional enhancements, not a gate: the profile is
  // the GhostBox account's, so it renders on its own and the Steam-derived
  // parts (level, Steam ID, library, achievements) simply stay out until a
  // Steam account is connected.
  const profileDisplayName = isHoldingForCloudSync
    ? ""
    : steamProfile?.displayName || account?.displayName || account?.username || "";
  const steamLevelLabel =
    steamLevel === null
      ? appearance.language === "en"
        ? "Steam level unavailable"
        : "Nível Steam indisponível"
      : appearance.language === "en"
        ? `Level ${steamLevel}`
        : `Nível ${steamLevel}`;

  return (
    <section className={`profile-page${isMaximized ? " profile-page--maximized" : ""}`}>
      {!isEditProfileActive && (
      <header
        className={`profile-page__content-box${bannerImageSource ? "" : " profile-page__content-box--empty"}${isBannerRevealed ? "" : " profile-page__content-box--placeholder"}`}
      >
        {bannerImageSource && (
          <div
            className="profile-page__banner-viewport"
          >
            {/* O placeholder fica embaixo até a capa revelar, para o logo sair
                em fade cruzado em vez de sumir no meio da entrada. */}
            <img
              className={`profile-page__banner-image profile-page__banner-image--placeholder${isBannerRevealed ? " profile-page__banner-image--placeholder-hidden" : ""}`}
              src={profileBannerPlaceholderSource}
              alt=""
              aria-hidden="true"
              decoding="async"
            />
            {!isBannerPlaceholder && (
              <img
                ref={attachBannerImage}
                className={`profile-page__banner-image${isBannerRevealed ? " profile-page__banner-image--revealed" : ""}`}
                src={bannerImageSource}
                alt=""
                decoding="async"
                loading="eager"
                fetchPriority="high"
                style={bannerImageStyle}
                onLoad={(event) => revealBannerImage(event.currentTarget)}
              />
            )}
          </div>
        )}
        <div className="profile-page__background-overlay">
          <div className="profile-page__identity">
            <div
              className="profile-page__avatar-frame"
            >
              {isHoldingForCloudSync ? (
                <span className="profile-page__avatar-skeleton" />
              ) : (
                <img
                  src={avatarSource || avatarPlaceholder}
                  alt={profileDisplayName}
                  width={120}
                  height={120}
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              )}
            </div>

            <div className="profile-page__identity-content">
              <div className="profile-page__display-name-row">
                <h2 className="profile-page__display-name">
                  {profileDisplayName}
                </h2>
                {steamConnected && (
                  <span
                    className="profile-page__level"
                    aria-label={steamLevelLabel}
                  >
                    <span className="profile-page__level-value">
                      {steamLevel ?? ""}
                    </span>
                  </span>
                )}
              </div>
              <div className="profile-page__steam-id-row">
                {steamConnected && steamProfile ? (
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
                ) : null}
                {discordLink?.linked && (
                  <div className="profile-page__discord-box">
                    <svg viewBox="0 -28.5 256 256" className="profile-page__discord-icon" aria-hidden="true">
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
      )}

      <div className="profile-page__content-section">
        <main className="profile-page__main">
          <>
            {/* Abas (Geral/Conquistas) e sair da conta vivem na
                sidebar do app — ver `profileNavigationTabs`. */}
          <div className="profile-page__collection-content">
            <div
              id="profile-tab-panel"
              className="profile-page__tab-panel"
              role="region"
              aria-label={activeCollection.name}
              tabIndex={0}
            >
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
                        {/* Same metric trio either way: with Steam hidden the
                            numbers come from the GhostBox account games, so the
                            toolbar keeps one layout instead of collapsing into
                            a notice line. */}
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
                            onKeyDown={(event) =>
                              handleListboxTriggerKeyDown(
                                event,
                                setOverviewSortDropdownOpen,
                              )
                            }
                          >
                            <span>{t(`profile.sort.${overviewSortBy}`)}</span>
                            <ChevronDown size={14} />
                          </button>
                          {overviewSortDropdownOpen ? (
                            <div
                              className="settings-dropdown__menu"
                              role="listbox"
                              aria-label={t("profile.sortAria")}
                              onKeyDown={(event) =>
                                handleListboxKeyDown(
                                  event,
                                  setOverviewSortDropdownOpen,
                                )
                              }
                            >
                              {overviewSortOptions
                                .filter((option) => option !== overviewSortBy)
                                .map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    role="option"
                                    aria-selected={false}
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
                      <ProfileActivityListSkeleton />
                    ) : null}
                  </div>
                </section>
              </div>
            ) : isAchievementsActive ? (
              achievementTabGames.length > 0 ? (
                  <div
                    ref={achievementGamesRef}
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

                        <div className="profile-page__achievement-card-shell">
                          <div className="profile-page__achievement-card-row">
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
                                  <span className="profile-page__achievement-card-detail-row">
                                    {achievement.description ? (
                                      <span className="profile-page__achievement-card-description">
                                        {achievement.description}
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
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
            ) : isEditProfileActive ? (
              <EditProfileTab
                profile={steamProfile}
                isPremium={isPremium}
                onUpdateProfile={onUpdateProfile}
              />
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
                    onHoverGame={refreshGameAchievements}
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
    </section>
  );
}
