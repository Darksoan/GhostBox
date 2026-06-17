import { ChevronLeft, ChevronRight, Clock, Trophy } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GhostBoxGame } from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem, UserCollection } from "../types";
import { loadGames, loadGameReviews, loadGameStoreDetails, loadSteamRecommendedTagsForUser, loadSteamSimilarAppIds, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useSettings } from "../context/settings";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../hooks/useCachedImageSources";
import {
  readStoredPersonalCalendar,
  writeStoredPersonalCalendar,
  readStoredSteamWishlistRecommendations,
  writeStoredSteamWishlistRecommendations,
  type StoredPersonalCalendar,
} from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroSources,
  gameHeroCapsuleSources,
  gamePortraitSources,
  layeredImageStyle,
  withoutHeaderImageSources,
} from "../utils/image";
import { loadedImageSources, withCachedImageSources } from "../utils/imageCache";
import { formatCompactPlaytime } from "../utils/time";

type HomeGameSeed = {
  appId: string;
  title: string;
  shortDescription?: string;
};

type HomeCategoryImageVariant = "header" | "heroCapsule";

type HomeExploreCategory = {
  label: string;
  filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
  filterValue: string;
  games: GhostBoxGame[];
  score: number;
};

type HomeWishlistRecommendation = {
  sourceGame: GhostBoxGame;
  recommendedGame: GhostBoxGame;
};

const topReviewedSteamGames: HomeGameSeed[] = [
  {
    appId: "2050650",
    title: "Resident Evil 4",
    shortDescription:
      "Survival horror reimagined with modern combat, constant tension, and a rescue mission in a village controlled by a brutal threat.",
  },
  {
    appId: "367520",
    title: "Hollow Knight",
    shortDescription:
      "Explore Hallownest in an atmospheric action adventure filled with challenging bosses, secrets, and precise combat.",
  },
  {
    appId: "1449690",
    title: "The Walking Dead: The Telltale Definitive Series",
    shortDescription:
      "A complete narrative journey through The Walking Dead universe, with hard choices, memorable characters, and emotional consequences.",
  },
  {
    appId: "1817070",
    title: "Marvel's Spider-Man Remastered",
    shortDescription:
      "Experience the story of a seasoned Peter Parker as he faces major threats and swings through New York with fluid acrobatics.",
  },
];

const homeFeaturedSteamGames: HomeGameSeed[] = [
  { appId: "1332010", title: "Stray" },
  { appId: "391220", title: "Rise of the Tomb Raider" },
  { appId: "1903340", title: "Clair Obscur: Expedition 33" },
  { appId: "1222140", title: "Detroit: Become Human" },
  { appId: "814380", title: "R.U.S.E." },
  { appId: "239140", title: "Dying Light" },
  { appId: "1145360", title: "Hades" },
  { appId: "413150", title: "Stardew Valley" },
  { appId: "1086940", title: "Baldur's Gate 3" },
  { appId: "1091500", title: "Cyberpunk 2077" },
  { appId: "292030", title: "The Witcher 3: Wild Hunt" },
  { appId: "620", title: "Portal 2" },
  { appId: "105600", title: "Terraria" },
  { appId: "294100", title: "RimWorld" },
  { appId: "588650", title: "Dead Cells" },
  { appId: "1794680", title: "Vampire Survivors" },
  { appId: "504230", title: "Celeste" },
  { appId: "646570", title: "Slay the Spire" },
  { appId: "427520", title: "Factorio" },
  { appId: "1868140", title: "DAVE THE DIVER" },
  { appId: "1245620", title: "ELDEN RING" },
  { appId: "1593500", title: "God of War" },
  { appId: "1174180", title: "Red Dead Redemption 2" },
  { appId: "1850570", title: "DEATH STRANDING DIRECTOR'S CUT" },
  { appId: "1551360", title: "Forza Horizon 5" },
  { appId: "1238840", title: "Battlefield 1" },
  { appId: "250900", title: "The Binding of Isaac: Rebirth" },
  { appId: "268910", title: "Cuphead" },
  { appId: "489830", title: "The Elder Scrolls V: Skyrim Special Edition" },
  { appId: "1151640", title: "Horizon Zero Dawn Complete Edition" },
  { appId: "220", title: "Half-Life 2" },
  { appId: "945360", title: "Among Us" },
];

const homeCarouselGroupSize = 4;
const homePersonalCalendarGameCount = 21;
const homePersonalCalendarPageSize = 120;
const homePersonalCalendarPoolTarget = homePersonalCalendarGameCount * 5;
const homePersonalCalendarEnrichmentLimit = 6;
const homePersonalCalendarHistoryLimit = homePersonalCalendarGameCount * 8;
const homePersonalCalendarRefreshMs = 7 * 24 * 60 * 60 * 1000;
const homeWishlistDetailsBatchSize = 8;
const homeWishlistRecommendationSourceLimit = 10;
const homeWishlistRecommendationAlgorithmVersion = "steam-morelike-v1";
const homeRecommendedHeroPositions = ["18% center", "48% center", "18% center", "72% center"];
const homeRecommendedHeroPreloadLimit = 1;
const homeRecommendedHeroPreloadTimeoutMs = 900;
const homeRecommendedHeroFadeMs = 180;
const homeRecommendedHeroPreloads = new Map<string, Promise<void>>();

type HomeRecommendedHeroLayer = {
  source: string;
  position: string;
};

function homeRecommendedHeroSources(game: GhostBoxGame | undefined) {
  if (!game) return [];

  const appId = homeGameAppId(game);
  return [
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    ...gameHeroSources(game),
  ].filter((source, index, sources) => source && sources.indexOf(source) === index);
}

function preloadHomeRecommendedHero(sources: string[]) {
  const candidates = withCachedImageSources(sources).slice(
    0,
    homeRecommendedHeroPreloadLimit
  );
  const cacheKey = candidates.join("\n");

  if (!candidates.length || typeof Image === "undefined") {
    return Promise.resolve();
  }

  const existingPreload = homeRecommendedHeroPreloads.get(cacheKey);
  if (existingPreload) return existingPreload;

  const preload = new Promise<void>((resolve) => {
    if (candidates.some((source) => loadedImageSources.has(source))) {
      resolve();
      return;
    }

    let settled = false;
    let pending = candidates.length;
    const timeout = window.setTimeout(
      finish,
      homeRecommendedHeroPreloadTimeoutMs
    );

    function finish() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    }

    candidates.forEach((source) => {
      const image = new Image();
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.onload = async () => {
        if (typeof image.decode === "function") {
          await image.decode().catch(() => undefined);
        }

        loadedImageSources.add(source);
        finish();
      };
      image.onerror = () => {
        pending -= 1;
        if (pending === 0) finish();
      };
      image.src = source;
    });
  }).finally(() => {
    homeRecommendedHeroPreloads.delete(cacheKey);
  });

  homeRecommendedHeroPreloads.set(cacheKey, preload);
  return preload;
}

function getHomeCalendarDates(): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    dates.push(`${day}/${month}`);
  }
  return dates;
}

function homeSteamCdnUrl(appId: string, asset: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`;
}

function homeGameAppId(game: GhostBoxGame) {
  return game.appId || game.id.replace(/^steam-/, "");
}

function formatLastSessionDate(
  value: string | null | undefined,
  language: "pt" | "en" = "pt"
) {
  if (!value)
    return language === "en" ? "Recently played" : "Jogado recentemente";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "Recently played" : "Jogado recentemente";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function createHomeSeedFallbackGame(
  game: HomeGameSeed,
  index: number,
  subtitle = "Mais avaliados na Steam"
): GhostBoxGame {
  const accent = ["#ff2d35", "#f59e0b", "#35d07f", "#60a5fa", "#c084fc"][
    index % 5
  ];
  const headerImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`;
  const heroImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/library_hero.jpg`;
  const headerCdn = homeSteamCdnUrl(game.appId, "header.jpg");
  const heroCdn = homeSteamCdnUrl(game.appId, "library_hero.jpg");
  const logoCdn = homeSteamCdnUrl(game.appId, "logo.png");

  return {
    appId: game.appId,
    id: `steam-${game.appId}`,
    title: game.title,
    subtitle,
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: "Steam",
    progress: 0,
    accent,
    cover: headerImage,
    hero: heroImage,
    coverUrl: headerImage,
    heroUrl: heroImage,
    coverFallbacks: [headerImage, headerCdn],
    heroFallbacks: [heroImage, heroCdn, headerImage, headerCdn],
    logo: logoCdn,
    tags: [],
    genres: [],
    screenshots: [],
    shortDescription: game.shortDescription,
    achievements: {
      unlocked: 0,
      total: 0,
      progress: 0,
    },
    achievementList: [],
  };
}

function hasCompletedPlaySession(
  game: GhostBoxGame | undefined
): game is GhostBoxGame {
  return Boolean(
    game &&
      Number.isFinite(Date.parse(game.lastTimePlayed ?? "")) &&
      !/^Steam App \d+$/i.test(game.title.trim())
  );
}

function getLastPlayedTime(game: GhostBoxGame) {
  const lastPlayedTime = Date.parse(game.lastTimePlayed ?? "");
  return Number.isFinite(lastPlayedTime) ? lastPlayedTime : 0;
}

function homeGameKey(game: GhostBoxGame) {
  return game.appId || game.id;
}

function getUniqueWishlistAppIds(
  wishlistItems: SteamWishlistItem[],
  libraryGameAppIds: Set<string>
) {
  const seen = new Set<string>();

  return wishlistItems.flatMap((item) => {
    const appId = item.appId.trim();
    if (!appId || seen.has(appId) || libraryGameAppIds.has(appId)) return [];
    seen.add(appId);
    return [appId];
  });
}

function isSteamFallbackTitle(title: string) {
  return /^Steam App \d+$/i.test(title.trim());
}

function getDisplayGameTitle(game: GhostBoxGame, fallback: string) {
  const title = game.title.trim();
  return title && !isSteamFallbackTitle(title) ? title : fallback;
}

function steamReviewAvatarUrl(hash: string) {
  if (!hash) return "";
  if (/^https?:\/\//i.test(hash)) return hash;
  return `https://avatars.akamai.steamstatic.com/${hash}_medium.jpg`;
}

function normalizeSteamReviewText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function createWishlistFallbackGames(
  appIds: string[],
  titleByAppId = new Map<string, string>()
) {
  return appIds.map((appId, index) =>
    createHomeSeedFallbackGame(
      { appId, title: titleByAppId.get(appId) || `Steam App ${appId}` },
      index
    )
  );
}

function createWishlistFallbackGame(appId: string, index = 0, title?: string) {
  return createHomeSeedFallbackGame({ appId, title: title || `Steam App ${appId}` }, index);
}

async function loadWishlistDisplayGame(appId: string, index = 0, title?: string) {
  const game = await loadGameStoreDetails(appId).catch(() => null);
  if (!game) return createWishlistFallbackGame(appId, index, title);
  return title && isSteamFallbackTitle(game.title) ? { ...game, title } : game;
}

function homeWishlistCoverSources(game: GhostBoxGame) {
  return gameHeaderOnlySources(game);
}

function isStoredSteamWishlistRecommendationsFresh(
  steamId: string | undefined,
  recommendations: ReturnType<typeof readStoredSteamWishlistRecommendations>
) {
  return Boolean(
    steamId &&
      recommendations?.steamId === steamId &&
      recommendations.algorithmVersion === homeWishlistRecommendationAlgorithmVersion &&
      Date.parse(recommendations.expiresAt) > Date.now()
  );
}

function pickWishlistRecommendationCandidate(
  sourceGame: GhostBoxGame,
  candidates: GhostBoxGame[],
  excludedAppIds: Set<string>,
  userRecommendedTags: string[] = []
) {
  const sourceAppId = homeGameAppId(sourceGame);
  const sourceTraits = getWishlistRecommendationTraits(sourceGame);
  const userTraits = new Set(
    userRecommendedTags.map(normalizeWishlistRecommendationTrait).filter(Boolean)
  );

  return candidates
    .flatMap((candidate, index) => {
      const candidateAppId = homeGameAppId(candidate);
      if (!candidateAppId || candidateAppId === sourceAppId || excludedAppIds.has(candidateAppId)) {
        return [];
      }

      const candidateTraits = getWishlistRecommendationTraits(candidate);
      let sourceMatchScore = 0;
      let userMatchScore = 0;
      candidateTraits.forEach((trait) => {
        if (sourceTraits.has(trait)) sourceMatchScore += 1;
        if (userTraits.has(trait)) userMatchScore += 1;
      });

      const popularity = Math.log10(
        (candidate.recommendations ?? candidate.steamReviewCount ?? candidate.popularityScore ?? 0) + 1
      );
      const quality = candidate.steamPositiveRatio ?? candidate.rating ?? 0;
      const score = sourceMatchScore * 1000 + userMatchScore * 15 + quality * 10 + popularity;

      return [{ candidate, score, sourceMatchScore, index }];
    })
    .sort(
      (left, right) =>
        right.sourceMatchScore - left.sourceMatchScore ||
        right.score - left.score ||
        left.index - right.index
    )[0]
    ?.candidate;
}

function normalizeWishlistRecommendationTrait(value: string) {
  return normalizeHomeCategory(value).toLowerCase();
}

function getWishlistRecommendationTraits(game: GhostBoxGame) {
  return new Set(
    [...game.tags, ...game.genres]
      .map(normalizeWishlistRecommendationTrait)
      .filter(Boolean)
  );
}

function getSteamRecommendedTagName(tag: unknown) {
  if (!tag || typeof tag !== "object" || Array.isArray(tag)) return "";
  const record = tag as Record<string, unknown>;
  const value = record.name ?? record.tag_name ?? record.tagName;
  return typeof value === "string" ? normalizeHomeCategory(value) : "";
}

function normalizeSteamRecommendedTags(tags: unknown[]) {
  return [
    ...new Set(
      tags
        .map(getSteamRecommendedTagName)
        .filter(Boolean)
    ),
  ];
}

async function loadWishlistRecommendationForGame(
  sourceGame: GhostBoxGame,
  excludedAppIds: Set<string>,
  userRecommendedTags: string[] = []
) {
  const similarAppIds = await loadSteamSimilarAppIds(homeGameAppId(sourceGame)).catch(() => []);
  if (similarAppIds.length > 0) {
    const similarGames = (
      await Promise.all(
        similarAppIds.slice(0, 14).map((appId) =>
          loadGameStoreDetails(appId).catch(() => null)
        )
      )
    ).filter((game): game is GhostBoxGame => Boolean(game));
    const similarCandidate = pickWishlistRecommendationCandidate(
      sourceGame,
      similarGames,
      excludedAppIds,
      userRecommendedTags
    );
    if (similarCandidate) return similarCandidate;
  }

  const tagFilters = sourceGame.tags.filter(Boolean).slice(0, 3);
  const genreFilters = sourceGame.genres.filter(Boolean).slice(0, 3);
  const publisherFilters = sourceGame.publishers?.filter(Boolean).slice(0, 1) ?? [];
  const requests = [
    ...tagFilters.map((tag) => ({ tags: [tag] })),
    ...genreFilters.map((genre) => ({ genres: [genre] })),
    publisherFilters.length
      ? { publishers: publisherFilters }
      : null,
  ].filter(Boolean) as Array<NonNullable<Parameters<typeof loadGames>[0]>["filters"]>;

  for (const filters of requests) {
    const result = await loadGames({
      query: "",
      limit: 10,
      sort: "popular",
      filters,
    });
    const candidate = pickWishlistRecommendationCandidate(
      sourceGame,
      result.games,
      excludedAppIds,
      userRecommendedTags
    );
    if (candidate) return candidate;
  }

  const popularResult = await loadGames({
    query: "",
    limit: 30,
    sort: "popular",
  });
  const popularCandidate = pickWishlistRecommendationCandidate(
    sourceGame,
    popularResult.games,
    excludedAppIds,
    userRecommendedTags
  );
  if (popularCandidate) return popularCandidate;

  return null;
}

function isStoredHomePersonalCalendarFresh(
  calendar: StoredPersonalCalendar | null
): calendar is StoredPersonalCalendar {
  return Boolean(
    calendar &&
      calendar.gameIds.length === homePersonalCalendarGameCount &&
      Date.parse(calendar.expiresAt) > Date.now()
  );
}

function getUniqueCalendarPool(games: GhostBoxGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = homeGameKey(game);
    if (!key || seen.has(key) || /^Steam App \d+$/i.test(game.title.trim())) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function shuffleHomeCalendarGames(games: GhostBoxGame[]) {
  const shuffled = [...games];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}

function getHomeCalendarTraits(game: GhostBoxGame) {
  return new Set(
    [...game.genres, ...game.tags]
      .map((value) => normalizeHomeCategory(value).toLowerCase())
      .filter(Boolean)
  );
}

function getHomeCalendarOverlapScore(
  game: GhostBoxGame,
  selectedGames: GhostBoxGame[]
) {
  const traits = getHomeCalendarTraits(game);
  if (!traits.size) return 0;

  return selectedGames.slice(-6).reduce((score, selectedGame) => {
    const selectedTraits = getHomeCalendarTraits(selectedGame);
    let overlap = 0;
    traits.forEach((trait) => {
      if (selectedTraits.has(trait)) overlap += 1;
    });
    return score + overlap;
  }, 0);
}

function pickHomePersonalCalendarGames(
  games: GhostBoxGame[],
  recentGameIds: string[]
) {
  const recentIds = new Set(recentGameIds);
  const pool = getUniqueCalendarPool(games);
  const freshPool = pool.filter((game) => !recentIds.has(homeGameKey(game)));
  const availableGames = freshPool.length >= homePersonalCalendarGameCount
    ? freshPool
    : pool;
  const candidates = shuffleHomeCalendarGames(availableGames);
  const selectedGames: GhostBoxGame[] = [];

  while (
    selectedGames.length < homePersonalCalendarGameCount &&
    candidates.length > 0
  ) {
    const rankedCandidates = candidates
      .map((game, index) => ({
        game,
        index,
        score: getHomeCalendarOverlapScore(game, selectedGames),
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const nextCandidate = rankedCandidates[0];

    selectedGames.push(nextCandidate.game);
    candidates.splice(nextCandidate.index, 1);
  }

  return selectedGames;
}

function createHomePersonalCalendar(
  selectedGames: GhostBoxGame[],
  storedCalendar: StoredPersonalCalendar | null
): StoredPersonalCalendar {
  const now = Date.now();
  const selectedGameIds = selectedGames.map(homeGameKey);
  const recentGameIds = [
    ...selectedGameIds,
    ...(storedCalendar?.recentGameIds ?? []).filter(
      (gameId) => !selectedGameIds.includes(gameId)
    ),
  ].slice(0, homePersonalCalendarHistoryLimit);

  return {
    weekStart: new Date(now).toISOString(),
    expiresAt: new Date(now + homePersonalCalendarRefreshMs).toISOString(),
    gameIds: selectedGameIds,
    recentGameIds,
  };
}

async function loadHomePersonalCalendarPool() {
  const games: GhostBoxGame[] = [];
  let offset = 0;
  let expectedTotal: number | undefined;

  while (
    games.length < homePersonalCalendarPoolTarget &&
    (expectedTotal === undefined || offset < expectedTotal)
  ) {
    const result = await loadGames({
      query: "",
      limit: homePersonalCalendarPageSize,
      offset,
      sort: "popular",
    });
    games.push(...result.games);
    expectedTotal = result.matched || result.total || games.length;

    if (result.games.length < homePersonalCalendarPageSize) break;
    offset += homePersonalCalendarPageSize;
  }

  return getUniqueCalendarPool(games);
}

function HomeCategoryCard({
  game,
  imageVariant = "header",
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  imageVariant?: HomeCategoryImageVariant;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackCoverSources = useMemo(
    () =>
      imageVariant === "heroCapsule"
        ? gameHeroCapsuleSources(game)
        : gameHeaderOnlySources(game),
    [game, imageVariant]
  );
  const isHeroCapsule = imageVariant === "heroCapsule";
  const cachedSources = useCachedImageSources(fallbackCoverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);
  const layeredSources = coverSource
    ? [coverSource, ...fallbackCoverSources.filter((source) => source !== coverSource)]
    : fallbackCoverSources;

  return (
    <button
      type="button"
      className={`home-category-card ${
        isHeroCapsule ? "home-category-card--hero-capsule" : ""
      }`}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-category-card__cover${
          loaded ? " home-category-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
      <span className="home-category-card__content" aria-hidden="true">
        <strong>{game.title}</strong>
      </span>
    </button>
  );
}

function HomeCategorySection({
  title,
  games,
  className = "",
  imageVariant = "header",
  maxGames = 3,
  showCardContentAlways = false,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  className?: string;
  imageVariant?: HomeCategoryImageVariant;
  maxGames?: number;
  showCardContentAlways?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);
  const isHeroCapsule = imageVariant === "heroCapsule";

  return (
    <section
      className={`home-category${className ? ` ${className}` : ""}${
        showCardContentAlways ? " home-category--show-card-content" : ""
      }`}
      aria-label={title}
    >
      <h3 className="home-category__title">{title}</h3>
      <div
        className={`home-category__games ${
          isHeroCapsule ? "home-category__games--hero-capsule" : ""
        }`}
      >
        {Array.from({ length: maxGames }, (_, index) => {
          const game = visibleGames[index];
          return game ? (
            <HomeCategoryCard
              key={game.appId || game.id}
              game={game}
              imageVariant={imageVariant}
              onOpenGame={onOpenGame}
              onGameContextMenu={onGameContextMenu}
            />
          ) : (
            <span
              key={`placeholder-${index}`}
              className={`home-category-card home-category-card--empty ${
                isHeroCapsule ? "home-category-card--hero-capsule" : ""
              }`}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </section>
  );
}

function getPlainSteamText(value?: string) {
  if (!value) return "";

  return value
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getHomeShortDescription(game: GhostBoxGame, language: "pt" | "en") {
  const source =
    getPlainSteamText(game.shortDescription) ||
    game.subtitle ||
    game.genres.slice(0, 3).join(" • ");

  if (!source) {
    return language === "en"
      ? "Featured pick from the GhostBox catalogue."
      : "Destaque selecionado do catálogo GhostBox.";
  }

  return source.length > 150 ? `${source.slice(0, 147).trim()}...` : source;
}

function normalizeHomeCategory(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    acao: "Action",
    ação: "Action",
    action: "Action",
    aventura: "Adventure",
    adventure: "Adventure",
    historia: "Story Rich",
    história: "Story Rich",
    story: "Story Rich",
    "story rich": "Story Rich",
    terror: "Horror",
    horror: "Horror",
    corrida: "Racing",
    racing: "Racing",
    esportes: "Sports",
    sports: "Sports",
    estrategia: "Strategy",
    estratégia: "Strategy",
    strategy: "Strategy",
    exploracao: "Exploration",
    exploração: "Exploration",
    exploration: "Exploration",
  };

  return aliases[normalized.toLowerCase()] ?? normalized;
}

function getHomeCategoryLabel(value: string, language: "pt" | "en") {
  if (language === "en") return value;

  const labels: Record<string, string> = {
    Action: "Ação",
    Adventure: "Aventura",
    Anime: "Anime",
    Atmospheric: "Atmosférico",
    Casual: "Casual",
    "Co-op": "Co-op",
    Crime: "Crime",
    Exploration: "Exploração",
    Fantasy: "Fantasia",
    Horror: "Terror",
    Indie: "Indie",
    Multiplayer: "Multiplayer",
    Puzzle: "Puzzle",
    RPG: "RPG",
    Racing: "Corrida",
    "Sci-fi": "Sci-fi",
    Shooter: "Shooter",
    Simulation: "Simulação",
    Singleplayer: "Singleplayer",
    Sports: "Esportes",
    Strategy: "Estratégia",
    Story: "História",
    "Story Rich": "Boa trama",
    Survival: "Sobrevivência",
  };

  return labels[value] ?? value;
}

function gameCategoryScore(game: GhostBoxGame) {
  const reviewScore = game.steamPositiveRatio ?? game.rating ?? 0;
  const popularityScore = game.recommendations ?? game.steamReviewCount ?? 0;
  return reviewScore * 100 + Math.log10(popularityScore + 1);
}

function getHomeExploreCategories(games: GhostBoxGame[]) {
  const categoryMap = new Map<
    string,
    {
      filterKey: Extract<CatalogueFilterKey, "genres" | "tags">;
      filterValue: string;
      games: GhostBoxGame[];
      score: number;
    }
  >();

  games.forEach((game) => {
    const categories = [
      ...game.genres.map((value) => ({
        key: "genres" as const,
        value,
        normalized: normalizeHomeCategory(value),
      })),
      ...game.tags.map((value) => ({
        key: "tags" as const,
        value,
        normalized: normalizeHomeCategory(value),
      })),
    ].filter((category) => category.normalized);

    Array.from(
      new Map(categories.map((category) => [category.normalized, category])).values()
    ).forEach((category) => {
      const entry = categoryMap.get(category.normalized) ?? {
        filterKey: category.key,
        filterValue: category.normalized,
        games: [],
        score: 0,
      };
      if (entry.filterKey === "tags" && category.key === "genres") {
        entry.filterKey = category.key;
        entry.filterValue = category.normalized;
      }
      entry.games.push(game);
      entry.score += gameCategoryScore(game);
      categoryMap.set(category.normalized, entry);
    });
  });

  return Array.from(categoryMap, ([label, entry]) => ({
    label,
    filterKey: entry.filterKey,
    filterValue: entry.filterValue,
    games: getUniqueHomeGames(entry.games).sort(
      (a, b) => gameCategoryScore(b) - gameCategoryScore(a)
    ),
    score: entry.games.length * 1000 + entry.score / Math.max(entry.games.length, 1),
  }))
    .filter((category) => category.games.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function getUniqueHomeGames(games: GhostBoxGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = game.appId || game.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHomeExplorePreviewRows(
  categoryGames: GhostBoxGame[],
  _allGames: GhostBoxGame[]
) {
  const uniqueCategoryGames = getUniqueHomeGames(categoryGames);
  const previewGames = uniqueCategoryGames.slice(0, 18);
  const rows = [0, 1, 2].map((rowIndex) =>
    previewGames.filter((_, index) => index % 3 === rowIndex).slice(0, 6)
  );

  return rows.filter((row) => row.length > 0);
}

/**
 * Coalesces high-frequency callbacks (e.g. scroll handlers) to at most one
 * invocation per animation frame, so we never run setState more than once per
 * painted frame during a scroll gesture.
 */
function useRafThrottle(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      callbackRef.current();
    });
  }, []);
}

function HomeExploreCategoryImage({ game }: { game: GhostBoxGame }) {
  const sources = gameHeaderOnlySources(game);
  const cachedSources = useCachedImageSources(sources);
  const { source: imageSource } = useLoadableImageCover(cachedSources);

  return (
    <span
      className="home-explore-card__image"
      style={layeredImageStyle([imageSource, ...sources], "")}
      aria-hidden="true"
    />
  );
}

function HomeExploreCard({
  category,
  allGames,
  language,
  rootRef,
  onOpenCategory,
}: {
  category: HomeExploreCategory;
  allGames: GhostBoxGame[];
  language: "pt" | "en";
  rootRef: RefObject<HTMLDivElement | null>;
  onOpenCategory: (category: HomeExploreCategory) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  // Once a card scrolls into view we keep its images mounted so re-entering
  // the viewport never re-triggers the image-loading hooks.
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  const previewRows = useMemo(
    () => getHomeExplorePreviewRows(category.games, allGames),
    [category.games, allGames]
  );

  useEffect(() => {
    if (hasBeenVisible) return;
    const node = cardRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      {
        root: rootRef.current ?? null,
        // Preload one card-width ahead so images are ready before the card
        // fully enters the viewport.
        rootMargin: "0px 300px 0px 300px",
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible, rootRef]);

  return (
    <button
      ref={cardRef}
      type="button"
      className="home-explore-card"
      onClick={() => onOpenCategory(category)}
    >
      <span className="home-explore-card__images" aria-hidden="true">
        {hasBeenVisible &&
          previewRows.map((rowGames, rowIndex) => (
            <span
              key={`${category.label}-${rowIndex}`}
              className={`home-explore-card__image-row home-explore-card__image-row--${rowIndex + 1}`}
            >
              {[0, 1].map((setIndex) => (
                <span
                  key={`${category.label}-${rowIndex}-${setIndex}`}
                  className="home-explore-card__image-set"
                >
                  {rowGames.map((game) => (
                    <HomeExploreCategoryImage
                      key={`${game.appId || game.id}-${rowIndex}-${setIndex}`}
                      game={game}
                    />
                  ))}
                </span>
              ))}
            </span>
          ))}
      </span>
      <span className="home-explore-card__scrim" aria-hidden="true" />
      <span className="home-explore-card__label">
        {getHomeCategoryLabel(category.label, language)}
      </span>
    </button>
  );
}

function HomeExploreCategories({
  title,
  categories,
  allGames,
  language,
  onOpenCategory,
}: {
  title: string;
  categories: HomeExploreCategory[];
  allGames: GhostBoxGame[];
  language: "pt" | "en";
  onOpenCategory: (category: HomeExploreCategory) => void;
}) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const hasControls = categories.length > 5;
  const categoryOrderKey = categories.map((category) => category.label).join("|");

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollLeft = 0;
    setIsAtStart(true);
    setIsAtEnd(carousel.clientWidth >= carousel.scrollWidth - 2);
  }, [categoryOrderKey]);

  const handleScroll = useRafThrottle(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >=
      carousel.scrollWidth - 2
    );
  });

  if (!categories.length) return null;

  const scrollCategories = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className="home-explore" aria-label={title}>
      <div className="home-explore__header">
        <h3 className="home-explore__title">{title}</h3>
      </div>
      <div className="home-explore__rail">
        {hasControls && (
          <button
            type="button"
            className="home-explore__arrow home-explore__arrow--prev"
            aria-label={language === "en" ? "Previous categories" : "Categorias anteriores"}
            onClick={() => scrollCategories(-1)}
            style={{ visibility: isAtStart ? "hidden" : "visible" }}
          >
            <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
        <div className="home-explore__carousel" ref={carouselRef} onScroll={handleScroll}>
          <div className="home-explore__track">
            {categories.map((category) => (
              <HomeExploreCard
                key={category.label}
                category={category}
                allGames={allGames}
                language={language}
                rootRef={carouselRef}
                onOpenCategory={onOpenCategory}
              />
            ))}
          </div>
        </div>
        {hasControls && (
          <button
            type="button"
            className="home-explore__arrow home-explore__arrow--next"
            aria-label={language === "en" ? "Next categories" : "Próximas categorias"}
            onClick={() => scrollCategories(1)}
            style={{ visibility: isAtEnd ? "hidden" : "visible" }}
          >
            <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

function HomeCalendarGameCardComponent({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const coverSources = useCachedImageSources(gamePortraitSources(game));
  const { source: coverSource, loaded } = useLoadableImageCover(coverSources);
  const layeredSources = coverSource
    ? [coverSource, ...coverSources.filter((source) => source !== coverSource)]
    : coverSources;

  return (
    <button
      type="button"
      className="home-calendar-card"
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-calendar-card__cover${
          loaded ? " home-calendar-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
    </button>
  );
}

const HomeCalendarGameCard = memo(HomeCalendarGameCardComponent);

function HomePersonalCalendar({
  title,
  subtitle,
  games,
  language,
  loading,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle: string;
  games: GhostBoxGame[];
  language: "pt" | "en";
  loading: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const weekdays = getHomeCalendarDates();
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const gamesPerDay = 3;

  const updateCalendarScrollState = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsAtStart(carousel.scrollLeft <= 1);
    setIsAtEnd(
      carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2
    );
  };

  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollLeft = 0;
    updateCalendarScrollState();
    const frame = requestAnimationFrame(updateCalendarScrollState);

    return () => cancelAnimationFrame(frame);
  }, [games.length]);

  const handleScroll = useRafThrottle(updateCalendarScrollState);

  if (!games.length && !loading) return null;

  const scrollCalendar = (direction: -1 | 1) => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.scrollBy({
      left: direction * carousel.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className="home-calendar" aria-label={title}>
      <div className="home-calendar__header">
        <h3 className="home-calendar__title">{title}</h3>
        {subtitle && <span className="home-calendar__subtitle">{subtitle}</span>}
      </div>
      <div className="home-calendar__rail">
        <button
          type="button"
          className="home-calendar__arrow home-calendar__arrow--prev"
          aria-label={language === "en" ? "Previous calendar days" : "Dias anteriores"}
          onClick={() => scrollCalendar(-1)}
          style={{ visibility: isAtStart ? "hidden" : "visible" }}
        >
          <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <div className="home-calendar__carousel" ref={carouselRef} onScroll={handleScroll}>
          <div className="home-calendar__track">
            {weekdays.map((date, dayIndex) => {
              const dayGames = games.slice(
                dayIndex * gamesPerDay,
                dayIndex * gamesPerDay + gamesPerDay
              );

              return (
                <section className="home-calendar-day" key={date} aria-label={date}>
                  <h4 className="home-calendar-day__title">{date}</h4>
                  <div className="home-calendar-day__games">
                    {Array.from({ length: 3 }, (_, gameIndex) => {
                      const game = dayGames[gameIndex];
                      return game ? (
                        <HomeCalendarGameCard
                          key={homeGameKey(game)}
                          game={game}
                          onOpenGame={onOpenGame}
                          onGameContextMenu={onGameContextMenu}
                        />
                      ) : (
                        <span
                          key={`placeholder-${gameIndex}`}
                          className="home-calendar-card home-calendar-card--empty"
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="home-calendar__arrow home-calendar__arrow--next"
          aria-label={language === "en" ? "Next calendar days" : "Próximos dias"}
          onClick={() => scrollCalendar(1)}
          style={{ visibility: isAtEnd ? "hidden" : "visible" }}
        >
          <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function HomeRecommendedHero({
  title,
  games,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [exitingHeroLayer, setExitingHeroLayer] =
    useState<HomeRecommendedHeroLayer | null>(null);
  const [isExitingHeroLayerVisible, setIsExitingHeroLayerVisible] =
    useState(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTokenRef = useRef(0);
  const game = games[activeIndex] ?? games[0];
  const heroSources = useMemo(() => homeRecommendedHeroSources(game), [game]);
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const canNavigate = games.length > 1;
  const readyHeroSource = cachedSources.find((source) =>
    loadedImageSources.has(source)
  );
  const heroBackgroundSources = readyHeroSource
    ? [readyHeroSource]
    : heroSource
      ? [heroSource]
      : heroSources.slice(0, 1);
  const heroBackgroundSource = heroBackgroundSources[0] ?? "";
  const heroBackgroundPosition =
    homeRecommendedHeroPositions[activeIndex] ?? "center top";

  useEffect(() => {
    if (activeIndex <= games.length - 1) return;
    setActiveIndex(Math.max(games.length - 1, 0));
  }, [activeIndex, games.length]);

  useEffect(() => {
    return () => {
      selectionTokenRef.current += 1;
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);
      if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!canNavigate) return;

    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    prefetchTimeoutRef.current = setTimeout(() => {
      const nextIndex = (activeIndex + 1) % games.length;
      const previousIndex = (activeIndex - 1 + games.length) % games.length;
      void preloadHomeRecommendedHero(homeRecommendedHeroSources(games[nextIndex]));
      void preloadHomeRecommendedHero(homeRecommendedHeroSources(games[previousIndex]));
    }, 250);

    return () => {
      if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    };
  }, [activeIndex, canNavigate, games]);

  function selectRecommendedHero(nextIndex: number) {
    if (nextIndex === activeIndex || isTransitioning) return;

    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    if (transitionFrameRef.current) cancelAnimationFrame(transitionFrameRef.current);

    const selectionToken = selectionTokenRef.current + 1;
    selectionTokenRef.current = selectionToken;
    setIsTransitioning(true);
    void preloadHomeRecommendedHero(homeRecommendedHeroSources(games[nextIndex]));

    if (heroBackgroundSource) {
      setExitingHeroLayer({
        source: heroBackgroundSource,
        position: heroBackgroundPosition,
      });
      setIsExitingHeroLayerVisible(true);
    }

    setActiveIndex(nextIndex);
    transitionFrameRef.current = requestAnimationFrame(() => {
      if (selectionTokenRef.current !== selectionToken) return;
      setIsExitingHeroLayerVisible(false);

      transitionTimeoutRef.current = setTimeout(() => {
        if (selectionTokenRef.current !== selectionToken) return;
        setExitingHeroLayer(null);
        setIsTransitioning(false);
      }, homeRecommendedHeroFadeMs);
    });
  }

  function moveRecommendedHero(direction: -1 | 1) {
    if (!canNavigate) return;
    selectRecommendedHero((activeIndex + direction + games.length) % games.length);
  }

  if (!game) return null;

  return (
    <section className="home-recommended" aria-label={title}>
      <div
        className={`home-recommended-hero${
          isTransitioning ? " home-recommended-hero--transitioning" : ""
        }`}
        onContextMenu={(event) => {
          if (!onGameContextMenu) return;
          event.preventDefault();
          onGameContextMenu(game, event.clientX, event.clientY);
        }}
      >
        <span
          className={`home-recommended-hero__cover${
            loaded ? " home-recommended-hero__cover--loaded" : ""
          }`}
          aria-hidden="true"
        >
          {heroBackgroundSource && (
            <img
              src={heroBackgroundSource}
              alt=""
              decoding="async"
              draggable={false}
              style={{ objectPosition: heroBackgroundPosition }}
            />
          )}
        </span>
        {exitingHeroLayer && (
          <span
            className={`home-recommended-hero__cover home-recommended-hero__cover--exiting${
              isExitingHeroLayerVisible
                ? " home-recommended-hero__cover--exiting-visible"
                : ""
            }`}
            aria-hidden="true"
          >
            <img
              src={exitingHeroLayer.source}
              alt=""
              decoding="async"
              draggable={false}
              style={{ objectPosition: exitingHeroLayer.position }}
            />
          </span>
        )}
        <span className="home-recommended-hero__shade" aria-hidden="true" />
        <span className="home-recommended-hero__info">
          <span className="home-recommended-hero__info-text">
            <h2 className="home-recommended-hero__title">{game.title}</h2>
            {(game.publishers?.[0] || game.developers?.[0]) && (
              <span className="home-recommended-hero__publisher">
                {game.publishers?.[0] || game.developers?.[0]}
              </span>
            )}
            <span className="home-recommended-hero__tags">
              {[...game.genres, ...game.tags]
                .filter(Boolean)
                .filter((tag, i, arr) => arr.indexOf(tag) === i)
                .slice(0, 4)
                .map((tag) => (
                  <span key={tag} className="home-recommended-hero__tag">
                    {tag}
                  </span>
                ))}
            </span>
          </span>
          <span className="home-recommended-hero__actions">
            <button
              type="button"
              className="home-recommended-hero__btn home-recommended-hero__btn--details"
              onClick={(event) => {
                event.stopPropagation();
                onOpenGame(game);
              }}
            >
              {language === "en" ? "See details" : "Ver detalhes"}
            </button>
          </span>
        </span>
        {canNavigate && (
          <>
            <span className="home-recommended-hero__pills" aria-label={language === "en" ? "Select featured game" : "Selecionar jogo em destaque"}>
              {games.map((item, index) => (
                <button
                  key={item.appId || item.id}
                  type="button"
                  className={`home-recommended-hero__pill${
                    index === activeIndex ? " home-recommended-hero__pill--active" : ""
                  }`}
                  aria-label={item.title}
                  aria-current={index === activeIndex ? "true" : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectRecommendedHero(index);
                  }}
                />
              ))}
            </span>
            <button
              type="button"
              className="home-recommended-hero__arrow home-recommended-hero__arrow--prev"
              aria-label={language === "en" ? "Previous game" : "Jogo anterior"}
              onClick={(event) => {
                event.stopPropagation();
                moveRecommendedHero(-1);
              }}
            >
              <ChevronLeft size={30} strokeWidth={2.1} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="home-recommended-hero__arrow home-recommended-hero__arrow--next"
              aria-label={language === "en" ? "Next game" : "Próximo jogo"}
              onClick={(event) => {
                event.stopPropagation();
                moveRecommendedHero(1);
              }}
            >
              <ChevronRight size={30} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function HomeWishlistPlayerReview({
  game,
  language,
}: {
  game: GhostBoxGame;
  language: "pt" | "en";
}) {
  const [review, setReview] = useState<SteamGameReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const appId = homeGameAppId(game);
    if (!appId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setReview(null);

    const timeout = window.setTimeout(() => {
      void loadGameReviews(
        appId,
        language === "en" ? "english" : "brazilian",
        "positive"
      )
        .then((result) => {
          if (cancelled) return;
          setReview(result.reviews?.find((item) => item.review.trim()) ?? null);
        })
        .catch(() => {
          if (!cancelled) setReview(null);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [game, language]);

  if (isLoading) {
    return (
      <span
        className="home-wishlist-card__player-review home-wishlist-card__player-review--skeleton"
        aria-hidden="true"
      >
        <span className="home-wishlist-card__player-review-quote-skeleton">
          <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review" />
          <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review" />
          <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review-short" />
        </span>
        <span className="home-wishlist-card__player-review-author">
          <span className="home-wishlist-card__player-review-avatar home-wishlist-card__player-review-avatar--skeleton" />
          <span className="home-wishlist-card__player-review-author-skeleton">
            <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--author-name" />
            <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--author-meta" />
          </span>
        </span>
      </span>
    );
  }

  if (!review) return null;

  const avatarUrl = steamReviewAvatarUrl(review.author.avatar);
  const authorName = review.author.personaname || "Steam user";
  const playtimeAtReview = review.author.playtime_at_review ?? 0;
  const reviewText = normalizeSteamReviewText(review.review);
  if (!reviewText) return null;

  return (
    <span className="home-wishlist-card__player-review">
      <span className="home-wishlist-card__player-review-quote">
        "{reviewText}"
      </span>
      <span className="home-wishlist-card__player-review-author">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="home-wishlist-card__player-review-avatar" />
        )}
        <span>
          <strong>{authorName}</strong>
          <small>
            {formatCompactPlaytime(playtimeAtReview * 60_000)} {language === "en" ? "at review" : "no momento da review"}
          </small>
        </span>
      </span>
    </span>
  );
}

function HomeWishlistCardComponent({
  recommendation,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  recommendation: HomeWishlistRecommendation;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const { sourceGame, recommendedGame } = recommendation;
  const coverSources = homeWishlistCoverSources(recommendedGame);
  const sources = useCachedImageSources(coverSources);
  const { source: imageSource, loaded } = useLoadableImageCover(sources);
  const screenshots = useMemo(
    () => withoutHeaderImageSources(recommendedGame.screenshots ?? []).slice(0, 6),
    [recommendedGame.screenshots]
  );
  const [isHovered, setIsHovered] = useState(false);
  const [screenshotIndex, setScreenshotIndex] = useState(0);
  const screenshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isHovered || screenshots.length === 0) {
      if (screenshotTimerRef.current) {
        clearInterval(screenshotTimerRef.current);
        screenshotTimerRef.current = null;
      }
      return;
    }

    setScreenshotIndex(0);

    // Preload the rotating screenshots off the critical path so creating the
    // Image() probes never competes with the hover interaction itself.
    const preloaded: HTMLImageElement[] = [];
    const preload = () => {
      screenshots.forEach((source) => {
        const img = new Image();
        img.decoding = "async";
        img.src = source;
        preloaded.push(img);
      });
    };
    const idleHandle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(preload)
        : window.setTimeout(preload, 0);

    screenshotTimerRef.current = setInterval(() => {
      setScreenshotIndex((current) => (current + 1) % screenshots.length);
    }, 1400);

    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle as number);
      } else {
        window.clearTimeout(idleHandle as number);
      }
      if (screenshotTimerRef.current) {
        clearInterval(screenshotTimerRef.current);
        screenshotTimerRef.current = null;
      }
    };
  }, [isHovered, screenshots]);

  const sourceTitle = getDisplayGameTitle(sourceGame, "");
  const recommendedTitle = getDisplayGameTitle(
    recommendedGame,
    language === "en" ? "Steam recommendation" : "Recomendação da Steam"
  );
  const reasonPrefix = language === "en" ? "Because" : "Já que";
  const reasonSuffix =
    language === "en" ? "is on your wishlist" : "está na sua lista de desejos";
  const unresolvedReason =
    language === "en"
      ? "Based on your Steam wishlist"
      : "Baseado na sua lista de desejos da Steam";
  const tags = [...recommendedGame.tags, ...recommendedGame.genres]
    .filter(Boolean)
    .slice(0, 4);

  const handleClick = () => onOpenGame(recommendedGame);
  const handleContextMenu = (event: React.MouseEvent) => {
    if (!onGameContextMenu) return;
    event.preventDefault();
    onGameContextMenu(recommendedGame, event.clientX, event.clientY);
  };

  return (
    <div className="home-wishlist-card">
      <span className="home-wishlist-card__content">
        <strong
          className="home-wishlist-card__title"
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleClick();
            }
          }}
        >
          {recommendedTitle}
        </strong>
        {sourceTitle ? (
          <span className="home-wishlist-card__reason">
            {reasonPrefix}{" "}
            <span className="home-wishlist-card__reason-game">{sourceTitle}</span>{" "}
            {reasonSuffix}
          </span>
        ) : (
          <span className="home-wishlist-card__reason">{unresolvedReason}</span>
        )}
      </span>
      <span className="home-wishlist-card__media home-wishlist-card__media--single">
        <span
          className={`home-wishlist-card__cover${loaded ? " home-wishlist-card__cover--loaded" : ""}`}
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleClick();
            }
          }}
        >
          {imageSource && <img src={imageSource} alt="" draggable={false} />}
          {screenshots.map((source, index) => (
            <img
              key={source}
              className={`home-wishlist-card__screenshot${
                isHovered && index === screenshotIndex
                  ? " home-wishlist-card__screenshot--active"
                  : ""
              }`}
              src={source}
              alt=""
              draggable={false}
              decoding="async"
              loading="lazy"
            />
          ))}
        </span>
        <span className="home-wishlist-card__details">
          <HomeWishlistPlayerReview game={recommendedGame} language={language} />
          {tags.length > 0 && (
            <span className="home-wishlist-card__tags">
              {tags.map((tag) => (
                <span key={tag} className="home-wishlist-card__tag">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

const HomeWishlistCard = memo(HomeWishlistCardComponent);

function HomeWishlistRecommendations({
  title,
  recommendations,
  loading,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  recommendations: HomeWishlistRecommendation[];
  loading: boolean;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRecommendations = expanded
    ? recommendations
    : recommendations.slice(0, 3);
  const hiddenCount = Math.max(0, recommendations.length - visibleRecommendations.length);

  useEffect(() => {
    setExpanded(false);
  }, [recommendations.length]);

  if (!recommendations.length && !loading) return null;

  return (
    <section className="home-wishlist" aria-label={title}>
      <div className="home-wishlist__header">
        <h3 className="home-wishlist__title">{title}</h3>
      </div>
      <div className="home-wishlist__list">
        {loading && recommendations.length === 0
          ? Array.from({ length: 3 }, (_, index) => (
              <span
                key={`wishlist-skeleton-${index}`}
                className="home-wishlist-card home-wishlist-card--skeleton"
                aria-hidden="true"
              >
                <span className="home-wishlist-card__content">
                  <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--title" />
                  <span className="home-wishlist-card__text-skeleton" />
                </span>
                <span className="home-wishlist-card__media home-wishlist-card__media--single">
                  <span className="home-wishlist-card__cover home-wishlist-card__cover--skeleton" />
                  <span className="home-wishlist-card__details">
                    <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review" />
                    <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review-short" />
                    <span className="home-wishlist-card__tag-skeleton-row">
                      {Array.from({ length: 4 }, (_, tagIndex) => (
                        <span
                          key={`wishlist-skeleton-tag-${index}-${tagIndex}`}
                          className="home-wishlist-card__tag-skeleton"
                        />
                      ))}
                    </span>
                  </span>
                </span>
              </span>
            ))
          : visibleRecommendations.map((recommendation) => (
              <HomeWishlistCard
                key={`${homeGameAppId(recommendation.sourceGame)}-${homeGameAppId(
                  recommendation.recommendedGame
                )}`}
                recommendation={recommendation}
                language={language}
                onOpenGame={onOpenGame}
                onGameContextMenu={onGameContextMenu}
              />
            ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="home-wishlist__more"
            onClick={() => setExpanded(true)}
          >
            {language === "en" ? `See more (${hiddenCount})` : `Ver mais (${hiddenCount})`}
          </button>
        )}
      </div>
    </section>
  );
}

function HomeRecentBanner({
  title,
  game,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  game: GhostBoxGame | undefined;
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackHeroSource = game
    ? homeSteamCdnUrl(homeGameAppId(game), "library_hero.jpg")
    : "";
  const heroSources = fallbackHeroSource ? [fallbackHeroSource] : [];
  const cachedSources = useCachedImageSources(heroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const achievementTotal = game?.achievements.total ?? 0;
  const achievementUnlocked = Math.min(
    game?.achievements.unlocked ?? 0,
    achievementTotal
  );
  const achievementProgress =
    achievementTotal > 0
      ? Math.round((achievementUnlocked / achievementTotal) * 100)
      : 0;

  if (!game) {
    return (
      <section className="home-recent-banner" aria-label={title}>
        <h3 className="home-recent-banner__heading">{title}</h3>
        <div className="home-recent-banner__card home-recent-banner__card--skeleton" aria-hidden="true">
          <span className="home-recent-banner__cover home-recent-banner__cover--skeleton" />
          <span className="home-recent-banner__content home-recent-banner__content--skeleton">
            <strong className="home-recent-banner__title home-recent-banner__title--skeleton">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--title" />
            </strong>
            <span className="home-recent-banner__description home-recent-banner__description--skeleton">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--desc" />
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--desc home-recent-banner__skeleton-line--desc-short" />
            </span>
            <span className="home-recent-banner__meta" aria-hidden="true">
              <small className="home-recent-banner__meta-item">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
              </small>
              <small className="home-recent-banner__meta-item home-recent-banner__meta-item--playtime">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
                <span className="home-recent-banner__meta-copy">
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
                </span>
              </small>
              <small className="home-recent-banner__meta-item home-recent-banner__meta-item--achievements">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
                <span className="home-recent-banner__meta-copy">
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                  <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
                </span>
              </small>
            </span>
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="home-recent-banner" aria-label={title}>
      <h3 className="home-recent-banner__heading">{title}</h3>
      <div
        className="home-recent-banner__card"
        role="button"
        tabIndex={0}
        onClick={() => onOpenGame(game)}
        onContextMenu={(event) => {
          if (!onGameContextMenu) return;
          event.preventDefault();
          onGameContextMenu(game, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpenGame(game);
        }}
      >
        <span
          className={`home-recent-banner__cover${
            loaded ? " home-recent-banner__cover--loaded" : ""
          }`}
          style={layeredImageStyle([heroSource, fallbackHeroSource], "")}
          aria-hidden="true"
        />
        <span className="home-recent-banner__content">
          <strong className="home-recent-banner__title">{game.title}</strong>
          <span className="home-recent-banner__description">
            {getHomeShortDescription(game, language)}
          </span>
          <span className="home-recent-banner__meta">
            <small className="home-recent-banner__meta-item">
              <span className="home-recent-banner__meta-label">
                {language === "en" ? "Last session" : "Última sessão"}
              </span>
              <span className="home-recent-banner__meta-value">
                {formatLastSessionDate(game.lastTimePlayed, language)}
              </span>
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--playtime">
              <Clock
                className="home-recent-banner__meta-icon"
                size={26}
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__meta-label">
                  {language === "en" ? "Playtime" : "Tempo de jogo"}
                </span>
                <span className="home-recent-banner__meta-value">
                  {game.playTimeInMilliseconds
                    ? formatCompactPlaytime(game.playTimeInMilliseconds)
                    : language === "en"
                      ? "Recently played"
                      : "Jogado recentemente"}
                </span>
              </span>
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--achievements">
              <Trophy
                className="home-recent-banner__meta-icon"
                size={28}
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__meta-label">
                  {language === "en" ? "Achievements" : "Conquistas"}
                </span>
                <span className="home-recent-banner__meta-value home-recent-banner__meta-value--achievements">
                  {achievementTotal > 0
                    ? `${achievementUnlocked}/${achievementTotal} ${
                        language === "en" ? "unlocked" : "alcançadas"
                      } (${achievementProgress}%)`
                    : language === "en"
                      ? "No achievements"
                      : "Sem conquistas"}
                </span>
                <span
                  className="home-recent-banner__achievement-track"
                  aria-hidden="true"
                >
                  <span style={{ width: `${achievementProgress}%` }} />
                </span>
              </span>
            </small>
          </span>
        </span>
      </div>
    </section>
  );
}

export function HomePage({
  onOpenGame,
  favoriteGameIds,
  libraryGameAppIds,
  removableGameAppIds,
  playableGameAppIds,
  addingGameId,
  launchingGameId,
  userCollections,
  onToggleFavorite,
  onAddGame,
  onPlayGame,
  onRemoveGame,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  onOpenCatalogueCategory,
  profileHistoryGames,
  steamProfile,
}: {
  onOpenGame: (game: GhostBoxGame) => void;
  favoriteGameIds: Set<string>;
  libraryGameAppIds: Set<string>;
  removableGameAppIds: Set<string>;
  playableGameAppIds: Set<string>;
  addingGameId: string | null;
  launchingGameId: string | null;
  userCollections: UserCollection[];
  onToggleFavorite: (game: GhostBoxGame) => void;
  onAddGame: (game: GhostBoxGame) => void;
  onPlayGame: (game: GhostBoxGame) => void;
  onRemoveGame: (game: GhostBoxGame) => void;
  onAddGameToCollection: (game: GhostBoxGame, collectionId: string) => void;
  onRemoveGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
  profileHistoryGames: GhostBoxGame[];
  steamProfile: SteamProfile | null;
}) {
  const { appearance, t } = useSettings();
  const [homeTopReviewedGames, setHomeTopReviewedGames] = useState<GhostBoxGame[]>(
    () =>
      topReviewedSteamGames.map((game, index) =>
        createHomeSeedFallbackGame(game, index)
      )
  );
  const [homeFeaturedGames, setHomeFeaturedGames] = useState<GhostBoxGame[]>(() =>
    homeFeaturedSteamGames.map((game, index) =>
      createHomeSeedFallbackGame(game, index, "")
    )
  );
  const [storedPersonalCalendar] = useState<StoredPersonalCalendar | null>(() =>
    readStoredPersonalCalendar()
  );
  const [personalCalendarGames, setPersonalCalendarGames] = useState<GhostBoxGame[]>([]);
  const [isLoadingPersonalCalendar, setIsLoadingPersonalCalendar] = useState(false);
  const [wishlistRecommendations, setWishlistRecommendations] = useState<HomeWishlistRecommendation[]>([]);
  const [isLoadingWishlistRecommendations, setIsLoadingWishlistRecommendations] = useState(false);
  const [homeContextMenu, setHomeContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

  // Stable identity so memoized cards (e.g. HomeCalendarGameCard) don't
  // re-render whenever HomePage re-renders.
  const handleGameContextMenu = useCallback(
    (gameItem: GhostBoxGame, x: number, y: number) =>
      setHomeContextMenu({ game: gameItem, x, y }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function loadGameRange(
      games: HomeGameSeed[],
      start: number,
      end: number,
      updateFn: (results: GhostBoxGame[], offset: number) => void
    ) {
      if (cancelled || start >= end) return;

      const batch = games.slice(start, end);

      const results = await Promise.all(
        batch.map(async (game, index) => {
          const detailed = await loadGameStoreDetails(game.appId).catch(
            () => null
          );
          if (!detailed) return createHomeSeedFallbackGame(game, start + index);
          const enriched =
            game.shortDescription && !detailed.shortDescription
              ? { ...detailed, shortDescription: game.shortDescription }
              : detailed;
          if (/^Steam \d+$/.test(detailed.title) && game.title) {
            return { ...enriched, title: game.title };
          }
          return enriched;
        })
      );

      if (!cancelled) updateFn(results, start);
    }

    void loadGameRange(
      topReviewedSteamGames,
      0,
      homeCarouselGroupSize,
      (results, offset) => {
        setHomeTopReviewedGames((current) => {
          const next = [...current];
          results.forEach((game, index) => {
            next[offset + index] = game;
          });
          return next;
        });
      }
    );

    void loadGameRange(
      homeFeaturedSteamGames,
      0,
      homeFeaturedSteamGames.length,
      (results, offset) => {
        setHomeFeaturedGames((current) => {
          const next = [...current];
          results.forEach((game, index) => {
            next[offset + index] = game;
          });
          return next;
        });
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPersonalCalendar() {
      setIsLoadingPersonalCalendar(true);

      try {
        const pool = await loadHomePersonalCalendarPool();
        if (cancelled) return;

        const gameById = new Map<string, GhostBoxGame>();
        pool.forEach((game) => {
          gameById.set(homeGameKey(game), game);
          gameById.set(game.id, game);
        });

        if (isStoredHomePersonalCalendarFresh(storedPersonalCalendar)) {
          const storedGames = storedPersonalCalendar.gameIds.flatMap((gameId) => {
            const game = gameById.get(gameId);
            return game ? [game] : [];
          });

          if (storedGames.length === homePersonalCalendarGameCount) {
            setPersonalCalendarGames(storedGames);
            return;
          }
        }

        const selectedGames = pickHomePersonalCalendarGames(
          pool,
          storedPersonalCalendar?.recentGameIds ?? []
        );

        if (!selectedGames.length) {
          setPersonalCalendarGames([]);
          return;
        }

        const nextCalendar = createHomePersonalCalendar(
          selectedGames,
          storedPersonalCalendar
        );
        writeStoredPersonalCalendar(nextCalendar);
        setPersonalCalendarGames(selectedGames);
      } finally {
        if (!cancelled) setIsLoadingPersonalCalendar(false);
      }
    }

    void loadPersonalCalendar();

    return () => {
      cancelled = true;
    };
  }, [storedPersonalCalendar]);

  useEffect(() => {
    let cancelled = false;

    async function loadWishlistRecommendations() {
      if (!steamProfile?.steamId) {
        setWishlistRecommendations([]);
        return;
      }
      setIsLoadingWishlistRecommendations(true);

      try {
        const storedWishlistRecommendations = readStoredSteamWishlistRecommendations();
        const hasFreshStoredWishlistRecommendations =
          isStoredSteamWishlistRecommendationsFresh(
            steamProfile.steamId,
            storedWishlistRecommendations
          );
        const freshStoredWishlistRecommendations = hasFreshStoredWishlistRecommendations
          ? storedWishlistRecommendations
          : null;
        let didUseStoredWishlistRecommendations = false;

        if (freshStoredWishlistRecommendations) {
          const cachedPairs = (freshStoredWishlistRecommendations.recommendationPairs ?? [])
            .filter(
              (pair) =>
                pair.sourceAppId &&
                pair.recommendedAppId &&
                !libraryGameAppIds.has(pair.recommendedAppId)
          );
          if (cachedPairs.length > 0) {
            const cachedRecommendations = await Promise.all(
              cachedPairs.map(async (pair, index) => ({
                sourceGame: await loadWishlistDisplayGame(
                  pair.sourceAppId,
                  index,
                  pair.sourceTitle
                ),
                recommendedGame: await loadWishlistDisplayGame(
                  pair.recommendedAppId,
                  index,
                  pair.recommendedTitle
                ),
              }))
            );
            if (cancelled) return;
            setWishlistRecommendations(cachedRecommendations);
            didUseStoredWishlistRecommendations = cachedRecommendations.length > 0;
          } else {
            const cachedAppIds = freshStoredWishlistRecommendations.gameIds.filter(
              (appId) => appId && !libraryGameAppIds.has(appId)
            );
            if (cachedAppIds.length > 1) {
              const sourceGame = await loadWishlistDisplayGame(cachedAppIds[0], 0);
              const cachedRecommendations = await Promise.all(
                cachedAppIds.slice(1).map(async (appId, index) => ({
                  sourceGame,
                  recommendedGame: await loadWishlistDisplayGame(appId, index + 1),
                }))
              );
              if (cancelled) return;
              setWishlistRecommendations(cachedRecommendations);
              didUseStoredWishlistRecommendations = cachedRecommendations.length > 0;
            }
          }
        }

        if (hasFreshStoredWishlistRecommendations && didUseStoredWishlistRecommendations) {
          return;
        }

        const wishlistItems = await loadSteamWishlist(steamProfile.steamId);
        if (cancelled) return;

        const newAppIds = getUniqueWishlistAppIds(wishlistItems, libraryGameAppIds);
        const wishlistTitleByAppId = new Map(
          wishlistItems.flatMap((item) => {
            const title = item.title?.trim();
            return title ? [[item.appId, title] as const] : [];
          })
        );

        if (newAppIds.length === 0) {
          setWishlistRecommendations([]);
          return;
        }

        const userRecommendedTags = normalizeSteamRecommendedTags(
          await loadSteamRecommendedTagsForUser(steamProfile.steamId).catch(() => [])
        );

        let wishlistGames = createWishlistFallbackGames(newAppIds, wishlistTitleByAppId);

        for (
          let offset = 0;
          offset < Math.min(newAppIds.length, homeWishlistRecommendationSourceLimit);
          offset += homeWishlistDetailsBatchSize
        ) {
          const batchAppIds = newAppIds.slice(
            offset,
            Math.min(offset + homeWishlistDetailsBatchSize, homeWishlistRecommendationSourceLimit)
          );
          const detailedGames = await Promise.all(
            batchAppIds.map(async (appId, index) => {
              const game = await loadGameStoreDetails(appId).catch(() => null);
              return game ?? wishlistGames[offset + index];
            })
          );

          if (cancelled) return;
          wishlistGames = [...wishlistGames];
          detailedGames.forEach((game, index) => {
            wishlistGames[offset + index] = game;
          });
        }

        const excludedAppIds = new Set([...newAppIds, ...libraryGameAppIds]);
        const nextRecommendations: HomeWishlistRecommendation[] = [];

        for (const sourceGame of wishlistGames.slice(0, homeWishlistRecommendationSourceLimit)) {
          const recommendedGame = await loadWishlistRecommendationForGame(
            sourceGame,
            excludedAppIds,
            userRecommendedTags
          );
          if (cancelled) return;
          if (!recommendedGame) continue;

          excludedAppIds.add(homeGameAppId(recommendedGame));
          nextRecommendations.push({ sourceGame, recommendedGame });
          setWishlistRecommendations([...nextRecommendations]);
        }

        writeStoredSteamWishlistRecommendations({
          steamId: steamProfile.steamId,
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          algorithmVersion: homeWishlistRecommendationAlgorithmVersion,
          gameIds: nextRecommendations.map(({ recommendedGame }) =>
            homeGameAppId(recommendedGame)
          ),
          recommendationPairs: nextRecommendations.map(
            ({ sourceGame, recommendedGame }) => ({
              sourceAppId: homeGameAppId(sourceGame),
              sourceTitle: getDisplayGameTitle(sourceGame, ""),
              recommendedAppId: homeGameAppId(recommendedGame),
              recommendedTitle: getDisplayGameTitle(recommendedGame, ""),
            })
          ),
        });
      } finally {
        if (!cancelled) setIsLoadingWishlistRecommendations(false);
      }
    }

    void loadWishlistRecommendations();

    return () => {
      cancelled = true;
    };
  }, [steamProfile?.steamId, libraryGameAppIds]);

  const homeVisibleGames = useMemo(() => {
    return homeTopReviewedGames.slice(0, homeCarouselGroupSize);
  }, [homeTopReviewedGames]);
  const featuredGames = homeFeaturedGames;
  const enrichedPersonalCalendarGames = useEnrichedGameCards(
    personalCalendarGames,
    homePersonalCalendarEnrichmentLimit
  );
  const exploreCategories = useMemo(() => {
    return getHomeExploreCategories([...homeTopReviewedGames, ...homeFeaturedGames]);
  }, [homeTopReviewedGames, homeFeaturedGames]);
  const homeRecentPlayedGame = useMemo(() => {
    return [...profileHistoryGames]
      .filter(hasCompletedPlaySession)
      .sort((left, right) => getLastPlayedTime(right) - getLastPlayedTime(left))[0];
  }, [profileHistoryGames]);

  const homeContextMenuItems = useCollectionContextMenu({
    game: homeContextMenu?.game ?? null,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onOpenGame,
    onToggleFavorite,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  });

  return (
    <section className="home-page" aria-label={t("home.pageAria")}>
      <HomeRecommendedHero
        title={t("home.recommended")}
        games={homeVisibleGames}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <div className="home-categories" aria-label={t("home.categoriesAria")}>
        <HomeCategorySection
          title={t("home.featuredGames")}
          games={featuredGames}
          className="home-category--featured"
          maxGames={6}
          onOpenGame={onOpenGame}
          onGameContextMenu={handleGameContextMenu}
        />
      </div>
      <HomeExploreCategories
        title={appearance.language === "en" ? "Explore by category" : "Explore por categoria"}
        categories={exploreCategories}
        allGames={[...homeTopReviewedGames, ...homeFeaturedGames]}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
      />
      <HomePersonalCalendar
        title={appearance.language === "en" ? "Personal calendar" : "Calendário pessoal"}
        subtitle=""
        games={enrichedPersonalCalendarGames}
        language={appearance.language}
        loading={isLoadingPersonalCalendar}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeWishlistRecommendations
        title={appearance.language === "en" ? "From your Steam wishlist" : "Da sua wishlist da Steam"}
        recommendations={wishlistRecommendations}
        loading={isLoadingWishlistRecommendations}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeRecentBanner
        title={t("home.recentSection")}
        game={homeRecentPlayedGame}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      {homeContextMenu && homeContextMenuItems.length > 0 && (
        <ContextMenu
          x={homeContextMenu.x}
          y={homeContextMenu.y}
          items={homeContextMenuItems}
          onClose={() => setHomeContextMenu(null)}
        />
      )}
    </section>
  );
}
