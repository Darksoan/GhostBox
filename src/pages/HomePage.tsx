import { ChevronDown } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GhostBoxGame } from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { CatalogueFilterKey, SteamProfile, SteamWishlistItem } from "../types";
import { loadGames, loadGameReviews, loadGameStoreDetails, loadSteamRecommendedTagsForUser, loadSteamSimilarAppIds, loadSteamWishlist } from "../data";
import { ContextMenu } from "../components/ui/ContextMenu";
import {
  HomeWishlistCardSkeleton,
  HomeWishlistReviewSkeleton,
} from "../components/ui/LoadingStates";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Shelf } from "../components/ui/Shelf";
import { useSettings } from "../context/settings";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
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
  readStoredSteamWishlistReview,
  writeStoredSteamWishlistReview,
  type StoredPersonalCalendar,
} from "../utils/storage";
import {
  gameHeaderOnlySources,
  gameHeroSources,
  gameHeroCapsuleSources,
  layeredImageStyle,
  withoutHeaderImageSources,
} from "../utils/image";
import { loadedImageSources, runWhenIdle } from "../utils/imageCache";
import { createSeedGame, type GameSeed } from "../utils/gameSeed";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";
import { formatCompactPlaytime } from "../utils/time";
import {
  createPersonalCalendar,
  getPersonalCalendarCycleStart,
  getPersonalCalendarDates,
  getUniquePersonalCalendarPool,
  isStoredPersonalCalendarFresh,
  personalCalendarGameKey,
  pickPersonalCalendarGames,
} from "../utils/personalCalendar";

type HomeGameSeed = GameSeed;

type HomeCategoryCardVariant = "tile" | "portrait";

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
    appId: "1030300",
    title: "Hollow Knight: Silksong",
    shortDescription:
      "Explore a haunted kingdom in a handcrafted action adventure with precise combat, secrets, and acrobatic movement.",
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
  { appId: "1693980", title: "Dead Space" },
  { appId: "208650", title: "Batman: Arkham Knight" },
  { appId: "413150", title: "Stardew Valley" },
  { appId: "1714320", title: "Find Love or Die Trying" },
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
const homeRecommendedHeroPreloadLimit = 8;
const homeRecommendedGroupPreloadTimeoutMs = 1800;
const homeRecommendedAppIdGroups = [
  ["1693980", "208650", "413150", "1714320"],
];
const homePersonalCalendarDays = 3;
const homePersonalCalendarGamesPerDay = 2;
const homePersonalCalendarGameCount =
  homePersonalCalendarDays * homePersonalCalendarGamesPerDay;
const homePersonalCalendarPageSize = 120;
const homePersonalCalendarPoolTarget = homePersonalCalendarGameCount * 15;
const homePersonalCalendarEnrichmentLimit = 6;
const homePersonalCalendarRefreshMs = 7 * 24 * 60 * 60 * 1000;
const homeCalendarCoverLoadMargin = "360px 720px";
const homeWishlistDetailsBatchSize = 8;
const homeWishlistRecommendationSourceLimit = 10;
const homeWishlistRecommendationAlgorithmVersion = "steam-morelike-v1";
const homeWishlistCacheRefreshMs = 7 * 24 * 60 * 60 * 1000;

function homeGameAppId(game: GhostBoxGame) {
  return game.appId || game.id.replace(/^steam-/, "");
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
  return isSteamTitlePlaceholder(title);
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
    createSeedGame(
      { appId, title: titleByAppId.get(appId) || `Steam App ${appId}` },
      index
    )
  );
}

function createWishlistFallbackGame(appId: string, index = 0, title?: string) {
  return createSeedGame({ appId, title: title || `Steam App ${appId}` }, index);
}

function preloadHomeRecommendedCover(game: GhostBoxGame) {
  const sources = gameHeroSources(game).slice(
    0,
    homeRecommendedHeroPreloadLimit
  );

  if (!sources.length || sources.some((source) => loadedImageSources.has(source))) {
    return Promise.resolve();
  }

  if (typeof Image === "undefined") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    let pending = sources.length;
    const timeout = window.setTimeout(
      finish,
      homeRecommendedGroupPreloadTimeoutMs
    );

    function finish(source?: string) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (source) loadedImageSources.add(source);
      resolve();
    }

    sources.forEach((source) => {
      const image = new Image();
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.onload = async () => {
        if (typeof image.decode === "function") {
          await image.decode().catch(() => undefined);
        }
        finish(source);
      };
      image.onerror = () => {
        pending -= 1;
        if (pending === 0) finish();
      };
      image.src = source;
    });
  });
}

function preloadHomeRecommendedGroup(games: GhostBoxGame[]) {
  return Promise.all(
    games.slice(0, homeCarouselGroupSize).map(preloadHomeRecommendedCover)
  ).then(() => undefined);
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
        similarAppIds.slice(0, 8).map((appId) =>
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

async function loadHomePersonalCalendarPool(excludedGameIds = new Set<string>()) {
  const games: GhostBoxGame[] = [];
  const sorts: Array<NonNullable<Parameters<typeof loadGames>[0]>["sort"]> = [
    "popular",
    "recentlyAdded",
  ];
  const offsets = new Map<typeof sorts[number], number>(
    sorts.map((sort) => [sort, 0])
  );
  const totals = new Map<typeof sorts[number], number | undefined>();

  while (
    getUniquePersonalCalendarPool(games).filter(
      (game) => !excludedGameIds.has(personalCalendarGameKey(game))
    ).length < homePersonalCalendarPoolTarget
  ) {
    let loadedAnyPage = false;

    for (const sort of sorts) {
      const offset = offsets.get(sort) ?? 0;
      const expectedTotal = totals.get(sort);
      if (expectedTotal !== undefined && offset >= expectedTotal) continue;

      const result = await loadGames({
        query: "",
        limit: homePersonalCalendarPageSize,
        offset,
        sort,
      });
      games.push(...result.games);
      totals.set(sort, result.matched || result.total || games.length);
      offsets.set(sort, offset + homePersonalCalendarPageSize);
      loadedAnyPage = true;

      if (result.games.length < homePersonalCalendarPageSize) {
        totals.set(sort, offset + result.games.length);
      }
    }

    if (!loadedAnyPage) break;
  }

  return getUniquePersonalCalendarPool(games);
}

function getHomeMetadataCategories(game: GhostBoxGame) {
  return Array.from(
    new Set(
      [...game.genres, ...game.tags]
        .map(normalizeHomeCategory)
        .filter(Boolean)
    )
  );
}

function HomeCategoryCard({
  game,
  variant = "tile",
  showMetadata = false,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  variant?: HomeCategoryCardVariant;
  showMetadata?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackCoverSources = useMemo(
    () =>
      variant === "portrait"
          ? gameHeroCapsuleSources(game).slice(
              0,
              homeRecommendedHeroPreloadLimit
            )
        : gameHeaderOnlySources(game),
    [game, variant]
  );
  const cachedSources = useCachedImageSources(fallbackCoverSources);
  const { source: coverSource, loaded } = useLoadableImageCover(cachedSources);
  const layeredSources = variant === "portrait"
    ? loaded && coverSource
      ? [coverSource]
      : []
    : coverSource
      ? [coverSource, ...fallbackCoverSources.filter((source) => source !== coverSource)]
      : fallbackCoverSources;
  const metadataCategories = getHomeMetadataCategories(game);
  const coverImageSize = variant === "portrait" ? "auto 100%" : "100% 100%";
  const hoverCoverImageSize = showMetadata
    ? coverImageSize
    : variant === "portrait"
      ? "auto 106%"
      : "104.5% 104.5%";

  return (
    <button
      type="button"
      className={`home-category-card home-category-card--${variant}${
        showMetadata ? " home-category-card--with-metadata" : ""
      }`}
      aria-label={game.title}
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
        style={layeredImageStyle(
          layeredSources,
          "",
          coverImageSize,
          hoverCoverImageSize
        )}
        aria-hidden="true"
      />
      {showMetadata ? (
        <span className="home-category-card__metadata" aria-hidden="true">
          <span className="home-category-card__metadata-summary">
            <span className="home-category-card__genres">
              {metadataCategories.map((category) => (
                <span className="home-category-card__genre" key={category}>
                  {category}
                </span>
              ))}
            </span>
          </span>
        </span>
      ) : null}
    </button>
  );
}

function HomeCategorySection({
  title,
  games,
  className = "",
  variant = "tile",
  maxGames = 3,
  showMetadata = false,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  games: GhostBoxGame[];
  className?: string;
  variant?: HomeCategoryCardVariant;
  maxGames?: number;
  showMetadata?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const visibleGames = games.slice(0, maxGames);

  return (
    <section
      className={`home-category${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <SectionHeader title={title} />
      <div className="home-category__games">
        {Array.from({ length: maxGames }, (_, index) => {
          const game = visibleGames[index];
          return game ? (
            <HomeCategoryCard
              key={game.appId || game.id}
              game={game}
              variant={variant}
              showMetadata={showMetadata}
              onOpenGame={onOpenGame}
              onGameContextMenu={onGameContextMenu}
            />
          ) : (
            <span
              key={`placeholder-${index}`}
              className={`home-category-card home-category-card--${variant} home-category-card--empty`}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </section>
  );
}

/*
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
*/

/*
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
*/

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
  const previewGames = uniqueCategoryGames.slice(0, 9);
  const rows = [0, 1, 2].map((rowIndex) =>
    previewGames.filter((_, index) => index % 3 === rowIndex).slice(0, 3)
  );

  return rows.filter((row) => row.length > 0);
}

function HomeExploreCategoryImage({ game }: { game: GhostBoxGame }) {
  const sources = gameHeaderOnlySources(game);
  const cachedSources = useCachedImageSources(sources);
  const { source: imageSource } = useLoadableImageCover(cachedSources);

  return (
    <span
      className="home-explore-card__image"
      style={layeredImageStyle(imageSource ? [imageSource] : [], "")}
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
  return (
    <Shelf
      blockName="home-explore"
      title={title}
      items={categories}
      getKey={(category) => category.label}
      prevLabel={language === "en" ? "Previous categories" : "Categorias anteriores"}
      nextLabel={language === "en" ? "Next categories" : "Próximas categorias"}
      renderItem={(category, rootRef) => (
        <HomeExploreCard
          category={category}
          allGames={allGames}
          language={language}
          rootRef={rootRef}
          onOpenCategory={onOpenCategory}
        />
      )}
    />
  );
}

function HomeCalendarGameCardComponent({
  game,
  rootRef,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  rootRef: RefObject<HTMLDivElement | null>;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  // Header-only: never include coverUrl/portrait fallbacks. Enrichment and the
  // global library-capsule cache otherwise swap the landscape header for a
  // vertical cover after the correct image already painted.
  const headerSources = useMemo(
    () =>
      shouldLoadCover
        ? [
            ...gameHeaderOnlySources(game).slice(0, 1),
            ...gameHeroSources(game),
            ...gameHeaderOnlySources(game).slice(1),
          ]
        : [],
    [game, shouldLoadCover]
  );

  useEffect(
    () => {
      if (shouldLoadCover) return;
      const node = cardRef.current;
      if (!node) return;

      if (typeof IntersectionObserver === "undefined") {
        setShouldLoadCover(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShouldLoadCover(true);
            observer.disconnect();
          }
        },
        {
          root: rootRef.current ?? null,
          rootMargin: homeCalendarCoverLoadMargin,
          threshold: 0.01,
        }
      );

      observer.observe(node);
      return () => observer.disconnect();
    },
    [rootRef, shouldLoadCover]
  );

  const coverSources = useCachedImageSources(headerSources);
  const {
    source: coverSource,
    loaded,
    failed,
  } = useLoadableImageCover(coverSources);
  const hasLoadedHeader =
    shouldLoadCover && loaded && coverSources.includes(coverSource);
  const layeredSources = hasLoadedHeader ? [coverSource] : [];

  return (
    <button
      ref={cardRef}
      type="button"
      aria-label={game.title}
      className={`home-calendar-card${
        hasLoadedHeader ? "" : " home-calendar-card--skeleton"
      }${failed ? " home-calendar-card--fallback" : ""}`}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-calendar-card__cover${
          hasLoadedHeader ? " home-calendar-card__cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "")}
        aria-hidden="true"
      />
      <span className="home-calendar-card__content" aria-hidden="true">
        <strong>{game.title}</strong>
      </span>
    </button>
  );
}

const HomeCalendarGameCard = memo(HomeCalendarGameCardComponent);

function HomePersonalCalendar({
  title,
  subtitle,
  games,
  cycleStart,
  language,
  loading,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle: string;
  games: GhostBoxGame[];
  cycleStart: string;
  language: "pt" | "en";
  loading: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const weekdays = getPersonalCalendarDates(
    language,
    cycleStart,
    homePersonalCalendarDays
  );
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const gamesPerDay = homePersonalCalendarGamesPerDay;

  if (!games.length && !loading) return null;

  return (
    <section className="home-calendar" aria-label={title}>
      <SectionHeader title={title} subtitle={subtitle || undefined} />
      <div className="home-calendar__rail" ref={calendarRef}>
        <div className="home-calendar__carousel">
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
                    {Array.from({ length: gamesPerDay }, (_, gameIndex) => {
                      const game = dayGames[gameIndex];
                      return game ? (
                        <HomeCalendarGameCard
                          key={homeGameKey(game)}
                          game={game}
                          rootRef={calendarRef}
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
      </div>
    </section>
  );
}

function HomeRecommendedBanner({
  game,
  onOpenGame,
  onGameContextMenu,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const fallbackHeroSources = useMemo(() => gameHeroSources(game), [game]);
  const cachedSources = useCachedImageSources(fallbackHeroSources);
  const { source: heroSource, loaded } = useLoadableImageCover(cachedSources);
  const layeredSources = heroSource
    ? [heroSource, ...fallbackHeroSources.filter((source) => source !== heroSource)]
    : fallbackHeroSources;

  return (
    <button
      type="button"
      className="home-recommended__banner"
      aria-label={game.title}
      onClick={() => onOpenGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <span
        className={`home-recommended__banner-cover${
          loaded ? " home-recommended__banner-cover--loaded" : ""
        }`}
        style={layeredImageStyle(layeredSources, "", "cover", "cover")}
        aria-hidden="true"
      />
      <span className="home-recommended__banner-overlay" aria-hidden="true" />
      <span className="home-recommended__banner-meta" aria-hidden="true">
        <strong className="home-recommended__banner-title">{game.title}</strong>
        {game.developers?.[0] ? (
          <span className="home-recommended__banner-developer">
            {game.developers[0]}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function HomeRecommendedHero({
  title,
  gameGroups,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  gameGroups: GhostBoxGame[][];
  language: "pt" | "en";
  onOpenGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}) {
  const availableGroups = useMemo(
    () => gameGroups.filter((group) => group.length > 0),
    [gameGroups]
  );
  const visibleGames = (availableGroups[0] ?? []).slice(
    0,
    homeCarouselGroupSize
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(visibleGames.length - 1, 0))
    );
  }, [visibleGames.length]);

  useEffect(() => {
    const cancelPreload = runWhenIdle(() => {
      void preloadHomeRecommendedGroup(availableGroups[0] ?? []);
    }, 450);

    return cancelPreload;
  }, [availableGroups]);

  const activeGame = visibleGames[activeIndex];
  if (!activeGame) return null;

  return (
    <section className="home-recommended" aria-label={title}>
      <SectionHeader title={title} />
      <div className="home-recommended__stage">
        <HomeRecommendedBanner
          key={homeGameKey(activeGame)}
          game={activeGame}
          onOpenGame={onOpenGame}
          onGameContextMenu={onGameContextMenu}
        />
        {visibleGames.length > 1 ? (
          <div
            className="home-recommended__pagination"
            role="group"
            aria-label={
              language === "en"
                ? "Recommended game navigation"
                : "Navegação de jogos recomendados"
            }
          >
            {visibleGames.map((game, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  type="button"
                  className={`home-recommended__page${
                    isActive ? " home-recommended__page--active" : ""
                  }`}
                  aria-label={`${language === "en" ? "Show" : "Mostrar"} ${game.title}`}
                  aria-current={isActive ? "true" : undefined}
                  key={homeGameKey(game)}
                  onClick={() => setActiveIndex(index)}
                >
                  <span aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : null}
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
  const appId = homeGameAppId(game);
  const reviewLanguage = language === "en" ? "english" : "brazilian";
  const cachedReview = appId
    ? readStoredSteamWishlistReview(appId, reviewLanguage)
    : null;
  const reviewRef = useRef<HTMLSpanElement | null>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [review, setReview] = useState<SteamGameReview | null>(
    () => cachedReview?.review ?? null
  );
  const [isLoading, setIsLoading] = useState(() => !cachedReview);

  useEffect(() => {
    if (!appId) {
      setReview(null);
      setIsLoading(false);
      return;
    }

    const nextCachedReview = readStoredSteamWishlistReview(appId, reviewLanguage);
    setReview(nextCachedReview?.review ?? null);
    setIsLoading(!nextCachedReview);
    setHasBeenVisible(Boolean(nextCachedReview));
  }, [appId, reviewLanguage]);

  useEffect(() => {
    if (hasBeenVisible) return;
    const node = reviewRef.current;
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
      { rootMargin: "0px 0px 200px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  useEffect(() => {
    if (!hasBeenVisible) return;
    let cancelled = false;
    if (!appId) {
      setIsLoading(false);
      return;
    }

    const cachedReview = readStoredSteamWishlistReview(appId, reviewLanguage);
    if (cachedReview) {
      setReview(cachedReview.review);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setReview(null);

    void loadGameReviews(appId, reviewLanguage, "positive")
      .then((result) => {
        if (cancelled) return;
        const nextReview = result.reviews?.find((item) => item.review.trim()) ?? null;
        setReview(nextReview);
        if (nextReview) {
          writeStoredSteamWishlistReview({
            appId,
            language: reviewLanguage,
            expiresAt: new Date(Date.now() + homeWishlistCacheRefreshMs).toISOString(),
            review: nextReview,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setReview(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, reviewLanguage, hasBeenVisible]);

  if (isLoading) {
    return <HomeWishlistReviewSkeleton rootRef={reviewRef} ariaHidden />;
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
  const coverRef = useRef<HTMLSpanElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [screenshotIndex, setScreenshotIndex] = useState<number | null>(null);
  const [readyScreenshotIndexes, setReadyScreenshotIndexes] = useState<Set<number>>(
    () => new Set()
  );
  const screenshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyScreenshotIndexesRef = useRef(readyScreenshotIndexes);
  readyScreenshotIndexesRef.current = readyScreenshotIndexes;

  const markScreenshotReady = useCallback((index: number) => {
    setReadyScreenshotIndexes((current) => {
      if (current.has(index)) return current;
      const next = new Set(current);
      next.add(index);
      return next;
    });
  }, []);

  // Decode screenshots as soon as the card is near the viewport so hover swaps
  // to a fully-decoded bitmap instead of a progressive soft paint.
  useEffect(() => {
    if (!screenshots.length) {
      setReadyScreenshotIndexes(new Set());
      return;
    }

    let cancelled = false;
    const node = coverRef.current;
    let started = false;
    const controllers: AbortController[] = [];

    const decodeSource = (source: string, index: number) => {
      const img = new Image();
      img.decoding = "async";
      img.src = source;
      const finish = async () => {
        try {
          if (typeof img.decode === "function") {
            await img.decode();
          }
        } catch {
          // decode() can reject on abort/unsupported; complete still usable.
        }
        if (!cancelled && img.complete && img.naturalWidth > 0) {
          markScreenshotReady(index);
        }
      };
      if (img.complete) {
        void finish();
        return;
      }
      img.addEventListener("load", () => void finish(), { once: true });
    };

    const startPreload = () => {
      if (started || cancelled) return;
      started = true;
      screenshots.forEach((source, index) => decodeSource(source, index));
    };

    if (!node || typeof IntersectionObserver === "undefined") {
      startPreload();
      return () => {
        cancelled = true;
        controllers.forEach((controller) => controller.abort());
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startPreload();
          observer.disconnect();
        }
      },
      { rootMargin: "480px 0px", threshold: 0.01 }
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      controllers.forEach((controller) => controller.abort());
    };
  }, [markScreenshotReady, screenshots]);

  useEffect(() => {
    if (!isHovered || screenshots.length === 0) {
      if (screenshotTimerRef.current) {
        clearInterval(screenshotTimerRef.current);
        screenshotTimerRef.current = null;
      }
      setScreenshotIndex(null);
      return;
    }

    const pickFirstReady = () => {
      const ready = readyScreenshotIndexesRef.current;
      for (let index = 0; index < screenshots.length; index += 1) {
        if (ready.has(index)) return index;
      }
      return null;
    };

    // Prefer a decoded frame immediately — never flash a half-decoded bitmap.
    setScreenshotIndex(pickFirstReady());

    screenshotTimerRef.current = setInterval(() => {
      setScreenshotIndex((current) => {
        const ready = readyScreenshotIndexesRef.current;
        if (ready.size === 0) return pickFirstReady();

        const start = current === null ? -1 : current;
        for (let step = 1; step <= screenshots.length; step += 1) {
          const next = (start + step) % screenshots.length;
          if (ready.has(next)) return next;
        }
        return current;
      });
    }, 1400);

    return () => {
      if (screenshotTimerRef.current) {
        clearInterval(screenshotTimerRef.current);
        screenshotTimerRef.current = null;
      }
    };
  }, [isHovered, screenshots]);

  // If the first ready screenshot arrives while already hovering, activate it.
  useEffect(() => {
    if (!isHovered || screenshotIndex !== null || readyScreenshotIndexes.size === 0) {
      return;
    }
    for (let index = 0; index < screenshots.length; index += 1) {
      if (readyScreenshotIndexes.has(index)) {
        setScreenshotIndex(index);
        return;
      }
    }
  }, [isHovered, readyScreenshotIndexes, screenshotIndex, screenshots.length]);

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
    <div
      className="home-wishlist-card"
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
      <span className="home-wishlist-card__content">
        <strong className="home-wishlist-card__title">
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
          ref={coverRef}
          className={`home-wishlist-card__cover${loaded ? " home-wishlist-card__cover--loaded" : ""}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {imageSource && (
            <img
              src={imageSource}
              alt=""
              draggable={false}
              decoding="async"
            />
          )}
          {/* Keep screenshots mounted (hidden) so they decode before hover. */}
          {screenshots.map((source, index) => (
            <img
              key={source}
              className={`home-wishlist-card__screenshot${
                isHovered &&
                index === screenshotIndex &&
                readyScreenshotIndexes.has(index)
                  ? " home-wishlist-card__screenshot--active"
                  : ""
              }`}
              src={source}
              alt=""
              draggable={false}
              decoding="async"
              fetchPriority="low"
              onLoad={() => markScreenshotReady(index)}
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
  subtitle,
  recommendations,
  loading,
  language,
  onOpenGame,
  onGameContextMenu,
}: {
  title: string;
  subtitle?: string;
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
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="home-wishlist__list">
        {loading && recommendations.length === 0
          ? Array.from({ length: 3 }, (_, index) => (
              <HomeWishlistCardSkeleton key={`wishlist-skeleton-${index}`} />
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
            aria-label={language === "en" ? "Show more" : "Ver mais"}
          >
            <ChevronDown size={15} strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

export function HomePage({
  onOpenGame,
  libraryGameAppIds,
  onOpenCatalogueCategory,
  steamProfile,
}: {
  onOpenGame: (game: GhostBoxGame) => void;
  libraryGameAppIds: Set<string>;
  onOpenCatalogueCategory: (
    key: Extract<CatalogueFilterKey, "genres" | "tags">,
    value: string
  ) => void;
  steamProfile: SteamProfile | null;
}) {
  const { appearance, t } = useSettings();
  const [homeTopReviewedGames, setHomeTopReviewedGames] = useState<GhostBoxGame[]>(
    () =>
      topReviewedSteamGames.map((game, index) =>
        createSeedGame(game, index)
      )
  );
  const [homeFeaturedGames, setHomeFeaturedGames] = useState<GhostBoxGame[]>(() =>
    homeFeaturedSteamGames.map((game, index) =>
      createSeedGame(game, index, "")
    )
  );
  const [storedPersonalCalendar, setStoredPersonalCalendar] = useState<StoredPersonalCalendar | null>(() =>
    readStoredPersonalCalendar()
  );
  const [personalCalendarCycleStart, setPersonalCalendarCycleStart] = useState(() =>
    storedPersonalCalendar?.cycleStart ?? getPersonalCalendarCycleStart().toISOString()
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
          if (!detailed) return createSeedGame(game, start + index);
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
      topReviewedSteamGames.length,
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
      6,
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

    const cancelIdleFeaturedLoad = runWhenIdle(() => {
      void loadGameRange(
        homeFeaturedSteamGames,
        6,
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
    }, 1800);

    return () => {
      cancelled = true;
      cancelIdleFeaturedLoad();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let refreshTimeout: number | undefined;

    function schedulePersonalCalendarRefresh(calendar: StoredPersonalCalendar | null) {
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      if (!calendar) return;

      const delay = Date.parse(calendar.expiresAt) - Date.now() + 500;
      refreshTimeout = window.setTimeout(
        () => void loadPersonalCalendar(),
        Math.max(1000, delay)
      );
    }

    async function loadPersonalCalendar() {
      setIsLoadingPersonalCalendar(true);

      try {
        const currentStoredCalendar = readStoredPersonalCalendar();
        const excludedGameIds = new Set(libraryGameAppIds);

        if (steamProfile?.steamId) {
          const wishlistItems = await loadSteamWishlist(steamProfile.steamId).catch(
            () => []
          );
          wishlistItems.forEach((item) => {
            const appId = item.appId.trim();
            if (appId) excludedGameIds.add(appId);
          });
        }

        if (cancelled) return;
        setStoredPersonalCalendar(currentStoredCalendar);

        const pool = await loadHomePersonalCalendarPool(excludedGameIds);
        if (cancelled) return;

        const gameById = new Map<string, GhostBoxGame>();
        pool.forEach((game) => {
          gameById.set(personalCalendarGameKey(game), game);
          gameById.set(game.id, game);
        });

        if (isStoredPersonalCalendarFresh(currentStoredCalendar, homePersonalCalendarGameCount)) {
          const storedGames = currentStoredCalendar.gameIds.flatMap((gameId) => {
            if (excludedGameIds.has(gameId)) return [];
            const game = gameById.get(gameId);
            return game ? [game] : [];
          });

          if (storedGames.length === homePersonalCalendarGameCount) {
            setPersonalCalendarCycleStart(currentStoredCalendar.cycleStart);
            setPersonalCalendarGames(storedGames);
            schedulePersonalCalendarRefresh(currentStoredCalendar);
            return;
          }
        }

        const cycleStart = getPersonalCalendarCycleStart();
        const selectedGames = pickPersonalCalendarGames(pool, {
          gameCount: homePersonalCalendarGameCount,
          gamesPerDay: homePersonalCalendarGamesPerDay,
          cycleStart,
          monthGameIds: currentStoredCalendar?.monthGameIds,
          excludedGameIds,
        });

        if (!selectedGames.length) {
          setPersonalCalendarGames([]);
          schedulePersonalCalendarRefresh(null);
          return;
        }

        const nextCalendar = createPersonalCalendar({
          selectedGames,
          storedCalendar: currentStoredCalendar,
          cycleStart,
          refreshMs: homePersonalCalendarRefreshMs,
          gamesPerDay: homePersonalCalendarGamesPerDay,
        });
        writeStoredPersonalCalendar(nextCalendar);
        setStoredPersonalCalendar(nextCalendar);
        setPersonalCalendarCycleStart(nextCalendar.cycleStart);
        setPersonalCalendarGames(selectedGames);
        schedulePersonalCalendarRefresh(nextCalendar);
      } finally {
        if (!cancelled) setIsLoadingPersonalCalendar(false);
      }
    }

    void loadPersonalCalendar();

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const calendar = readStoredPersonalCalendar();
      if (!isStoredPersonalCalendarFresh(calendar, homePersonalCalendarGameCount)) {
        void loadPersonalCalendar();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [libraryGameAppIds, steamProfile?.steamId]);

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
          expiresAt: new Date(Date.now() + homeWishlistCacheRefreshMs).toISOString(),
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

    const cancelIdleWishlistLoad = runWhenIdle(() => {
      void loadWishlistRecommendations();
    }, 2200);

    return () => {
      cancelled = true;
      cancelIdleWishlistLoad();
    };
  }, [steamProfile?.steamId, libraryGameAppIds]);

  const homeVisibleGameGroups = useMemo(() => {
    return homeRecommendedAppIdGroups.map((appIds) =>
      appIds
        .map((appId) =>
          homeTopReviewedGames.find((game) => homeGameAppId(game) === appId)
        )
        .filter((game): game is GhostBoxGame => Boolean(game))
    );
  }, [homeTopReviewedGames]);
  const featuredGames = homeFeaturedGames;
  const enrichedPersonalCalendarGames = useEnrichedGameCards(
    personalCalendarGames,
    homePersonalCalendarEnrichmentLimit
  );
  const exploreCategories = useMemo(() => {
    return getHomeExploreCategories([...homeTopReviewedGames, ...homeFeaturedGames]);
  }, [homeTopReviewedGames, homeFeaturedGames]);
  const homeContextMenuItems = useGameContextMenu({
    game: homeContextMenu?.game ?? null,
    onOpenGame,
  });

  return (
    <section className="home-page" aria-label={t("home.pageAria")}>
      <HomeRecommendedHero
        title={t("home.recommended")}
        gameGroups={homeVisibleGameGroups}
        language={appearance.language}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeCategorySection
        title={t("home.featuredGames")}
        games={featuredGames}
        className="home-category--featured"
        variant="tile"
        maxGames={6}
        showMetadata
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeExploreCategories
        title={t("home.exploreByCategory")}
        categories={exploreCategories}
        allGames={[...homeTopReviewedGames, ...homeFeaturedGames]}
        language={appearance.language}
        onOpenCategory={(category) =>
          onOpenCatalogueCategory(category.filterKey, category.filterValue)
        }
      />
      <HomePersonalCalendar
        title={t("home.personalCalendar")}
        subtitle=""
        games={enrichedPersonalCalendarGames}
        cycleStart={personalCalendarCycleStart}
        language={appearance.language}
        loading={isLoadingPersonalCalendar}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
      />
      <HomeWishlistRecommendations
        title={t("home.steamWishlist")}
        subtitle={t("home.steamWishlistSubtitle")}
        recommendations={wishlistRecommendations}
        loading={isLoadingWishlistRecommendations}
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
