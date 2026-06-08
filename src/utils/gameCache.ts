import type { GameDatabaseResult, PirateGame } from "../data";
import {
  loadGameAchievementDetails,
  loadGameDetails,
  loadGameStoreDetails,
  loadGames,
} from "../data";
import type { CatalogueFilters, CatalogueSort } from "../types";
import { emptyCatalogueFilters } from "../constants/catalogue";

const catalogueFacetsCacheVersion = "facets-v11-primary-tags";
const catalogueFacetKeys = Object.keys(
  emptyCatalogueFilters
) as (keyof CatalogueFilters)[];

export const gamesCache = new Map<
  string,
  { cachedAt: number; result: GameDatabaseResult }
>();
export const gameRequestCache = new Map<string, Promise<GameDatabaseResult>>();
export const gameDetailsCache = new Map<string, PirateGame | null>();
export const gameDetailsRequestCache = new Map<
  string,
  Promise<PirateGame | null>
>();
export const gameStoreDetailsCache = new Map<string, PirateGame | null>();
export const gameStoreDetailsRequestCache = new Map<
  string,
  Promise<PirateGame | null>
>();
export const gameAchievementDetailsCache = new Map<string, PirateGame | null>();
export const gameAchievementDetailsRequestCache = new Map<
  string,
  Promise<PirateGame | null>
>();
const queuedGameDetailsPreloadIds = new Set<string>();
export let hasLoadedCatalogueGlobally = false;

export function setHasLoadedCatalogueGlobally(value: boolean) {
  hasLoadedCatalogueGlobally = value;
}

export function clearCatalogueGamesCache() {
  gamesCache.clear();
  gameRequestCache.clear();
}

export function getCatalogueFiltersCacheKey(
  filters: CatalogueFilters = emptyCatalogueFilters
) {
  return catalogueFacetKeys
    .map((key) => `${key}:${[...filters[key]].sort().join(",")}`)
    .join("|");
}

export function getGamesCacheKey(
  query: string,
  limit: number,
  offset = 0,
  filters = emptyCatalogueFilters,
  sort: CatalogueSort = "popular",
  includeFacets = false,
  facetsOnly = false
) {
  return `${catalogueFacetsCacheVersion}|${sort}|${includeFacets ? "facets" : "games"}|${facetsOnly ? "facets-only" : "page"}|${query.trim().toLowerCase()}|${getCatalogueFiltersCacheKey(filters)}|${offset}|${limit}`;
}

export function loadGamesCached(
  query: string,
  limit: number,
  offset = 0,
  filters = emptyCatalogueFilters,
  sort: CatalogueSort = "popular",
  includeFacets = false,
  facetsOnly = false
) {
  const cacheKey = getGamesCacheKey(
    query,
    limit,
    offset,
    filters,
    sort,
    includeFacets,
    facetsOnly
  );

  const pending = gameRequestCache.get(cacheKey);
  if (pending) return pending;

  const request = loadGames({
    query,
    limit,
    offset,
    filters,
    sort,
    includeFacets,
    facetsOnly,
  })
    .finally(() => {
      gameRequestCache.delete(cacheKey);
    });

  gameRequestCache.set(cacheKey, request);

  return request;
}

function loadCachedGameRequest(
  gameId: string,
  cache: Map<string, PirateGame | null>,
  requestCache: Map<string, Promise<PirateGame | null>>,
  loader: (gameId: string) => Promise<PirateGame | null>
) {
  if (cache.has(gameId)) {
    return Promise.resolve(cache.get(gameId) ?? null);
  }

  const pending = requestCache.get(gameId);
  if (pending) return pending;

  const request = loader(gameId)
    .then((game) => {
      cache.set(gameId, game);
      return game;
    })
    .finally(() => {
      requestCache.delete(gameId);
    });

  requestCache.set(gameId, request);

  return request;
}

export function loadGameDetailsCached(gameId: string) {
  return loadCachedGameRequest(
    gameId,
    gameDetailsCache,
    gameDetailsRequestCache,
    loadGameDetails
  );
}

export function loadGameStoreDetailsCached(gameId: string) {
  return loadCachedGameRequest(
    gameId,
    gameStoreDetailsCache,
    gameStoreDetailsRequestCache,
    loadGameStoreDetails
  );
}

export function loadGameAchievementDetailsCached(gameId: string) {
  return loadCachedGameRequest(
    gameId,
    gameAchievementDetailsCache,
    gameAchievementDetailsRequestCache,
    loadGameAchievementDetails
  );
}

export function preloadGameDetailsCached(gameId: string) {
  if (!gameId) return;

  void loadGameStoreDetailsCached(gameId).catch(() => undefined);
}

export function preloadGameDetailsListCached(
  games: Array<Pick<PirateGame, "id">>,
  limit = 4,
  staggerMs = 250
) {
  games.slice(0, limit).forEach((game, index) => {
    if (!game.id || queuedGameDetailsPreloadIds.has(game.id)) return;
    if (gameStoreDetailsCache.has(game.id)) return;

    queuedGameDetailsPreloadIds.add(game.id);

    const preload = () => {
      queuedGameDetailsPreloadIds.delete(game.id);
      preloadGameDetailsCached(game.id);
    };

    if (typeof window === "undefined") {
      preload();
      return;
    }

    window.setTimeout(preload, index * staggerMs);
  });
}
