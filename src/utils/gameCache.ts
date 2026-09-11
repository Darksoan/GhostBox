import type { AppearanceSettings } from "../context/settings";
import { getCurrentAppearanceLanguage } from "../context/settings";
import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetails,
  loadGameDetails,
  loadGameStoreDetails,
} from "../data";

const gameDetailsCache = new Map<string, GhostBoxGame | null>();
const gameDetailsRequestCache = new Map<
  string,
  Promise<GhostBoxGame | null>
>();
const gameStoreDetailsCache = new Map<string, GhostBoxGame | null>();
const gameStoreDetailsRequestCache = new Map<
  string,
  Promise<GhostBoxGame | null>
>();
const gameAchievementDetailsCache = new Map<string, GhostBoxGame | null>();
const gameAchievementDetailsRequestCache = new Map<
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

export function hasUsefulStoreDetails(
  game: GhostBoxGame | null | undefined,
): boolean {
  if (!game) return false;
  if ((game.screenshots?.length ?? 0) > 0) return true;
  if ((game.movies?.length ?? 0) > 0) return true;
  if (game.aboutTheGame?.trim()) return true;
  if (game.shortDescription?.trim()) return true;
  if (game.supportedLanguages?.trim()) return true;
  if (
    game.controllerSupport === "full" ||
    game.controllerSupport === "partial"
  )
    return true;
  if ((game.genres?.length ?? 0) > 0) return true;
  if ((game.developers?.length ?? 0) > 0) return true;
  if ((game.publishers?.length ?? 0) > 0) return true;
  if (
    (game.pcRequirements?.minimum.length ?? 0) > 0 ||
    (game.pcRequirements?.recommended.length ?? 0) > 0
  )
    return true;
  return false;
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
  const appId = normalizeGameCacheId(gameId);
  const language = getCurrentAppearanceLanguage();
  const cacheKey = `${appId}::${language}`;

  const cached = gameStoreDetailsCache.get(cacheKey);
  // Só serve do cache em memória quando o payload tem dado útil de loja.
  // Um primeiro fetch incompleto (proxy instável, Steam 429, catálogo sem
  // screenshots) ficava preso na sessão e o modal abria vazio para sempre,
  // mesmo com a busca de conquistas retornando "no-achievements".
  if (cached && hasUsefulStoreDetails(cached)) {
    return Promise.resolve(cached);
  }
  if (cached) {
    gameStoreDetailsCache.delete(cacheKey);
  }

  const pending = gameStoreDetailsRequestCache.get(cacheKey);
  if (pending) return pending;

  const request = loadGameStoreDetails(appId, language)
    .then((game) => {
      // Só fixa no cache o que tem enriquecimento real. Payload vazio ou só
      // com fallback (sem screenshots/sobre/idiomas) não é fixado para a
      // próxima abertura tentar de novo via backend (que tem disco + proxy +
      // fallback direto para a Steam).
      if (game && hasUsefulStoreDetails(game)) {
        gameStoreDetailsCache.set(cacheKey, game);
      } else {
        gameStoreDetailsCache.delete(cacheKey);
      }
      return game;
    })
    .finally(() => {
      gameStoreDetailsRequestCache.delete(cacheKey);
    });

  gameStoreDetailsRequestCache.set(cacheKey, request);

  return request;
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
