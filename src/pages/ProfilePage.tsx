import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Folder,
  Heart,
  Layers,
  LibraryBig,
  Lock,
  ShieldUser,
  SquarePen,
  Settings2,
  User,
} from "lucide-react";
import { Cup } from "reicon-react";
import type { GhostBoxGame, SteamAchievement } from "../data";
import type { SteamProfile, UserCollection } from "../types";
import { GameGrid } from "../components/ui/GameCard";
import {
  ContextMenu,
} from "../components/ui/ContextMenu";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { useGameIconUrl } from "../hooks/useGameIconUrl";
import { EditProfileModal } from "../components/modals/EditProfileModal";
import "./ProfilePage.scss";
import {
  useCachedImageSources,
  useLoadableImageSource,
} from "../hooks/useCachedImageSources";
import { ModalCloseIcon } from "../components/ui/ModalCloseIcon";
import {
  gamePortraitPreviewSources,
  layeredImageStyle,
  preloadGameListAssets,
  preloadProfileImages,
  profileBannerPlaceholderSource,
} from "../utils/image";
import { useSettings } from "../context/settings";
import { formatCompactPlaytime } from "../utils/time";
import { mergeGameCardData } from "../utils/gameCardData";
import { loadGameAchievementDetailsCached } from "../utils/gameCache";
import {
  getProfileAchievementTotal as getAchievementTotal,
  getProfileUnlockedAchievementCount as getUnlockedAchievementCount,
  getRicherProfileAchievementGame as getRicherAchievementGame,
  isProfileAchievementUnlocked as isAchievementUnlocked,
} from "../utils/profileAchievements";
import { ghostboxApi } from "../lib/ghostboxApi";
import type { DiscordLinkStatus } from "../lib/ghostboxApi.types";

type BannerPosition = NonNullable<SteamProfile["bannerPosition"]>;

function ProfileTopGameCover({ game }: { game: GhostBoxGame }) {
  const coverSources = useCachedImageSources(gamePortraitPreviewSources(game));
  const coverSource = useLoadableImageSource(coverSources);

  return (
    <span
      className="profile-page__top-game-cover"
      style={layeredImageStyle(coverSource ? [coverSource] : [], "")}
      aria-hidden="true"
    />
  );
}

function ProfileAchievementGameIcon({ game }: { game: GhostBoxGame }) {
  const iconUrl = useGameIconUrl(game);

  return (
    <span className="profile-page__achievement-game-icon" aria-hidden="true">
      {iconUrl ? <img src={iconUrl} alt="" loading="lazy" decoding="async" /> : null}
    </span>
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

const showcaseAchievementMinLimit = 15;
const showcaseAchievementMaxLimit = 32;
const showcaseAchievementEstimatedSlotWidth = 66;
const localAchievementHydrationLimit = 80;
const localAchievementHydrationBatchSize = 5;
let hasPreparedProfileOverviewData = false;

function profileAchievementShowcaseStorageKey(steamId?: string) {
  return `ghostbox:profile-achievement-showcase:${steamId || "local"}:v1`;
}

function readStoredProfileAchievementShowcase(steamId?: string) {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(profileAchievementShowcaseStorageKey(steamId)) ??
        "[]"
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredProfileAchievementShowcase(
  steamId: string | undefined,
  achievementKeys: string[]
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      profileAchievementShowcaseStorageKey(steamId),
      JSON.stringify(achievementKeys)
    );
  } catch {
    // The showcase still works for the current session if storage is unavailable.
  }
}

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

function formatProfileAchievementUnlockedDate(
  value: string | undefined,
  language: string
) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return "";

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(time);
}

function ProfileAchievementShowcaseItem({
  achievement,
  isEditing = false,
  isSelected = false,
  onSelect,
}: {
  achievement: ProfileAchievementHighlight;
  isEditing?: boolean;
  isSelected?: boolean;
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

  const fallbackGameLabel =
    appearance.language === "en"
      ? "Game unavailable"
      : "Jogo indisponível";
  const secondaryLabel = achievement.gameTitle || fallbackGameLabel;
  const ariaLabel = `${achievement.title}, ${secondaryLabel}`;
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
      <span>{secondaryLabel}</span>
    </span>
  );

  return (
    <span
      ref={itemRef}
      tabIndex={0}
      role={onSelect ? "button" : undefined}
      aria-pressed={isEditing && onSelect ? isSelected : undefined}
      aria-label={ariaLabel}
      className={`profile-page__showcase-achievement${
        achievement.unlocked
          ? ""
          : " profile-page__showcase-achievement--locked"
      }${onSelect ? " profile-page__showcase-achievement--clickable" : ""}${
        isEditing ? " profile-page__showcase-achievement--editing" : ""
      }${isSelected ? " profile-page__showcase-achievement--selected" : ""}`}
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
      {achievement.icon && (
        <img
          src={achievement.icon}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      )}
      {!achievement.unlocked && (
        <span className="profile-page__showcase-lock" aria-hidden="true">
          <Lock size={18} strokeWidth={2.0} />
        </span>
      )}
      {isEditing && isSelected && (
        <span className="profile-page__showcase-selected" aria-hidden="true" />
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
  const [expandedAchievementGameIds, setExpandedAchievementGameIds] = useState<Set<string>>(
    () => new Set()
  );
  const [localAchievementGamesByAppId, setLocalAchievementGamesByAppId] =
    useState<Map<string, GhostBoxGame>>(() => new Map());
  const [isAchievementShowcaseModalOpen, setIsAchievementShowcaseModalOpen] =
    useState(false);
  const [selectedShowcaseAchievementKeys, setSelectedShowcaseAchievementKeys] =
    useState<string[]>(() =>
      readStoredProfileAchievementShowcase(steamProfile?.steamId)
    );
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
  const [isTabIndicatorReady, setIsTabIndicatorReady] = useState(false);
  const [isSteamIdVisible, setIsSteamIdVisible] = useState(false);
  const [isSteamIdCopied, setIsSteamIdCopied] = useState(false);
  const steamIdCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [discordLink, setDiscordLink] = useState<DiscordLinkStatus | null>(null);

  const activeCollectionId =
    propActiveCollectionId ?? internalActiveCollectionId;
  const setActiveCollectionId =
    onSelectCollection ?? setInternalActiveCollectionId;

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
        id: "favorites",
        name: t("profile.favorites"),
        count: favoriteGames.length,
      },
      {
        id: "achievements",
        name: t("achievements.title"),
        count: 0,
      },
    ];
  }, [addedLibraryGames.length, favoriteGames.length, t]);

  const userCollectionById = useMemo(
    () =>
      new Map(userCollections.map((collection) => [collection.id, collection])),
    [userCollections]
  );

  const activeCollection =
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
    })();
  const activeTabId = activeCollection.id;
  const isOverviewActive = activeCollection.id === "overview";
  const isAchievementsActive = activeCollection.id === "achievements";
  const shouldBuildCollectionGameData = !isOverviewActive;
  const shouldComputeOverviewData = !isOverviewActive || isOverviewDataReady;

  useEffect(() => {
    setSelectedShowcaseAchievementKeys(
      readStoredProfileAchievementShowcase(steamProfile?.steamId)
    );
    setIsAchievementShowcaseModalOpen(false);
  }, [steamProfile?.steamId]);

  useEffect(() => {
    if (!isAchievementShowcaseModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAchievementShowcaseModalOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAchievementShowcaseModalOpen]);

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
    // Freshly hydrated local achievement details reflect the current local
    // unlock state read from the Steam appcache, so they are authoritative and
    // must override any previously cached/persisted achievement counts. The
    // "richer wins" heuristic keeps the higher unlocked count, which would
    // otherwise pin the profile to a stale/over-counted value that can never be
    // corrected downward.
    for (const game of localAchievementGamesByAppId.values()) {
      const base = games.get(game.appId);
      games.set(
        game.appId,
        base
          ? {
              ...base,
              achievements: game.achievements,
              achievementList: game.achievementList,
            }
          : game
      );
    }
    return [...games.values()];
  }, [achievementHistoryGames, addedLibraryGames, localAchievementGamesByAppId, shouldComputeOverviewData]);

  useEffect(() => {
    if (!shouldComputeOverviewData) return;

    let cancelled = false;
    const recentGameIndexes = new Map(
      achievementHistoryGames.map((game, index) => [game.appId, index])
    );
    const candidates = [...achievementHistoryGames, ...addedLibraryGames]
      .filter((game) => game.appId && !localAchievementGamesByAppId.has(game.appId))
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

    void (async () => {
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
            const details = await loadGameAchievementDetailsCached(
              game.id || `steam-${game.appId}`
            ).catch(() => null);
            if (!details?.achievementList?.length) return null;
            return {
              ...game,
              achievements: details.achievements,
              achievementList: details.achievementList,
            };
          })
        );
        if (cancelled) return;

        setLocalAchievementGamesByAppId((current) => {
          let changed = false;
          const next = new Map(current);
          for (const game of hydratedGames) {
            if (!game || next.has(game.appId)) continue;
            next.set(game.appId, game);
            changed = true;
          }
          return changed ? next : current;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [achievementHistoryGames, addedLibraryGames, localAchievementGamesByAppId, shouldComputeOverviewData]);

  useEffect(() => {
    if (
      profileCollections.some(
        (collection) => collection.id === activeCollectionId
      ) || userCollectionById.has(activeCollectionId)
    )
      return;
    setActiveCollectionId("overview");
  }, [activeCollectionId, profileCollections, userCollectionById]);

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

  useLayoutEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    const activeTab = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`
    );
    if (!activeTab) return;

    const update = () => {
      const indicatorWidth = 28;
      setTabIndicatorStyle({
        left: Math.round(
          activeTab.offsetLeft -
          container.scrollLeft +
          (activeTab.offsetWidth - indicatorWidth) / 2
        ),
        width: indicatorWidth,
      });
      setIsTabIndicatorReady(true);
    };

    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [activeTabId, profileCollections]);

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

  const unlockedAchievementHighlights = useMemo<ProfileAchievementHighlight[]>(() => {
    const highlightKeys = new Set<string>();
    const unlockedHighlights: ProfileAchievementHighlight[] = [];

    for (const game of profileAchievementGames) {
      const unlockedAchievements = (game.achievementList ?? [])
        .filter(isAchievementUnlocked)
        .sort(
          (left, right) =>
            achievementUnlockedTime(right.unlockedAt) -
            achievementUnlockedTime(left.unlockedAt)
        );

      for (const achievement of unlockedAchievements) {
        if (!isAchievementUnlocked(achievement)) continue;

        const key = achievementShowcaseKey(game, achievement);
        if (highlightKeys.has(key)) continue;

        const icon = achievementShowcaseIcon(achievement, true);
        if (!icon) continue;

        highlightKeys.add(key);
        unlockedHighlights.push({
          key,
          game,
          achievementId: achievement.name || achievement.title,
          title: achievement.title,
          description: achievement.description,
          icon,
          unlocked: true,
          gameTitle: game.title,
          globalPercent: achievement.globalPercent,
          unlockedAt: achievement.unlockedAt,
        });
      }
    }

    return unlockedHighlights.sort((left, right) => {
      const byDate =
        achievementUnlockedTime(right.unlockedAt) -
        achievementUnlockedTime(left.unlockedAt);
      if (byDate !== 0) return byDate;
      return (right.globalPercent ?? 100) - (left.globalPercent ?? 100);
    });
  }, [profileAchievementGames]);

  const achievementHighlights = useMemo<ProfileAchievementHighlight[]>(() => {
    return unlockedAchievementHighlights.slice(0, showcaseAchievementLimit);
  }, [showcaseAchievementLimit, unlockedAchievementHighlights]);

  const selectedShowcaseAchievementKeySet = useMemo(
    () => new Set(selectedShowcaseAchievementKeys),
    [selectedShowcaseAchievementKeys]
  );
  const selectedAchievementHighlights = useMemo(() => {
    if (selectedShowcaseAchievementKeys.length === 0) return [];

    const unlockedByKey = new Map(
      unlockedAchievementHighlights.map((achievement) => [achievement.key, achievement])
    );
    return selectedShowcaseAchievementKeys.flatMap((key) => {
      const achievement = unlockedByKey.get(key);
      return achievement ? [achievement] : [];
    });
  }, [selectedShowcaseAchievementKeys, unlockedAchievementHighlights]);
  const visibleAchievementHighlights =
    selectedAchievementHighlights.length > 0
      ? selectedAchievementHighlights.slice(0, showcaseAchievementLimit)
      : achievementHighlights;
  const showcaseSkeletonCount = Math.max(
    0,
    showcaseAchievementLimit - visibleAchievementHighlights.length
  );

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

  const handleToggleShowcaseAchievement = useCallback(
    (achievementKey: string) => {
      setSelectedShowcaseAchievementKeys((current) => {
        const exists = current.includes(achievementKey);
        const next = exists
          ? current.filter((key) => key !== achievementKey)
          : [...current, achievementKey];
        writeStoredProfileAchievementShowcase(steamProfile?.steamId, next);
        return next;
      });
    },
    [steamProfile?.steamId]
  );

  const addedLibraryGameAppIds = useMemo(
    () => new Set(addedLibraryGames.map((game) => game.appId)),
    [addedLibraryGames]
  );

  const achievementTabGames = useMemo(() => {
    return profileAchievementGames
      .filter((game) => {
        const achievementTotal = getAchievementTotal(game);
        const achievementUnlocked = getUnlockedAchievementCount(game);
        const hasAchievementList = (game.achievementList ?? []).length > 0;

        if (achievementTotal <= 0 && !hasAchievementList) return false;
        if (addedLibraryGameAppIds.has(game.appId)) return true;

        return achievementUnlocked > 0;
      })
      .slice()
      .sort((left, right) => {
        const unlockedDelta =
          getUnlockedAchievementCount(right) - getUnlockedAchievementCount(left);
        if (unlockedDelta !== 0) return unlockedDelta;

        const totalDelta = getAchievementTotal(right) - getAchievementTotal(left);
        if (totalDelta !== 0) return totalDelta;

        return left.title.localeCompare(right.title);
      });
  }, [addedLibraryGameAppIds, profileAchievementGames]);

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
    if (!steamProfile?.steamId) return;
    let cancelled = false;
    ghostboxApi.getDiscordLinkStatus(steamProfile.steamId).then((status) => {
      if (!cancelled) setDiscordLink(status);
    });
    return () => { cancelled = true; };
  }, [steamProfile?.steamId]);

  useEffect(() => {
    preloadGameListAssets(visibleGames, {
      variant: "portrait",
      limit: 8,
      idle: false,
    });
  }, [visibleGamesKey]);

  useEffect(() => {
    setRenderedGameCount(Math.min(24, visibleGames.length));
  }, [visibleGamesKey, visibleGames.length]);

  useEffect(() => {
    const sentinel = loadMoreGamesRef.current;
    if (!sentinel || renderedGameCount >= visibleGames.length) return;
    if (typeof IntersectionObserver === "undefined") {
      setRenderedGameCount((current) =>
        Math.min(current + 16, visibleGames.length)
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
                <button
                  type="button"
                  className="profile-page__edit-button"
                  onClick={() => setIsEditModalOpen(true)}
                  aria-label={t("profile.editProfile")}
                >
                  <Settings2 size={18} />
                </button>
              </div>
              <div className="profile-page__steam-id-row">
                <div className="profile-page__steam-id-box">
                  <svg role="img" viewBox="0 0 24 24" className="profile-page__steam-id-icon" aria-hidden="true">
                    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
                  </svg>
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
              <div className="profile-page__collection-tabs" ref={tabsContainerRef}>
                <div
                  className={`profile-page__tab-indicator${isTabIndicatorReady ? " profile-page__tab-indicator--ready" : ""}`}
                    style={{
                      left: tabIndicatorStyle.left,
                      width: tabIndicatorStyle.width,
                      opacity: tabIndicatorStyle.width > 0 ? 1 : 0,
                    }}
                />
                {profileCollections.map((collection) => {
                  const isIconOnlyTab = [
                    "overview",
                    "library",
                    "favorites",
                    "achievements",
                  ].includes(collection.id);
                  const TabIcon =
                    collection.id === "overview"
                      ? User
                      : collection.id === "library"
                        ? Layers
                        : collection.id === "favorites"
                          ? Heart
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
                      {!isIconOnlyTab && (
                        <span className="profile-page__tab-label">
                          {collection.name}
                        </span>
                      )}

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
                  <div className="profile-page__achievement-rail">
                    <div className="profile-page__overview-title-row profile-page__overview-title-row--showcase">
                      <h3>{t("profile.achievementShowcase")}</h3>
                      <button
                        type="button"
                        className={`profile-page__showcase-edit-button${
                          isAchievementShowcaseModalOpen
                            ? " profile-page__showcase-edit-button--active"
                            : ""
                        }`}
                        onClick={() =>
                          setIsAchievementShowcaseModalOpen(true)
                        }
                        aria-label={
                          appearance.language === "en"
                            ? "Edit achievement showcase"
                            : "Editar destaque de conquistas"
                        }
                        aria-expanded={isAchievementShowcaseModalOpen}
                      >
                        <SquarePen size={16} strokeWidth={2.0} />
                      </button>
                    </div>

                    <div
                      ref={achievementShowcaseRef}
                      className="profile-page__achievement-showcase"
                    >
                      {visibleAchievementHighlights.map((achievement) => (
                        <ProfileAchievementShowcaseItem
                          key={achievement.key}
                          achievement={achievement}
                          isSelected={selectedShowcaseAchievementKeySet.has(
                            achievement.key
                          )}
                          onSelect={
                            onOpenGameAchievements && achievement.game
                              ? () => {
                                  onOpenGameAchievements(
                                    achievement.game!,
                                    achievement.achievementId
                                  );
                                }
                              : undefined
                          }
                        />
                      ))}
                      {Array.from({ length: showcaseSkeletonCount }, (_, index) => (
                        <span
                          key={`showcase-skeleton-${index}`}
                          className="profile-page__showcase-achievement profile-page__showcase-achievement--empty"
                          aria-hidden="true"
                        />
                      ))}
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
                              <ProfileTopGameCover game={game} />
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
                                        <Cup size={14} weight="Filled" strokeWidth={2.0} aria-hidden="true" />
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
            ) : isAchievementsActive ? (
              achievementTabGames.length > 0 ? (
                <div
                  className="profile-page__achievement-games"
                  aria-label={t("achievements.title")}
                >
                  {achievementTabGames.map((game) => {
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
                              <Cup size={14} weight="Filled" strokeWidth={2.0} aria-hidden="true" />
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
                            const unlockedDate = formatProfileAchievementUnlockedDate(
                              achievement.unlockedAt,
                              appearance.language
                            );

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
                                  {unlocked && unlockedDate ? (
                                    <span className="profile-page__achievement-card-date">
                                      {appearance.language === "en"
                                        ? `Unlocked on ${unlockedDate}`
                                        : `Desbloqueado em ${unlockedDate}`}
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
                </div>
              ) : (
                <div className="profile-page__no-games">
                  <div className="profile-page__no-games-icon">
                    <Cup size={24} weight="Filled" strokeWidth={2.0} />
                  </div>
                  <h2>{t("profile.noAchievements")}</h2>
                </div>
              )
            ) : renderedGames.length > 0 ? (
                <>
                  <GameGrid
                    games={renderedGames}
                    className="profile-page__game-grid"
                    dense
                    portrait
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

      </div>

      {isAchievementShowcaseModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="backdrop backdrop--collection profile-page__showcase-modal-backdrop"
              onClick={() => setIsAchievementShowcaseModalOpen(false)}
            >
              <section
                className="collection-modal profile-page__showcase-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-achievement-showcase-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="collection-modal__header">
                  <div>
                    <h3 id="profile-achievement-showcase-modal-title">
                      {appearance.language === "en"
                        ? "Edit achievement showcase"
                        : "Editar destaque de conquistas"}
                    </h3>
                    <p>
                      {appearance.language === "en"
                        ? "choose the unlocked achievements shown on your profile."
                        : "escolha as conquistas desbloqueadas exibidas no perfil."}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="collection-modal__close"
                    onClick={() => setIsAchievementShowcaseModalOpen(false)}
                    aria-label={appearance.language === "en" ? "Close" : "Fechar"}
                  >
                    <ModalCloseIcon />
                  </button>
                </header>

                <div className="collection-modal__content profile-page__showcase-modal-content">
                  {unlockedAchievementHighlights.length > 0 ? (
                    <div className="profile-page__showcase-modal-grid">
                      {unlockedAchievementHighlights.map((achievement) => (
                        <ProfileAchievementShowcaseItem
                          key={achievement.key}
                          achievement={achievement}
                          isEditing
                          isSelected={selectedShowcaseAchievementKeySet.has(
                            achievement.key
                          )}
                          onSelect={() =>
                            handleToggleShowcaseAchievement(achievement.key)
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="profile-page__showcase-modal-empty">
                      {appearance.language === "en"
                        ? "No unlocked achievements available yet."
                        : "Nenhuma conquista desbloqueada disponível ainda."}
                    </p>
                  )}

                  <div className="collection-modal__actions profile-page__showcase-modal-actions">
                    <button
                      type="button"
                      className="button button--outline"
                      disabled={selectedShowcaseAchievementKeys.length === 0}
                      onClick={() => {
                        setSelectedShowcaseAchievementKeys([]);
                        writeStoredProfileAchievementShowcase(
                          steamProfile.steamId,
                          []
                        );
                      }}
                    >
                      {appearance.language === "en"
                        ? "Use automatic"
                        : "Usar automático"}
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setIsAchievementShowcaseModalOpen(false)}
                    >
                      {appearance.language === "en" ? "Done" : "Concluir"}
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}

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
