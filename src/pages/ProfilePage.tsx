import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Folder,
  Heart,
  Layers,
  LibraryBig,
  Lock,
  ShieldUser,
  Settings2,
  Trophy,
  User,
} from "lucide-react";
import type { GhostBoxGame, SteamAchievement } from "../data";
import type { SteamProfile, UserCollection } from "../types";
import { GameGrid } from "../components/ui/GameCard";
import {
  ContextMenu,
} from "../components/ui/ContextMenu";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { EditProfileModal } from "../components/modals/EditProfileModal";
import "./ProfilePage.scss";
import { useCachedImageSources } from "../hooks/useCachedImageSources";
import {
  gamePortraitSources,
  layeredImageStyle,
  preloadGameListAssets,
  preloadProfileImages,
  profileBannerPlaceholderSource,
} from "../utils/image";
import { useSettings } from "../context/settings";
import { formatCompactPlaytime } from "../utils/time";
import { mergeGameCardData } from "../utils/gameCardData";
import {
  ProfileLevelBadge,
  getProfileAchievementTotal as getAchievementTotal,
  getProfileAchievementXp as getAchievementXp,
  getProfileUnlockedAchievementCount as getUnlockedAchievementCount,
  getProfileXpStats,
  getRicherProfileAchievementGame as getRicherAchievementGame,
  isProfileAchievementUnlocked as isAchievementUnlocked,
} from "../components/ui/ProfileLevelBadge";

type BannerPosition = NonNullable<SteamProfile["bannerPosition"]>;

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
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  achievementHistoryGames?: GhostBoxGame[];
  userCollections: UserCollection[];
  activeCollectionId?: string;
  onSelectCollection?: (id: string) => void;
  onCreateCollection: () => void;
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
}

type ProfileCollection = {
  id: string;
  name: string;
  count: number;
};

type ProfileAchievementHighlight = {
  key: string;
  game: GhostBoxGame;
  achievementId: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  gameTitle: string;
  xp: number;
  globalPercent?: number;
  unlockedAt?: string;
};

const showcaseAchievementMinLimit = 15;
const showcaseAchievementMaxLimit = 32;
const showcaseLockedAchievementsPerGame = 4;
const showcaseAchievementEstimatedSlotWidth = 66;
let hasPreparedProfileOverviewData = false;

function getGamePlaytime(game: GhostBoxGame) {
  return game.playTimeInMilliseconds ?? game.hours * 3_600_000;
}

function formatProfileLastSession(value: string | null | undefined, language: string) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) {
    return language === "en" ? "Not recorded" : "Sem registro";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "short",
  }).format(time);
}

function getLastUnlockedAchievement(game: GhostBoxGame) {
  const unlockedAchievements = (game.achievementList ?? []).filter(
    isAchievementUnlocked
  );

  if (unlockedAchievements.length === 0) return null;

  return [...unlockedAchievements].sort((left, right) => {
    const leftTime = Date.parse(left.unlockedAt ?? "");
    const rightTime = Date.parse(right.unlockedAt ?? "");

    return (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
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

function formatAchievementPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";

  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  })}%`;
}

function achievementShowcaseIcon(
  achievement: SteamAchievement,
  unlocked: boolean
) {
  return unlocked
    ? achievement.icon || achievement.iconGray
    : achievement.iconGray || achievement.icon;
}

function ProfileAchievementShowcaseItem({
  achievement,
  onSelect,
}: {
  achievement: ProfileAchievementHighlight;
  onSelect?: () => void;
}) {
  const { appearance } = useSettings();
  const itemRef = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

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
    <span
      ref={itemRef}
      tabIndex={0}
      role={onSelect ? "button" : undefined}
      aria-label={ariaLabel}
      className={`profile-page__showcase-achievement${
        achievement.unlocked
          ? ""
          : " profile-page__showcase-achievement--locked"
      }${onSelect ? " profile-page__showcase-achievement--clickable" : ""}`}
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseDown={(event) => event.preventDefault()}
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
        src={achievement.icon}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
      {!achievement.unlocked && (
        <span className="profile-page__showcase-lock" aria-hidden="true">
          <Lock size={18} strokeWidth={2.4} />
        </span>
      )}
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(tooltip, document.body)
        : null}
    </span>
  );
}

export function ProfilePage({
  steamProfile,
  favoriteGames,
  addedLibraryGames,
  achievementHistoryGames = [],
  userCollections,
  activeCollectionId: propActiveCollectionId,
  onSelectCollection,
  onCreateCollection,
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
}: ProfilePageProps) {
  const { appearance, t } = useSettings();
  const [internalActiveCollectionId, setInternalActiveCollectionId] =
    useState("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
  const [renderedGameCount, setRenderedGameCount] = useState(40);
  const [pulsedTabId, setPulsedTabId] = useState<string | null>(null);
  const [showcaseAchievementLimit, setShowcaseAchievementLimit] = useState(
    showcaseAchievementMinLimit
  );
  const [isOverviewDataReady, setIsOverviewDataReady] = useState(
    () => hasPreparedProfileOverviewData
  );
  const loadMoreGamesRef = useRef<HTMLDivElement | null>(null);
  const achievementShowcaseRef = useRef<HTMLDivElement | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ left: 0, width: 0 });

  const activeCollectionId =
    propActiveCollectionId ?? internalActiveCollectionId;
  const setActiveCollectionId =
    onSelectCollection ?? setInternalActiveCollectionId;

  const [gameContextMenu, setGameContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

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
        id: "favorites",
        name: t("profile.favorites"),
        count: favoriteGames.length,
      },
      ...userCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: collection.gameIds.length,
      })),
    ];
  }, [addedLibraryGames.length, favoriteGames.length, t, userCollections]);

  const userCollectionById = useMemo(
    () =>
      new Map(userCollections.map((collection) => [collection.id, collection])),
    [userCollections]
  );

  const activeCollection =
    profileCollections.find(
      (collection) => collection.id === activeCollectionId
    ) ?? profileCollections[0];
  const isOverviewActive = activeCollection.id === "overview";
  const shouldBuildCollectionGameData = !isOverviewActive;
  const shouldComputeOverviewData = !isOverviewActive || isOverviewDataReady;

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

    const games = new Map<string, GhostBoxGame>();
    for (const game of achievementHistoryGames) {
      games.set(
        game.appId,
        getRicherAchievementGame(games.get(game.appId), game)
      );
    }
    for (const game of addedLibraryGames) {
      games.set(
        game.appId,
        getRicherAchievementGame(games.get(game.appId), game)
      );
    }
    return [...games.values()];
  }, [achievementHistoryGames, addedLibraryGames, shouldComputeOverviewData]);

  useEffect(() => {
    if (
      profileCollections.some(
        (collection) => collection.id === activeCollectionId
      )
    )
      return;
    setActiveCollectionId("overview");
  }, [activeCollectionId, profileCollections]);

  useEffect(() => {
    if (!isOverviewActive) return;

    const showcase = achievementShowcaseRef.current;
    if (!showcase || typeof ResizeObserver === "undefined") return;

    const updateShowcaseLimit = (width: number) => {
      if (width <= 0) return;

      const nextLimit = Math.min(
        showcaseAchievementMaxLimit,
        Math.max(
          showcaseAchievementMinLimit,
          Math.floor(width / showcaseAchievementEstimatedSlotWidth)
        )
      );

      setShowcaseAchievementLimit((current) =>
        current === nextLimit ? current : nextLimit
      );
    };

    updateShowcaseLimit(showcase.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      updateShowcaseLimit(entry.contentRect.width);
    });
    observer.observe(showcase);

    return () => observer.disconnect();
  }, [isOverviewActive]);

  const getGamesForCollection = useCallback(
    (collectionId: string): GhostBoxGame[] => {
      if (collectionId === "overview") return enrichedAddedLibraryGames.slice(0, 12);
      if (collectionId === "library") return enrichedAddedLibraryGames.slice(0, 12);
      if (collectionId === "favorites") return enrichedFavoriteGames.slice(0, 12);
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
    [enrichedAddedLibraryGames, enrichedFavoriteGames, gamesById, userCollectionById]
  );

  const handleCollectionTabHover = useCallback(
    (collectionId: string) => {
      const games = getGamesForCollection(collectionId);
      if (!games.length) return;
      preloadGameListAssets(games, {
        variant: "portrait",
        limit: 12,
        idle: false,
      });
    },
    [getGamesForCollection]
  );

  const handleTabClick = useCallback(
    (collectionId: string) => {
      setActiveCollectionId(collectionId);
      setPulsedTabId(null);
      requestAnimationFrame(() => setPulsedTabId(collectionId));
      setTimeout(() => setPulsedTabId((current) => current === collectionId ? null : current), 310);
    },
    [setActiveCollectionId]
  );

  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    const activeTab = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeCollectionId}"]`
    );
    if (!activeTab) return;

    const update = () => {
      setTabIndicatorStyle({
        left: activeTab.offsetLeft - container.scrollLeft,
        width: activeTab.offsetWidth,
      });
    };

    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [activeCollectionId, profileCollections]);

  const visibleGames = useMemo(() => {
    const seen = new Set<string>();

    if (activeCollection.id === "overview") return [];

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

  const overviewStats = useMemo(() => {
    const gamesWithAchievements = profileAchievementGames.filter(
      (game) => getAchievementTotal(game) > 0
    );
    const unlocked = profileAchievementGames.reduce(
      (total, game) => total + getUnlockedAchievementCount(game),
      0
    );
    const perfectGames = gamesWithAchievements.filter(
      (game) => getUnlockedAchievementCount(game) >= getAchievementTotal(game)
    ).length;
    const averageProgress = gamesWithAchievements.length
      ? Math.round(
          (gamesWithAchievements.reduce((total, game) => {
            const achievementTotal = getAchievementTotal(game);
            const progress =
              achievementTotal > 0
                ? getUnlockedAchievementCount(game) / achievementTotal
                : 0;
            return total + progress;
          }, 0) /
            gamesWithAchievements.length) *
            100
        )
      : 0;
    const totalPlaytime = profileAchievementGames.reduce(
      (total, game) => total + getGamePlaytime(game),
      0
    );

    return {
      unlocked,
      perfectGames,
      averageProgress,
      totalPlaytime,
      libraryGames: enrichedAddedLibraryGames.length,
    };
  }, [enrichedAddedLibraryGames.length, profileAchievementGames]);

  const profileXpStats = useMemo(
    () => getProfileXpStats(profileAchievementGames),
    [profileAchievementGames]
  );

  const achievementHighlights = useMemo<ProfileAchievementHighlight[]>(() => {
    const highlights: ProfileAchievementHighlight[] = [];
    const highlightKeys = new Set<string>();

    const sortHighlights = () =>
      highlights.slice().sort(
        (left, right) => Number(right.unlocked) - Number(left.unlocked)
      );

    const addHighlight = (
      game: GhostBoxGame,
      achievement: SteamAchievement,
      unlocked: boolean
    ) => {
      const key = achievementShowcaseKey(game, achievement);
      if (highlightKeys.has(key)) return false;

      const icon = achievementShowcaseIcon(achievement, unlocked);
      if (!icon) return false;

      highlightKeys.add(key);
      highlights.push({
        key,
        game,
        achievementId: achievement.name || achievement.title,
        title: achievement.title,
        description: achievement.description,
        icon,
        unlocked,
        gameTitle: game.title,
        xp: getAchievementXp(achievement),
        globalPercent: achievement.globalPercent,
        unlockedAt: achievement.unlockedAt,
      });

      return highlights.length >= showcaseAchievementLimit;
    };

    for (const game of profileAchievementGames) {
      const achievementList = game.achievementList ?? [];
      const explicitUnlocked = achievementList.filter(isAchievementUnlocked);

      for (const achievement of explicitUnlocked) {
        if (addHighlight(game, achievement, true)) return sortHighlights();
      }
    }

    const gamesWithLockedAchievements = profileAchievementGames
      .map((game) => ({
        game,
        achievements: (game.achievementList ?? []).filter(
          (achievement) => !isAchievementUnlocked(achievement)
        ),
        offset: 0,
      }))
      .filter((item) => item.achievements.length > 0);

    while (highlights.length < showcaseAchievementLimit) {
      let addedInRound = false;

      for (const item of gamesWithLockedAchievements) {
        let addedForGame = 0;

        while (
          addedForGame < showcaseLockedAchievementsPerGame &&
          item.offset < item.achievements.length
        ) {
          const achievement = item.achievements[item.offset];
          item.offset += 1;

          if (addHighlight(item.game, achievement, false)) return sortHighlights();
          addedForGame += 1;
          addedInRound = true;
        }

        if (highlights.length >= showcaseAchievementLimit) return sortHighlights();
      }

      if (!addedInRound) break;
    }

    return sortHighlights();
  }, [profileAchievementGames, showcaseAchievementLimit]);

  const topGames = useMemo(() => {
    return profileAchievementGames
      .filter((game) => getGamePlaytime(game) > 0)
      .slice()
      .sort((left, right) => getGamePlaytime(right) - getGamePlaytime(left))
      .slice(0, 3);
  }, [profileAchievementGames]);

  const visibleGamesKey = visibleGames.map((game) => game.id).join("|");
  const profileImageKey = `${steamProfile?.avatarUrl ?? ""}\n${steamProfile?.bannerUrl ?? ""}`;
  const avatarSources = useCachedImageSources(
    steamProfile?.avatarUrl ? [steamProfile.avatarUrl] : []
  );
  const shouldUseBannerCache = !steamProfile?.bannerUrl?.startsWith("data:");
  const bannerSources = useCachedImageSources(
    shouldUseBannerCache && steamProfile?.bannerUrl
      ? [steamProfile.bannerUrl]
      : shouldUseBannerCache
        ? [profileBannerPlaceholderSource]
        : []
  );
  const avatarSource = steamProfile?.avatarUrl?.startsWith("data:")
    ? steamProfile.avatarUrl
    : avatarSources[0] ?? steamProfile?.avatarUrl ?? "";
  const requestedBannerImageSource = !shouldUseBannerCache && steamProfile?.bannerUrl
    ? steamProfile.bannerUrl
    : bannerSources[0] ?? profileBannerPlaceholderSource;
  const isBannerPlaceholder = !steamProfile?.bannerUrl;
  const [bannerImageSource, setBannerImageSource] = useState(() =>
    steamProfile?.bannerUrl ? "" : requestedBannerImageSource
  );

  useEffect(() => {
    if (!steamProfile?.bannerUrl) {
      setBannerImageSource(requestedBannerImageSource);
      return;
    }

    setBannerImageSource("");
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        startTransition(() => setBannerImageSource(requestedBannerImageSource));
      }, 80);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [requestedBannerImageSource, steamProfile?.bannerUrl]);

  useEffect(() => {
    preloadProfileImages(steamProfile);
  }, [profileImageKey]);

  useEffect(() => {
    preloadGameListAssets(visibleGames, {
      variant: "portrait",
      limit: 12,
      idle: false,
    });
  }, [visibleGamesKey]);

  useEffect(() => {
    setRenderedGameCount(Math.min(40, visibleGames.length));
  }, [visibleGamesKey, visibleGames.length]);

  useEffect(() => {
    const sentinel = loadMoreGamesRef.current;
    if (!sentinel || renderedGameCount >= visibleGames.length) return;
    if (typeof IntersectionObserver === "undefined") {
      setRenderedGameCount((current) =>
        Math.min(current + 24, visibleGames.length)
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRenderedGameCount((current) => {
          if (current >= visibleGames.length) return current;
          return Math.min(current + 24, visibleGames.length);
        });
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [renderedGameCount, visibleGames.length]);

  const baseRenderedGames = useMemo(
    () => visibleGames.slice(0, renderedGameCount),
    [renderedGameCount, visibleGames]
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
              decoding="sync"
              loading="eager"
              fetchPriority="high"
              style={bannerImageStyle}
            />
          </div>
        )}
        <div className="profile-page__background-overlay">
          <button
            type="button"
            className="profile-page__banner-edit-button"
            onClick={() => setIsCoverModalOpen(true)}
            aria-label={t("profile.changeBanner")}
          >
            <Camera size={16} />
            {t("profile.changeBannerShort")}
          </button>
          <div className="profile-page__identity">
            <div className="profile-page__avatar-button">
              {avatarSource ? (
                <img
                  src={avatarSource}
                  alt={steamProfile.displayName}
                  width={96}
                  height={96}
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <ShieldUser size={36} />
              )}
            </div>

            <div className="profile-page__identity-content">
              <div className="profile-page__display-name-row">
                <h2 className="profile-page__display-name">
                  {steamProfile.displayName}
                </h2>
                <ProfileLevelBadge
                  level={profileXpStats.level}
                  progressPercent={profileXpStats.progressPercent}
                  label={t("profile.levelLabel", {
                    level: profileXpStats.level,
                  })}
                />
                <button
                  type="button"
                  className="profile-page__edit-button"
                  onClick={() => setIsEditModalOpen(true)}
                  aria-label={t("profile.editProfile")}
                >
                  <Settings2 size={18} />
                </button>
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
              <div className="profile-page__collection-tabs" ref={tabsContainerRef}>
                <div
                  className="profile-page__tab-indicator"
                  style={{
                    left: tabIndicatorStyle.left,
                    width: tabIndicatorStyle.width,
                  }}
                />
                {profileCollections.map((collection) => {
                  const TabIcon =
                    collection.id === "overview"
                      ? User
                      : collection.id === "library"
                        ? Layers
                        : collection.id === "favorites"
                          ? Heart
                          : Folder;

                  return (
                    <button
                      key={collection.id}
                      data-tab-id={collection.id}
                      type="button"
                      className={`profile-page__tab ${
                        activeCollectionId === collection.id
                          ? "profile-page__tab--active"
                          : ""
                      }${
                        pulsedTabId === collection.id
                          ? " profile-page__tab--pulse"
                          : ""
                      }`}
                      onClick={() => handleTabClick(collection.id)}
                      onMouseEnter={() =>
                        handleCollectionTabHover(collection.id)
                      }
                      onFocus={() => handleCollectionTabHover(collection.id)}
                    >
                      <TabIcon size={15} strokeWidth={2} aria-hidden="true" />
                      <span className="profile-page__tab-label">
                        {collection.name}
                      </span>

                    </button>
                  );
                })}
              </div>
            </div>

          <div className="profile-page__collection-content">
            {isOverviewActive ? (
              <div
                className="profile-page__overview"
                aria-label={t("profile.overview")}
              >
                <section className="profile-page__overview-console">
                  <div className="profile-page__progress-console">
                    <div className="profile-page__overview-title-row profile-page__progress-console-header">
                      <h3>{t("profile.xpProgress")}</h3>
                      <span>
                        {profileXpStats.currentLevelXp} /{" "}
                        {profileXpStats.nextLevelXp}{" "}
                        <span className="profile-page__xp-suffix">XP</span>
                      </span>
                    </div>
                    <div
                      className="profile-page__progress-track profile-page__progress-track--xp"
                      role="progressbar"
                      aria-valuenow={profileXpStats.currentLevelXp}
                      aria-valuemin={0}
                      aria-valuemax={profileXpStats.nextLevelXp}
                      aria-label={t("profile.xpProgress")}
                    >
                      <span
                        style={{ width: `${profileXpStats.progressPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="profile-page__metric-strip">
                    <div className="profile-page__metric-strip-item profile-page__metric-strip-item--lead">
                      <strong>{overviewStats.libraryGames}</strong>
                      <span>{t("profile.libraryGames")}</span>
                    </div>
                    <div className="profile-page__metric-strip-group">
                      <div className="profile-page__metric-strip-item">
                        <strong>{overviewStats.unlocked}</strong>
                        <span>{t("profile.unlockedAchievements")}</span>
                      </div>
                      <div className="profile-page__metric-strip-item">
                        <strong>{overviewStats.perfectGames}</strong>
                        <span>{t("profile.perfectGames")}</span>
                      </div>
                      {overviewStats.totalPlaytime > 0 ? (
                        <div className="profile-page__metric-strip-item profile-page__metric-strip-item--playtime">
                          <strong>
                            {formatCompactPlaytime(overviewStats.totalPlaytime)}
                          </strong>
                          <span>{t("profile.totalPlaytimeLabel")}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="profile-page__achievement-rail">
                    <div className="profile-page__overview-title-row">
                      <h3>{t("profile.achievementShowcase")}</h3>
                    </div>

                    <div
                      ref={achievementShowcaseRef}
                      className="profile-page__achievement-showcase"
                      aria-hidden={achievementHighlights.length === 0}
                    >
                      {achievementHighlights.length > 0
                        ? achievementHighlights.map((achievement) => (
                            <ProfileAchievementShowcaseItem
                              key={achievement.key}
                              achievement={achievement}
                              onSelect={
                                onOpenGameAchievements
                                  ? () => {
                                      onOpenGameAchievements(
                                        achievement.game,
                                        achievement.achievementId
                                      );
                                    }
                                  : undefined
                              }
                            />
                          ))
                        : Array.from(
                            { length: showcaseAchievementLimit },
                            (_, index) => (
                              <span
                                key={index}
                                className="profile-page__showcase-achievement profile-page__showcase-achievement--empty"
                                aria-hidden="true"
                              />
                            )
                          )}
                    </div>
                  </div>

                  <div className="profile-page__top-games-console">
                    <div className="profile-page__overview-title-row">
                      <h3>{t("profile.topGames")}</h3>
                    </div>

                    {topGames.length > 0 ? (
                      <div className="profile-page__top-games-list">
                        {topGames.map((game, index) => {
                          const achievementTotal = getAchievementTotal(game);
                          const achievementUnlocked =
                            getUnlockedAchievementCount(game);
                          const achievementProgress =
                            achievementTotal > 0
                              ? (achievementUnlocked / achievementTotal) * 100
                              : 0;
                          const lastAchievement = getLastUnlockedAchievement(game);
                          const lastAchievementIcon = lastAchievement
                            ? lastAchievement.icon || lastAchievement.iconGray
                            : "";

                          return (
                            <button
                              key={game.id}
                              type="button"
                              className="profile-page__top-game-console-row"
                              onClick={() => onOpenGame(game)}
                              onMouseEnter={() =>
                                preloadGameListAssets([game], {
                                  variant: "portrait",
                                  limit: 1,
                                  idle: false,
                                })
                              }
                              onFocus={() =>
                                preloadGameListAssets([game], {
                                  variant: "portrait",
                                  limit: 1,
                                  idle: false,
                                })
                              }
                            >
                              <span className="profile-page__top-game-rank">
                                {index + 1}
                              </span>
                              <span
                                className="profile-page__top-game-cover"
                                style={layeredImageStyle(
                                  gamePortraitSources(game),
                                  ""
                                )}
                                aria-hidden="true"
                              />
                              <span className="profile-page__top-game-content">
                                <strong>{game.title}</strong>
                                <span className="profile-page__top-game-stats">
                                  <span className="profile-page__top-game-stat">
                                    <span className="profile-page__top-game-stat-label">
                                      {appearance.language === "en"
                                        ? "Play time"
                                        : "Tempo de jogo"}
                                    </span>
                                    <span className="profile-page__top-game-stat-value">
                                      {formatCompactPlaytime(
                                        getGamePlaytime(game)
                                      )}
                                    </span>
                                  </span>
                                  <span className="profile-page__top-game-stat">
                                    <span className="profile-page__top-game-stat-label">
                                      {appearance.language === "en"
                                        ? "Last session"
                                        : "Última sessão"}
                                    </span>
                                    <span className="profile-page__top-game-stat-value">
                                      {formatProfileLastSession(
                                        game.lastTimePlayed,
                                        appearance.language
                                      )}
                                    </span>
                                  </span>
                                  <span className="profile-page__top-game-stat profile-page__top-game-stat--achievements">
                                    <span className="profile-page__top-game-stat-heading">
                                      <span className="profile-page__top-game-stat-label">
                                        <Trophy size={14} strokeWidth={2.2} aria-hidden="true" />
                                        {appearance.language === "en"
                                          ? "Achievements"
                                          : "Conquistas"}
                                      </span>
                                      <span className="profile-page__top-game-stat-value">
                                        {achievementTotal > 0
                                          ? `${achievementUnlocked}/${achievementTotal}`
                                          : t("profile.noAchievements")}
                                      </span>
                                    </span>
                                    <span
                                      className="profile-page__progress-track profile-page__progress-track--compact"
                                      aria-hidden="true"
                                    >
                                      <span
                                        style={{
                                          width: `${achievementProgress}%`,
                                        }}
                                      />
                                    </span>
                                    {lastAchievement && lastAchievementIcon ? (
                                      <span className="profile-page__top-game-last-achievement">
                                        <span className="profile-page__top-game-last-achievement-label">
                                          {appearance.language === "en"
                                            ? "Last achievement"
                                            : "Última conquista"}
                                        </span>
                                        <span className="profile-page__top-game-last-achievement-content">
                                          <img
                                            src={lastAchievementIcon}
                                            alt=""
                                            aria-hidden="true"
                                          />
                                          <span>{lastAchievement.title}</span>
                                        </span>
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        className="profile-page__top-games-list profile-page__top-games-list--skeleton"
                        aria-hidden="true"
                      >
                        {[0, 1, 2].map((index) => (
                          <div
                            key={index}
                            className="profile-page__top-game-console-row profile-page__top-game-console-row--skeleton"
                          >
                            <span className="profile-page__top-game-rank profile-page__skeleton-block" />
                            <span className="profile-page__top-game-cover profile-page__skeleton-block" />
                            <span className="profile-page__top-game-content profile-page__top-game-content--skeleton">
                              <span className="profile-page__skeleton-line profile-page__skeleton-line--title" />
                              <span className="profile-page__top-game-stats profile-page__top-game-stats--skeleton">
                                <span className="profile-page__top-game-stat">
                                  <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                                  <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                                </span>
                                <span className="profile-page__top-game-stat">
                                  <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                                  <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                                </span>
                                <span className="profile-page__top-game-stat profile-page__top-game-stat--achievements">
                                  <span className="profile-page__top-game-stat-heading">
                                    <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                                    <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                                  </span>
                                  <span className="profile-page__skeleton-line profile-page__skeleton-line--progress" />
                                  <span className="profile-page__top-game-last-achievement profile-page__top-game-last-achievement--skeleton">
                                    <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                                    <span className="profile-page__skeleton-line profile-page__skeleton-line--achievement" />
                                  </span>
                                </span>
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : renderedGames.length > 0 ? (
                <>
                  <GameGrid
                    games={renderedGames}
                    className="profile-page__game-grid"
                    dense
                    portrait
                    onOpenGame={onOpenGame}
                    onGameContextMenu={handleGameContextMenu}
                    showAchievementSummary
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
                <div className="profile-page__no-games">
                  <div className="profile-page__no-games-icon">
                    <LibraryBig size={24} />
                  </div>
                  <h2>
                    {appearance.language === "en"
                      ? `No games in ${activeCollection.name}`
                      : `Nenhum jogo em ${activeCollection.name}`}
                  </h2>
                  <p>
                    {appearance.language === "en"
                      ? "This collection has no games yet."
                      : "Esta coleção ainda não possui jogos."}
                  </p>
                </div>
              )}
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

        <div className="profile-page__collection-actions">
          <button
            type="button"
            className="profile-page__collection-button profile-page__collection-button--create"
            onClick={onCreateCollection}
          >
            <span className="profile-page__create-icon" aria-hidden="true" />
            {appearance.language === "en"
              ? "Create collection"
              : "Criar coleção"}
          </button>
        </div>
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
