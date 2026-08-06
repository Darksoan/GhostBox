import type { AppearanceSettings } from "../context/settings";
import { getCurrentAppearanceLanguage } from "../context/settings";
import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetails,
  loadGameDetails,
  loadGameStoreDetails,
} from "../data";

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

/**
 * Igual a `loadCachedGameRequest`, mas embute o idioma atual da UI na chave
 * do cache. Descrição, requisitos e gêneros vêm localizados pela Steam; sem
 * o idioma na chave, trocar pt/en nas configurações continuaria servindo o
 * texto do idioma anterior enquanto o processo ficasse de pé.
 */
function loadCachedGameRequestForLanguage(
  gameId: string,
  cache: Map<string, GhostBoxGame | null>,
  requestCache: Map<string, Promise<GhostBoxGame | null>>,
  loader: (
    gameId: string,
    language: AppearanceSettings["language"]
  ) => Promise<GhostBoxGame | null>,
  options?: { cacheEmpty?: boolean }
) {
  const appId = normalizeGameCacheId(gameId);
  const language = getCurrentAppearanceLanguage();
  const cacheKey = `${appId}::${language}`;

  if (cache.has(cacheKey)) {
    return Promise.resolve(cache.get(cacheKey) ?? null);
  }

  const pending = requestCache.get(cacheKey);
  if (pending) return pending;

  const cacheEmpty = options?.cacheEmpty !== false;

  const request = loader(appId, language)
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
  return loadCachedGameRequestForLanguage(
    gameId,
    gameStoreDetailsCache,
    gameStoreDetailsRequestCache,
    loadGameStoreDetails
  );
}

export function loadGameAchievementDetailsCached(gameId: string) {
  const appId = normalizeGameCacheId(gameId);
  const negativeCacheKey = `${appId}::${getCurrentAppearanceLanguage()}`;
  const negativeExpiresAt = gameAchievementNegativeCache.get(negativeCacheKey) ?? 0;
  if (negativeExpiresAt > Date.now()) {
    return Promise.resolve(null);
  }
  gameAchievementNegativeCache.delete(negativeCacheKey);

  return loadCachedGameRequestForLanguage(
    appId,
    gameAchievementDetailsCache,
    gameAchievementDetailsRequestCache,
    async (normalizedGameId, language) => {
      try {
        const game = await loadGameAchievementDetails(normalizedGameId, language);
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
            negativeCacheKey,
            Date.now() + ttlMs,
          );
        }
        return game;
      } catch (error) {
        gameAchievementNegativeCache.set(negativeCacheKey, Date.now() + 5 * 60 * 1000);
        throw error;
      }
    },
    { cacheEmpty: false }
  );
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
  // O idioma entra na chave de dedupe pelo mesmo motivo do cache principal:
  // a entrada já cacheada pode ser de um idioma diferente do atual.
  const language = getCurrentAppearanceLanguage();
  games.slice(0, limit).forEach((game, index) => {
    const appId = normalizeGameCacheId(game);
    if (!appId) return;
    const cacheKey = `${appId}::${language}`;
    if (queuedGameDetailsPreloadIds.has(cacheKey)) return;
    if (gameStoreDetailsCache.has(cacheKey)) return;

    queuedGameDetailsPreloadIds.add(cacheKey);

    const preload = () => {
      queuedGameDetailsPreloadIds.delete(cacheKey);
      preloadGameDetailsCached(appId);
    };

    if (typeof window === "undefined") {
      preload();
      return;
    }

    window.setTimeout(preload, index * staggerMs);
  });
}
