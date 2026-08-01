import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetails,
  loadGameDetails,
  loadGameReviews,
  loadGameStoreDetails,
} from "../data";
import type { SteamGameReviewsResult } from "../lib/ghostboxApi.types";

export const gameDetailsCache = new Map<string, GhostBoxGame | null>();
export const gameDetailsRequestCache = new Map<
  string,
  Promise<GhostBoxGame | null>
>();
export const gameStoreDetailsCache = new Map<string, GhostBoxGame | null>();
export const gameStoreDetailsRequestCache = new Map<
  string,
  Promise<GhostBoxGame | null>
>();
export const gameAchievementDetailsCache = new Map<string, GhostBoxGame | null>();
export const gameAchievementDetailsRequestCache = new Map<
  string,
  Promise<GhostBoxGame | null>
>();
const gameAchievementNegativeCache = new Map<string, number>();
export const gameReviewsCache = new Map<string, SteamGameReviewsResult>();
export const gameReviewsRequestCache = new Map<
  string,
  Promise<SteamGameReviewsResult>
>();
const queuedGameDetailsPreloadIds = new Set<string>();
export let hasLoadedCatalogueGlobally = false;

export function normalizeGameCacheId(
  gameOrId: string | Pick<GhostBoxGame, "id" | "appId"> | null | undefined,
) {
  const appId =
    typeof gameOrId === "string" ? "" : gameOrId?.appId?.trim() ?? "";
  if (/^\d+$/.test(appId)) return appId;

  const rawId =
    (typeof gameOrId === "string" ? gameOrId : gameOrId?.id ?? "").trim();
  const steamId = rawId.match(/^steam-(\d+)$/i)?.[1];
  if (steamId) return steamId;
  if (/^\d+$/.test(rawId)) return rawId;

  return rawId;
}

export function setHasLoadedCatalogueGlobally(value: boolean) {
  hasLoadedCatalogueGlobally = value;
}

function loadCachedGameRequest(
  gameId: string,
  cache: Map<string, GhostBoxGame | null>,
  requestCache: Map<string, Promise<GhostBoxGame | null>>,
  loader: (gameId: string) => Promise<GhostBoxGame | null>,
  options?: { cacheEmpty?: boolean }
) {
  const cacheKey = normalizeGameCacheId(gameId);

  if (cache.has(cacheKey)) {
    return Promise.resolve(cache.get(cacheKey) ?? null);
  }

  const pending = requestCache.get(cacheKey);
  if (pending) return pending;

  const cacheEmpty = options?.cacheEmpty !== false;

  const request = loader(cacheKey)
    .then((game) => {
      if (cacheEmpty) {
        cache.set(cacheKey, game);
      } else {
        // Achievement loads: only pin successful non-empty lists so a failed
        // first attempt does not stick for the whole session.
        const hasAchievements =
          (game?.achievementList?.length ?? 0) > 0 ||
          (game?.achievements?.total ?? 0) > 0;
        if (game && hasAchievements) {
          cache.set(cacheKey, game);
        }
      }
      return game;
    })
    .finally(() => {
      requestCache.delete(cacheKey);
    });

  requestCache.set(cacheKey, request);

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
  const cacheKey = normalizeGameCacheId(gameId);
  const negativeExpiresAt = gameAchievementNegativeCache.get(cacheKey) ?? 0;
  if (negativeExpiresAt > Date.now()) {
    return Promise.resolve(null);
  }
  gameAchievementNegativeCache.delete(cacheKey);

  return loadCachedGameRequest(
    cacheKey,
    gameAchievementDetailsCache,
    gameAchievementDetailsRequestCache,
    async (normalizedGameId) => {
      try {
        const game = await loadGameAchievementDetails(normalizedGameId);
        const hasAchievements =
          (game?.achievementList?.length ?? 0) > 0 ||
          (game?.achievements?.total ?? 0) > 0;
        if (!hasAchievements) {
          const retryAfter = game?.achievementMetadata?.retryAfter ?? 0;
          const ttlMs = retryAfter > 0
            ? retryAfter * 1000
            : game?.achievementMetadata?.status === "no-achievements"
              ? 24 * 60 * 60 * 1000
              : 5 * 60 * 1000;
          gameAchievementNegativeCache.set(
            normalizedGameId,
            Date.now() + ttlMs,
          );
        }
        return game;
      } catch (error) {
        gameAchievementNegativeCache.set(normalizedGameId, Date.now() + 5 * 60 * 1000);
        throw error;
      }
    },
    { cacheEmpty: false }
  );
}

export function loadGameReviewsCached(
  gameId: string,
  language: "all" | "brazilian" | "english",
  reviewType: "all" | "positive" | "negative" = "all"
) {
  const normalizedGameId = normalizeGameCacheId(gameId);
  const cacheKey = `${normalizedGameId}:${language}:${reviewType}`;
  if (gameReviewsCache.has(cacheKey)) {
    return Promise.resolve(gameReviewsCache.get(cacheKey) ?? { success: 0, reviews: [] });
  }

  const pending = gameReviewsRequestCache.get(cacheKey);
  if (pending) return pending;

  const request = loadGameReviews(normalizedGameId, language, reviewType)
    .then((result) => {
      if (result.success === 1) {
        gameReviewsCache.set(cacheKey, result);
      }
      return result;
    })
    .finally(() => {
      gameReviewsRequestCache.delete(cacheKey);
    });

  gameReviewsRequestCache.set(cacheKey, request);
  return request;
}

export function preloadGameDetailsCached(gameId: string) {
  const normalizedGameId = normalizeGameCacheId(gameId);
  if (!normalizedGameId) return;

  void loadGameStoreDetailsCached(normalizedGameId).catch(() => undefined);
}

export function preloadGameDetailsListCached(
  games: Array<Pick<GhostBoxGame, "id" | "appId">>,
  limit = 4,
  staggerMs = 250
) {
  games.slice(0, limit).forEach((game, index) => {
    const cacheKey = normalizeGameCacheId(game);
    if (!cacheKey || queuedGameDetailsPreloadIds.has(cacheKey)) return;
    if (gameStoreDetailsCache.has(cacheKey)) return;

    queuedGameDetailsPreloadIds.add(cacheKey);

    const preload = () => {
      queuedGameDetailsPreloadIds.delete(cacheKey);
      preloadGameDetailsCached(cacheKey);
    };

    if (typeof window === "undefined") {
      preload();
      return;
    }

    window.setTimeout(preload, index * staggerMs);
  });
}
