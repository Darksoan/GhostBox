import {
  normalizeFeaturedCategories,
  normalizeSchemaAchievements,
  normalizeGlobalPercentages,
  mergeGlobalPercentages,
  parseRetryAfter,
  parseSimilarAppIds,
  sortWishlistItems,
  validAppId,
  validSteamId,
} from "./pure.mjs";

type Env = {
  STEAM_WEB_API_KEY: string;
  STATS_CACHE: KVNamespace;
  SCAN_COORDINATOR: DurableObjectNamespace;
  ALLOWED_ORIGIN?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  METRICS_TOKEN?: string;
};

type OwnedGame = {
  appid: number;
  playtime_forever: number;
  rtime_last_played?: number;
  name?: string;
};

type AchievementEntry = {
  playtimeForever: number;
  unlockedAchievements: number;
  totalAchievements: number;
  hasAchievements: boolean;
  achievements?: GameAchievement[];
  recentAchievements: RecentAchievement[];
  lastFetchedAt: number;
  lastError?: string;
  retryAt?: number;
};

type StatsCache = {
  steamId: string;
  communitySummary?: AchievementSummary;
  games: Record<string, AchievementEntry>;
  ownedGames: OwnedGame[];
  ownedGamesFetchedAt?: number;
  fetchedAt: number;
  scanInProgress: boolean;
};

type AchievementSummary = {
  unlockedAchievements: number;
  perfectGames: number;
  averageProgress: number;
};

type RecentAchievement = {
  id: string;
  title: string;
  gameTitle: string;
  icon: string;
  appId: string;
  unlockedAt: number;
};

type GameAchievement = {
  name: string;
  title: string;
  description: string;
  icon: string;
  iconGray: string;
  unlocked: boolean;
  unlockedAt: number;
};

type OwnedPlaytime = {
  appId: string;
  name?: string;
  playtimeForever: number;
  rtimeLastPlayed: number;
};

type AccountStats = {
  steamId: string;
  gamesCount: number;
  totalPlaytimeMinutes: number;
  unlockedAchievements: number;
  totalAchievements: number;
  perfectGames: number;
  averageProgress: number;
  scannedGames: number;
  pendingGames: number;
  failedGames: number;
  fetchedAt: number;
  private: boolean;
  hasApiKey: boolean;
  scanInProgress: boolean;
  nextPollAfter: number;
  recentAchievements: RecentAchievement[];
  ownedPlaytimes: OwnedPlaytime[];
  achievements: GameAchievementSummary[];
};

type CircuitState = {
  failures: number;
  openUntil: number;
  retryAfter?: number;
  updatedAt?: number;
};

type GameAchievementSummary = {
  appId: string;
  gameTitle: string;
  achievements: GameAchievement[];
};

type JsonResponseOptions = {
  cacheStatus?: string;
  maxAge?: number;
  extraHeaders?: Record<string, string>;
};

type WishlistItem = {
  appId: string;
  priority: number;
  dateAdded: number;
  title?: string;
};

type WishlistCache = {
  steamId: string;
  items: WishlistItem[];
  fetchedAt: number;
};

type RecommendedTagsCache = {
  steamId: string;
  tags: unknown[];
  fetchedAt: number;
};

type MetricsSnapshot = {
  requests: number;
  cacheHit: number;
  cacheKv: number;
  cacheMiss: number;
  cacheStale: number;
  cacheBypass: number;
  rateLimited: number;
  upstreamErrors: number;
  steam429: number;
  steam5xx: number;
  updatedAt: number;
};

const accountCacheTtlSeconds = 180 * 24 * 60 * 60;
const accountFreshTtlSeconds = 60 * 60;
const achievementCacheTtlSeconds = 7 * 24 * 60 * 60;
const noStatsCacheTtlSeconds = 30 * 24 * 60 * 60;
const failedRetryTtlSeconds = 15 * 60;
const emptySchemaCacheTtlSeconds = 24 * 60 * 60;
// Global unlock percentages drift slowly, but not as slowly as the schema, so
// they get their own shorter TTL instead of riding the 365d schema entry.
const globalPercentCacheTtlSeconds = 24 * 60 * 60;
const emptyGlobalPercentCacheTtlSeconds = 6 * 60 * 60;
const scanConcurrency = 6;
const maxScanBatchPerRequest = 40;
const maxBatchesPerScan = 4;
const defaultRateLimitPerMinute = 60;
const circuitFailureThreshold = 3;
const circuitBaseBackoffSeconds = 15 * 60;
const circuitMaxBackoffSeconds = 24 * 60 * 60;
const edgeCacheTtlSeconds = 30;
const scanContinueDelayMs = 5_000;
const wishlistFreshTtlSeconds = 30 * 60;
const wishlistCacheTtlSeconds = 6 * 60 * 60;
const tagsFreshTtlSeconds = 12 * 60 * 60;
const tagsCacheTtlSeconds = 24 * 60 * 60;
const reviewsFreshTtlSeconds = 20 * 60;
const reviewsCacheTtlSeconds = 6 * 60 * 60;
const featuredFreshTtlSeconds = 30 * 60;
const featuredCacheTtlSeconds = 6 * 60 * 60;
const featuredRegions = { br: "portuguese", us: "english" } as const;
const similarFreshTtlSeconds = 14 * 24 * 60 * 60;
const similarEmptyFreshTtlSeconds = 60 * 60;
const similarCacheTtlSeconds = 30 * 24 * 60 * 60;
const storeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const profileFreshTtlSeconds = 6 * 60 * 60;
const profileCacheTtlSeconds = 24 * 60 * 60;
const metricsFlushEvery = 25;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const localMetrics: MetricsSnapshot = {
  requests: 0,
  cacheHit: 0,
  cacheKv: 0,
  cacheMiss: 0,
  cacheStale: 0,
  cacheBypass: 0,
  rateLimited: 0,
  upstreamErrors: 0,
  steam429: 0,
  steam5xx: 0,
  updatedAt: 0,
};
let metricsSinceFlush = 0;
let metricsFlushPromise: Promise<void> | null = null;

class SteamRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAt?: number,
    readonly circuitOpen = false
  ) {
    super(message);
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function emptyMetrics(): MetricsSnapshot {
  return {
    requests: 0,
    cacheHit: 0,
    cacheKv: 0,
    cacheMiss: 0,
    cacheStale: 0,
    cacheBypass: 0,
    rateLimited: 0,
    upstreamErrors: 0,
    steam429: 0,
    steam5xx: 0,
    updatedAt: 0,
  };
}

function recordMetric(key: keyof MetricsSnapshot, amount = 1) {
  if (key === "updatedAt") return;
  localMetrics[key] = (localMetrics[key] as number) + amount;
  localMetrics.updatedAt = nowSeconds();
  metricsSinceFlush += amount > 0 ? 1 : 0;
}

function recordCacheStatus(status?: string) {
  switch (status) {
    case "HIT":
      recordMetric("cacheHit");
      break;
    case "KV":
      recordMetric("cacheKv");
      break;
    case "MISS":
      recordMetric("cacheMiss");
      break;
    case "STALE":
      recordMetric("cacheStale");
      break;
    default:
      recordMetric("cacheBypass");
      break;
  }
}

function mergeMetrics(left: MetricsSnapshot, right: MetricsSnapshot): MetricsSnapshot {
  return {
    requests: left.requests + right.requests,
    cacheHit: left.cacheHit + right.cacheHit,
    cacheKv: left.cacheKv + right.cacheKv,
    cacheMiss: left.cacheMiss + right.cacheMiss,
    cacheStale: left.cacheStale + right.cacheStale,
    cacheBypass: left.cacheBypass + right.cacheBypass,
    rateLimited: left.rateLimited + right.rateLimited,
    upstreamErrors: left.upstreamErrors + right.upstreamErrors,
    steam429: left.steam429 + right.steam429,
    steam5xx: left.steam5xx + right.steam5xx,
    updatedAt: Math.max(left.updatedAt, right.updatedAt, nowSeconds()),
  };
}

function metricsStub(env: Env) {
  return env.SCAN_COORDINATOR.get(env.SCAN_COORDINATOR.idFromName("metrics:global"));
}

async function flushMetricsNow(env: Env) {
  if (metricsSinceFlush <= 0) return;
  const pending = { ...localMetrics };
  for (const key of Object.keys(localMetrics) as Array<keyof MetricsSnapshot>) {
    if (key === "updatedAt") continue;
    localMetrics[key] = 0;
  }
  localMetrics.updatedAt = 0;
  metricsSinceFlush = 0;
  try {
    const response = await metricsStub(env).fetch("https://coordinator/metrics-add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pending),
    });
    if (!response.ok) throw new Error("Metrics coordinator rejected delta");
  } catch {
    Object.assign(localMetrics, mergeMetrics(localMetrics, pending));
    metricsSinceFlush = metricsFlushEvery;
  }
}

async function flushMetrics(env: Env) {
  if (!metricsFlushPromise) {
    metricsFlushPromise = flushMetricsNow(env).finally(() => {
      metricsFlushPromise = null;
    });
  }
  await metricsFlushPromise;
}

function maybeFlushMetrics(env: Env, context: ExecutionContext) {
  if (metricsSinceFlush >= metricsFlushEvery) {
    context.waitUntil(flushMetrics(env));
  }
}

function jsonResponse(
  value: unknown,
  env: Env,
  status = 200,
  options: JsonResponseOptions = {}
) {
  const maxAge = options.maxAge ?? 0;
  if (options.cacheStatus) recordCacheStatus(options.cacheStatus);
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
      "x-ghostbox-cache": options.cacheStatus || "BYPASS",
      ...(options.extraHeaders || {}),
    },
  });
}

function statsCacheKey(steamId: string) {
  return `steam:v9:account:${steamId}`;
}

async function readStatsCache(env: Env, steamId: string) {
  const current = await env.STATS_CACHE.get<StatsCache>(statsCacheKey(steamId), "json");
  if (current) return current;
  return env.STATS_CACHE.get<StatsCache>(`steam-stats:v8:${steamId}`, "json");
}

function ownedGamesFetchedAt(cache: StatsCache) {
  return cache.ownedGamesFetchedAt ?? cache.fetchedAt;
}

function schemaCacheKey(language: string, appId: string) {
  return `steam:v9:schema:${language}:${appId}`;
}

function globalPercentCacheKey(appId: string) {
  return `steam:v9:globalpct:${appId}`;
}

function wishlistCacheKey(steamId: string) {
  return `steam:v9:wishlist:${steamId}`;
}

function tagsCacheKey(steamId: string) {
  return `steam:v9:tags:${steamId}`;
}

function edgeCacheRequest(pathname: string, cacheKey: string) {
  return new Request(
    `https://ghostbox-steam-stats.cache${pathname}?k=${encodeURIComponent(cacheKey)}`
  );
}

function edgeCache() {
  return (caches as unknown as { default: Cache }).default;
}

async function matchEdgeCache(pathname: string, cacheKey: string) {
  const hit = await edgeCache().match(edgeCacheRequest(pathname, cacheKey));
  if (!hit) return null;
  recordMetric("cacheHit");
  const headers = new Headers(hit.headers);
  headers.set("x-ghostbox-cache", "HIT");
  return new Response(hit.body, { status: hit.status, headers });
}

async function putEdgeCache(
  pathname: string,
  cacheKey: string,
  response: Response,
  context: ExecutionContext
) {
  context.waitUntil(edgeCache().put(edgeCacheRequest(pathname, cacheKey), response.clone()));
}

function reviewsCacheKey(appId: string, language: string, reviewType: string) {
  return `steam:v9:reviews:${appId}:${language}:${reviewType}`;
}

function featuredCacheKey(cc: string, language: string) {
  return `steam:v9:featured:${cc}:${language}`;
}

/** Only two regions are wired up today (pt->br, en->us) — anything else falls back to br. */
function featuredRegion(url: URL): { cc: keyof typeof featuredRegions; language: string } {
  const cc = url.searchParams.get("cc");
  if (cc === "us") return { cc: "us", language: featuredRegions.us };
  return { cc: "br", language: featuredRegions.br };
}

function similarCacheKey(appId: string) {
  return `steam:v9:similar:${appId}`;
}

function profileCacheKey(steamId: string) {
  return `steam:v9:profile:${steamId}`;
}

function compareOwnedGamesForAchievementScan(left: OwnedGame, right: OwnedGame) {
  const lastPlayedDelta = (right.rtime_last_played ?? 0) - (left.rtime_last_played ?? 0);
  if (lastPlayedDelta !== 0) return lastPlayedDelta;
  return right.playtime_forever - left.playtime_forever;
}

async function rateLimitExceeded(request: Request, env: Env) {
  const limit = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE || defaultRateLimitPerMinute));
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  const windowMs = 60_000;
  const now = Date.now();
  const key = `${Math.floor(now / windowMs)}:${ip}`;
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (rateLimitBuckets.size > 5_000) {
      for (const [bucketKey, bucket] of rateLimitBuckets) {
        if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
      }
    }
    return false;
  }
  existing.count += 1;
  const exceeded = existing.count > limit;
  if (exceeded) recordMetric("rateLimited");
  return exceeded;
}

function circuitStub(env: Env, endpoint: string) {
  return env.SCAN_COORDINATOR.get(env.SCAN_COORDINATOR.idFromName(`circuit:${endpoint}`));
}

async function readCircuitState(env: Env | undefined, endpoint: string) {
  if (!env) return null;
  return circuitStub(env, endpoint)
    .fetch("https://coordinator/circuit-state")
    .then((response) => (response.ok ? response.json<CircuitState>() : null))
    .catch(() => null);
}

function isCircuitFailureStatus(status: number) {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

async function recordCircuitFailure(
  env: Env | undefined,
  endpoint: string,
  retryAfterSeconds?: number
) {
  const retryDelay = Math.max(retryAfterSeconds ?? 0, circuitBaseBackoffSeconds);
  if (!env) return nowSeconds() + retryDelay;
  const response = await circuitStub(env, endpoint)
    .fetch("https://coordinator/circuit-failure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retryAfter: retryAfterSeconds }),
    })
    .catch(() => null);
  const state = response?.ok
    ? ((await response.json().catch(() => null)) as CircuitState | null)
    : null;
  return state?.openUntil && state.openUntil > nowSeconds()
    ? state.openUntil
    : nowSeconds() + retryDelay;
}

async function clearCircuit(env: Env | undefined, endpoint: string) {
  if (!env) return;
  await circuitStub(env, endpoint)
    .fetch("https://coordinator/circuit-success", { method: "POST" })
    .catch(() => undefined);
}

async function steamJson<T>(
  path: string,
  params: Record<string, string>,
  env?: Env,
  endpoint = path
) {
  const circuit = await readCircuitState(env, endpoint);
  if (circuit && circuit.openUntil > nowSeconds()) {
    throw new SteamRequestError(
      `Steam circuit open: ${endpoint}`,
      undefined,
      circuit.openUntil,
      true
    );
  }
  const url = new URL(`https://api.steampowered.com/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError(`Steam request failed: ${endpoint}`, undefined, retryAt);
  }
  if (!response.ok) {
    if (response.status === 429) recordMetric("steam429");
    if (response.status >= 500) recordMetric("steam5xx");
    recordMetric("upstreamErrors");
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const retryAt = isCircuitFailureStatus(response.status)
      ? await recordCircuitFailure(env, endpoint, retryAfter)
      : nowSeconds() + (retryAfter ?? failedRetryTtlSeconds);
    throw new SteamRequestError(`Steam HTTP ${response.status}`, response.status, retryAt);
  }
  try {
    const value = await response.json<T>();
    if (circuit) await clearCircuit(env, endpoint);
    return value;
  } catch (error) {
    if (error instanceof SteamRequestError) throw error;
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError(`Invalid Steam response: ${endpoint}`, undefined, retryAt);
  }
}

async function fetchOwnedGames(steamId: string, apiKey: string, env: Env) {
  const value = await steamJson<{
    response?: { game_count?: number; games?: OwnedGame[] };
  }>(
    "IPlayerService/GetOwnedGames/v1/",
    {
      key: apiKey,
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
    },
    env,
    "owned-games"
  );
  if (Array.isArray(value.response?.games)) {
    if (value.response.games.length === 0 && (value.response.game_count ?? 0) > 0) {
      throw new SteamRequestError(
        "Steam owned-games response was internally inconsistent",
        undefined,
        nowSeconds() + failedRetryTtlSeconds
      );
    }
    return value.response.games;
  }
  if (value.response?.game_count === 0) return [];
  throw new SteamRequestError(
    "Steam owned-games response did not confirm library visibility",
    undefined,
    nowSeconds() + failedRetryTtlSeconds
  );
}

async function fetchWishlistTitles(steamId: string, env: Env) {
  const titles = new Map<string, string>();
  const endpoint = "wishlist-titles";
  const circuit = await readCircuitState(env, endpoint);
  if (circuit && circuit.openUntil > nowSeconds()) return titles;

  for (let page = 0; page < 10; page += 1) {
    const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${page}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      });
    } catch {
      await recordCircuitFailure(env, endpoint);
      break;
    }
    if (!response.ok) {
      if (isCircuitFailureStatus(response.status)) {
        await recordCircuitFailure(
          env,
          endpoint,
          parseRetryAfter(response.headers.get("retry-after"))
        );
      }
      break;
    }
    let payload: Record<string, { appid?: number; name?: string }> | null = null;
    try {
      payload = await response.json();
    } catch {
      await recordCircuitFailure(env, endpoint);
      break;
    }
    const entries = payload && typeof payload === "object" ? Object.entries(payload) : [];
    if (!entries.length) break;
    for (const [key, item] of entries) {
      const appId =
        item?.appid != null && Number.isFinite(item.appid) ? String(item.appid) : key;
      const title = typeof item?.name === "string" ? item.name.trim() : "";
      if (appId && title) titles.set(appId, title);
    }
    if (entries.length < 100) break;
  }
  await clearCircuit(env, endpoint);
  return titles;
}

async function fetchWishlist(steamId: string, apiKey: string, env: Env) {
  const value = await steamJson<{
    response?: {
      items?: Array<{ appid?: number; priority?: number; date_added?: number }>;
    };
  }>(
    "IWishlistService/GetWishlist/v1/",
    { key: apiKey, steamid: steamId },
    env,
    "wishlist"
  );
  const rawItems = value.response?.items ?? [];
  const titles = await fetchWishlistTitles(steamId, env);
  const items = sortWishlistItems(
    rawItems
      .map((item) => {
        const appId = item.appid != null ? String(item.appid) : "";
        if (!appId) return null;
        const title = titles.get(appId);
        return {
          appId,
          priority: Number(item.priority ?? 0) || 0,
          dateAdded: Number(item.date_added ?? 0) || 0,
          ...(title ? { title } : {}),
        } satisfies WishlistItem;
      })
      .filter((item): item is WishlistItem => item != null)
  );
  return items;
}

async function fetchRecommendedTags(steamId: string, apiKey: string, env: Env) {
  const value = await steamJson<{
    response?: { tags?: unknown[] };
    tags?: unknown[];
  }>(
    "IStoreService/GetRecommendedTagsForUser/v1/",
    { key: apiKey, steamid: steamId },
    env,
    "recommended-tags"
  );
  return value.response?.tags ?? value.tags ?? [];
}

type SchemaGame = {
  gameName?: string;
  availableGameStats?: {
    achievements?: Array<{
      name?: string;
      displayName?: string;
      title?: string;
      description?: string;
      icon?: string;
      icongray?: string;
      iconGray?: string;
    }>;
  };
};

type SchemaCacheEntry = SchemaGame & {
  fetchedAt?: number;
  empty?: boolean;
};

async function fetchGameAchievementSchema(
  env: Env,
  appId: string,
  apiKey: string,
  language = "english"
) {
  const lang = language.trim() || "english";
  const cached = await env.STATS_CACHE
    .get(schemaCacheKey(lang, appId), "json")
    .catch(() => null);
  if (cached) {
    return cached as SchemaGame;
  }

  try {
    const value = await steamJson<{ game?: SchemaGame }>(
      "ISteamUserStats/GetSchemaForGame/v2/",
      {
        key: apiKey,
        appid: appId,
        l: lang,
      },
      env,
      "schema"
    );

    if (value.game) {
      const achievements = normalizeSchemaAchievements(value.game);
      const schemaCacheEntry: SchemaCacheEntry = {
        ...value.game,
        fetchedAt: nowSeconds(),
        empty: achievements.length === 0,
      };
      await env.STATS_CACHE.put(
        schemaCacheKey(lang, appId),
        JSON.stringify(schemaCacheEntry),
        {
          expirationTtl: achievements.length > 0
            ? 365 * 24 * 60 * 60
            : emptySchemaCacheTtlSeconds,
        }
      ).catch(() => undefined);
    }
    return value.game;
  } catch {
    return undefined;
  }
}

type GlobalPercentCacheEntry = {
  percentages?: Array<[string, number]>;
  cachedAt?: number;
};

type GlobalPercentagesPayload = {
  achievementpercentages?: {
    achievements?: Array<{ name?: string; percent?: number }>;
  };
};

async function fetchGlobalAchievementPercentages(
  env: Env,
  appId: string
): Promise<Map<string, number>> {
  const cacheKey = globalPercentCacheKey(appId);
  const cached = await env.STATS_CACHE
    .get<GlobalPercentCacheEntry>(cacheKey, "json")
    .catch(() => null);
  if (cached && Array.isArray(cached.percentages)) {
    return new Map(cached.percentages);
  }

  // A Steam failure must not be cached as "this game has no percentages":
  // only a successful response (even an empty one) is written to KV.
  let percentages: Map<string, number>;
  try {
    const value = await steamJson<GlobalPercentagesPayload>(
      "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
      { gameid: appId },
      env,
      "global-percentages"
    );
    percentages = normalizeGlobalPercentages(value);
  } catch (error) {
    console.warn(
      "Global achievement percentages unavailable",
      appId,
      error instanceof Error ? error.message : String(error)
    );
    return new Map();
  }

  const entry: GlobalPercentCacheEntry = {
    percentages: [...percentages],
    cachedAt: nowSeconds(),
  };
  await env.STATS_CACHE.put(cacheKey, JSON.stringify(entry), {
    expirationTtl:
      percentages.size > 0
        ? globalPercentCacheTtlSeconds
        : emptyGlobalPercentCacheTtlSeconds,
  }).catch(() => undefined);

  return percentages;
}

async function storeJsonFetch(
  url: string,
  env: Env,
  endpoint: string,
  accept = "application/json,text/plain,*/*"
) {
  const circuit = await readCircuitState(env, endpoint);
  if (circuit && circuit.openUntil > nowSeconds()) {
    throw new SteamRequestError(
      `Steam circuit open: ${endpoint}`,
      undefined,
      circuit.openUntil,
      true
    );
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept,
        "user-agent": storeUserAgent,
        // Steam's Store endpoints are more reliable with the same mature-content
        // cookie used by the similar-games route, especially from Cloudflare POPs.
        cookie:
          "birthtime=568022401; lastagecheckage=1-January-1988; wants_mature_content=1",
      },
    });
  } catch (error) {
    console.warn("Steam store request failed", endpoint, error instanceof Error ? error.message : String(error));
    recordMetric("upstreamErrors");
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError(`Steam store request failed: ${endpoint}`, undefined, retryAt);
  }
  if (!response.ok) {
    console.warn("Steam store HTTP error", endpoint, response.status);
    if (response.status === 429) recordMetric("steam429");
    if (response.status >= 500) recordMetric("steam5xx");
    recordMetric("upstreamErrors");
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const retryAt = isCircuitFailureStatus(response.status)
      ? await recordCircuitFailure(env, endpoint, retryAfter)
      : nowSeconds() + (retryAfter ?? failedRetryTtlSeconds);
    throw new SteamRequestError(`Steam store HTTP ${response.status}`, response.status, retryAt);
  }
  try {
    const value = await response.json<Record<string, unknown>>();
    await clearCircuit(env, endpoint);
    return value;
  } catch (error) {
    console.warn("Steam store invalid JSON", endpoint, error instanceof Error ? error.message : String(error));
    recordMetric("upstreamErrors");
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError(`Invalid Steam store response: ${endpoint}`, undefined, retryAt);
  }
}

function reviewsEmpty(value: Record<string, unknown> | null | undefined) {
  const reviews = value?.reviews;
  return !Array.isArray(reviews) || reviews.length === 0;
}

function reviewsHasSummary(value: Record<string, unknown> | null | undefined) {
  const summary = value?.query_summary;
  if (!summary || typeof summary !== "object") return false;
  const total =
    Number((summary as { total_reviews?: number }).total_reviews ?? 0) ||
    Number((summary as { num_reviews?: number }).num_reviews ?? 0);
  return total > 0;
}

function reviewsResponseValid(value: Record<string, unknown> | null | undefined) {
  return Number(value?.success) === 1 && Array.isArray(value?.reviews);
}

function logInvalidReviewsResponse(context: string, value: Record<string, unknown> | null | undefined) {
  if (reviewsResponseValid(value)) return;
  console.warn("Invalid Steam reviews response", context, {
    success: value?.success,
    keys: value ? Object.keys(value).slice(0, 12) : [],
    error: value?.error,
  });
}

async function fetchStoreReviews(
  appId: string,
  language: string,
  reviewType: string,
  filter: string,
  purchaseType: string,
  env: Env
) {
  const url = new URL(`https://store.steampowered.com/appreviews/${appId}`);
  url.searchParams.set("json", "1");
  url.searchParams.set("language", language);
  url.searchParams.set("filter", filter);
  url.searchParams.set("num_per_page", "60");
  url.searchParams.set("review_type", reviewType);
  url.searchParams.set("purchase_type", purchaseType);
  return storeJsonFetch(url.toString(), env, "store-reviews-v2");
}

async function fetchGameReviewsWithFallbacks(
  appId: string,
  language: string,
  reviewType: string,
  env: Env
) {
  const primaryFilter = reviewType === "all" ? "recent" : "all";
  let best: Record<string, unknown> | null = null;
  try {
    best = await fetchStoreReviews(appId, language, reviewType, primaryFilter, "steam", env);
    logInvalidReviewsResponse(`${language}:${primaryFilter}:steam`, best);
    if (!reviewsResponseValid(best)) best = null;
    if (!reviewsEmpty(best) || reviewsHasSummary(best)) return best;
  } catch {
    best = null;
  }

  const fallbacks: Array<[string, string, string]> =
    reviewType === "all"
      ? [
          [language, "recent", "all"],
          [language, "updated", "steam"],
          ["all", "recent", "steam"],
          ["all", "recent", "all"],
        ]
      : [
          [language, "all", "all"],
          ["all", "all", "steam"],
          ["all", "all", "all"],
        ];

  for (const [fallbackLanguage, fallbackFilter, fallbackPurchase] of fallbacks) {
    try {
      const result = await fetchStoreReviews(
        appId,
        fallbackLanguage,
        reviewType,
        fallbackFilter,
        fallbackPurchase,
        env
      );
      logInvalidReviewsResponse(`${fallbackLanguage}:${fallbackFilter}:${fallbackPurchase}`, result);
      if (!reviewsResponseValid(result)) continue;
      if (!reviewsEmpty(result) || reviewsHasSummary(result)) return result;
      if (!best) best = result;
    } catch {
      // try next fallback
    }
  }
  if (best) return best;
  throw new SteamRequestError(
    "All Steam review requests failed",
    undefined,
    nowSeconds() + failedRetryTtlSeconds
  );
}

async function fetchReviewHistogram(appId: string, env: Env) {
  const url = new URL(`https://store.steampowered.com/appreviewhistogram/${appId}`);
  url.searchParams.set("json", "1");
  url.searchParams.set("l", "portuguese");
  const histogram = await storeJsonFetch(url.toString(), env, "store-review-histogram-v2");
  if (Number(histogram.success) !== 1) return undefined;
  return histogram.results;
}

async function fetchSimilarAppIds(appId: string, env: Env) {
  const endpoint = "store-similar";
  const circuit = await readCircuitState(env, endpoint);
  if (circuit && circuit.openUntil > nowSeconds()) {
    throw new SteamRequestError(
      "Steam similar-games circuit is open",
      undefined,
      circuit.openUntil,
      true
    );
  }

  const url = `https://store.steampowered.com/recommended/morelike/app/${appId}/?l=english&cc=br`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "text/html,*/*",
        "user-agent": storeUserAgent,
        cookie:
          "birthtime=568022401; lastagecheckage=1-January-1988; wants_mature_content=1",
      },
    });
  } catch {
    recordMetric("upstreamErrors");
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError("Steam similar-games request failed", undefined, retryAt);
  }
  if (!response.ok) {
    if (response.status === 429) recordMetric("steam429");
    if (response.status >= 500) recordMetric("steam5xx");
    recordMetric("upstreamErrors");
    let retryAt = nowSeconds() + failedRetryTtlSeconds;
    if (isCircuitFailureStatus(response.status)) {
      retryAt = await recordCircuitFailure(
        env,
        endpoint,
        parseRetryAfter(response.headers.get("retry-after"))
      );
    }
    throw new SteamRequestError(
      `Steam similar-games HTTP ${response.status}`,
      response.status,
      retryAt
    );
  }
  const html = await response.text().catch(() => "");
  if (!html) {
    recordMetric("upstreamErrors");
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError("Empty Steam similar-games response", undefined, retryAt);
  }
  const normalizedHtml = html.toLowerCase();
  if (
    !html.includes('data-ds-appid="') &&
    (normalizedHtml.includes("access denied") ||
      normalizedHtml.includes("captcha") ||
      normalizedHtml.includes("site error"))
  ) {
    recordMetric("upstreamErrors");
    const retryAt = await recordCircuitFailure(env, endpoint);
    throw new SteamRequestError("Steam similar-games challenge page", undefined, retryAt);
  }
  await clearCircuit(env, endpoint);
  return parseSimilarAppIds(html, appId);
}

function shouldRefresh(entry: AchievementEntry | undefined, game: OwnedGame, now: number) {
  if (!entry) return true;
  if (entry.playtimeForever !== game.playtime_forever) return true;
  if (entry.totalAchievements > 0 && !entry.achievements?.length) return true;
  if (entry.retryAt) return now >= entry.retryAt;
  let ttl = achievementCacheTtlSeconds;
  if (entry.lastError === "no_stats") ttl = noStatsCacheTtlSeconds;
  else if (entry.lastError) ttl = failedRetryTtlSeconds;
  return now - entry.lastFetchedAt > ttl;
}

function pendingGamesForCache(cache: StatsCache, now = nowSeconds()) {
  return cache.ownedGames.filter(
    (game) =>
      game.playtime_forever > 0 &&
      shouldRefresh(cache.games[String(game.appid)], game, now)
  );
}

async function fetchAchievementEntry(
  steamId: string,
  apiKey: string,
  game: OwnedGame,
  env: Env,
  previous?: AchievementEntry
): Promise<[string, AchievementEntry]> {
  const now = nowSeconds();
  const appId = String(game.appid);

  try {
    const value = await steamJson<{
      playerstats?: {
        achievements?: Array<{
          apiname?: string;
          name?: string;
          achieved?: number;
          unlocktime?: number;
        }>;
      };
    }>(
      "ISteamUserStats/GetPlayerAchievements/v1/",
      {
        key: apiKey,
        steamid: steamId,
        appid: appId,
      },
      env,
      "achievements"
    );
    const achievements = value.playerstats?.achievements ?? [];
    const unlocked = achievements.filter((achievement) => achievement.achieved === 1);
    const schema =
      achievements.length > 0
        ? await fetchGameAchievementSchema(env, appId, apiKey)
        : undefined;
    const schemaAchievements = new Map(
      (schema?.availableGameStats?.achievements ?? [])
        .filter((achievement) => achievement.name)
        .map((achievement) => [achievement.name!, achievement])
    );
    const gameTitle = schema?.gameName || game.name || `Steam ${appId}`;
    const achievementList = achievements.map((achievement) => {
      const id = achievement.apiname || achievement.name || "achievement";
      const schemaAchievement = schemaAchievements.get(id);
      const unlockedAt = achievement.unlocktime || 0;
      return {
        name: id,
        title: schemaAchievement?.displayName || achievement.name || id,
        description: schemaAchievement?.description || "",
        icon: schemaAchievement?.icon || "",
        iconGray: schemaAchievement?.icongray || schemaAchievement?.icon || "",
        unlocked: achievement.achieved === 1,
        unlockedAt,
      };
    });
    const recentAchievements = unlocked
      .map((achievement) => {
        const id = achievement.apiname || achievement.name || "achievement";
        const schemaAchievement = schemaAchievements.get(id);
        return {
          id: `${appId}-${id}`,
          title: schemaAchievement?.displayName || achievement.name || id,
          gameTitle,
          icon: schemaAchievement?.icon || schemaAchievement?.icongray || "",
          appId,
          unlockedAt: achievement.unlocktime || 0,
        };
      })
      .filter((achievement) => achievement.unlockedAt > 0 && achievement.icon)
      .sort((left, right) => right.unlockedAt - left.unlockedAt)
      .slice(0, 8);

    return [
      appId,
      {
        playtimeForever: game.playtime_forever,
        unlockedAchievements: unlocked.length,
        totalAchievements: achievements.length,
        hasAchievements: achievements.length > 0,
        achievements: achievementList,
        recentAchievements,
        lastFetchedAt: now,
      },
    ];
  } catch (error) {
    const requestError = error instanceof SteamRequestError ? error : undefined;
    const noStats = requestError?.status === 400;
    const stale = previous ?? {
      playtimeForever: game.playtime_forever,
      unlockedAchievements: 0,
      totalAchievements: 0,
      hasAchievements: false,
      recentAchievements: [],
      lastFetchedAt: now,
    };
    return [
      appId,
      {
        ...stale,
        playtimeForever: game.playtime_forever,
        lastFetchedAt: now,
        lastError: noStats
          ? "no_stats"
          : requestError?.circuitOpen
            ? "circuit_open"
            : "request_failed",
        retryAt: noStats
          ? undefined
          : requestError?.retryAt ?? now + failedRetryTtlSeconds,
      },
    ];
  }
}

function buildStats(cache: StatsCache, privateProfile: boolean): AccountStats {
  const now = nowSeconds();
  const eligibleGames = cache.ownedGames.filter((game) => game.playtime_forever > 0);
  const eligibleIds = new Set(eligibleGames.map((game) => String(game.appid)));
  const ownedIds = new Set(cache.ownedGames.map((game) => String(game.appid)));
  const entries = Object.entries(cache.games).filter(([appId]) => ownedIds.has(appId));
  const gamesWithAchievements = entries
    .map(([, entry]) => entry)
    .filter((entry) => entry.totalAchievements > 0);
  const scannedGames = entries.filter(
    ([appId, entry]) => eligibleIds.has(appId) && entry.lastFetchedAt > 0
  ).length;
  const pendingGames = eligibleGames.filter((game) =>
    shouldRefresh(cache.games[String(game.appid)], game, now)
  ).length;
  const nextRetryAt = entries.reduce<number | undefined>((next, [, entry]) => {
    if (!entry.retryAt || entry.retryAt <= now) return next;
    return next === undefined ? entry.retryAt : Math.min(next, entry.retryAt);
  }, undefined);
  const recentAchievements = entries
    .flatMap(([, entry]) => entry.recentAchievements ?? [])
    .sort((left, right) => right.unlockedAt - left.unlockedAt)
    .slice(0, 32);
  const ownedPlaytimes = cache.ownedGames.map((game) => ({
    appId: String(game.appid),
    name: game.name,
    playtimeForever: game.playtime_forever,
    rtimeLastPlayed: game.rtime_last_played ?? 0,
  }));
  const achievements = entries
    .map(([appId, entry]) => ({
      appId,
      gameTitle:
        cache.ownedGames.find((game) => String(game.appid) === appId)?.name ||
        `Steam ${appId}`,
      achievements: entry.achievements ?? [],
    }))
    .filter((game) => game.achievements.length > 0);

  return {
    steamId: cache.steamId,
    gamesCount: cache.ownedGames.length,
    totalPlaytimeMinutes: cache.ownedGames.reduce(
      (total, game) => total + game.playtime_forever,
      0
    ),
    unlockedAchievements:
      cache.communitySummary?.unlockedAchievements ??
      entries.reduce((total, [, entry]) => total + entry.unlockedAchievements, 0),
    totalAchievements: entries.reduce(
      (total, [, entry]) => total + entry.totalAchievements,
      0
    ),
    perfectGames:
      cache.communitySummary?.perfectGames ??
      gamesWithAchievements.filter(
        (entry) => entry.unlockedAchievements >= entry.totalAchievements
      ).length,
    averageProgress:
      cache.communitySummary?.averageProgress ??
      (gamesWithAchievements.length
        ? Math.round(
            (gamesWithAchievements.reduce(
              (total, entry) =>
                total + entry.unlockedAchievements / entry.totalAchievements,
              0
            ) /
              gamesWithAchievements.length) *
              100
          )
        : 0),
    scannedGames,
    pendingGames,
    failedGames: entries.filter(
      ([, entry]) => entry.lastError && entry.lastError !== "no_stats"
    ).length,
    fetchedAt: cache.fetchedAt,
    private: privateProfile,
    hasApiKey: true,
    scanInProgress: cache.scanInProgress,
    nextPollAfter:
      cache.scanInProgress || pendingGames > 0
        ? 120
        : nextRetryAt
          ? Math.max(30, nextRetryAt - now)
          : 0,
    recentAchievements,
    ownedPlaytimes,
    achievements,
  };
}

async function saveCache(env: Env, cache: StatsCache) {
  await env.STATS_CACHE.put(statsCacheKey(cache.steamId), JSON.stringify(cache), {
    expirationTtl: accountCacheTtlSeconds,
  });
}

function scanCoordinator(env: Env, steamId: string) {
  return env.SCAN_COORDINATOR.get(env.SCAN_COORDINATOR.idFromName(steamId));
}

async function acquireScan(env: Env, steamId: string) {
  const response = await scanCoordinator(env, steamId).fetch("https://scan/acquire", {
    method: "POST",
  });
  return response.ok ? response.text() : null;
}

async function renewScan(env: Env, steamId: string, token: string) {
  const response = await scanCoordinator(env, steamId).fetch("https://scan/renew", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return response.ok;
}

async function releaseScan(env: Env, steamId: string, token: string) {
  await scanCoordinator(env, steamId).fetch("https://scan/release", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function scheduleScan(env: Env, steamId: string) {
  await scanCoordinator(env, steamId).fetch("https://scan/schedule", {
    method: "POST",
    body: steamId,
  });
}

async function runAchievementScan(
  env: Env,
  steamId: string,
  renew: () => Promise<boolean>
) {
  const cache = await readStatsCache(env, steamId);
  if (!cache) return false;
  const nextCache: StatsCache = {
    ...cache,
    games: { ...cache.games },
    scanInProgress: true,
  };
  const now = nowSeconds();
  let remaining = pendingGamesForCache(cache, now).sort(
    compareOwnedGamesForAchievementScan
  );
  let batches = 0;

  while (remaining.length > 0 && batches < maxBatchesPerScan) {
    const batch = remaining.slice(0, maxScanBatchPerRequest);
    remaining = remaining.slice(batch.length);
    batches += 1;

    for (let index = 0; index < batch.length; index += scanConcurrency) {
      const chunk = batch.slice(index, index + scanConcurrency);
      const results = await Promise.all(
        chunk.map((game) =>
          fetchAchievementEntry(
            cache.steamId,
            env.STEAM_WEB_API_KEY,
            game,
            env,
            nextCache.games[String(game.appid)]
          )
        )
      );
      for (const [appId, entry] of results) {
        nextCache.games[appId] = entry;
      }
      nextCache.fetchedAt = nowSeconds();
      nextCache.scanInProgress =
        remaining.length > 0 || index + scanConcurrency < batch.length;
      await saveCache(env, nextCache);
      if (!(await renew())) return false;
    }
  }

  nextCache.scanInProgress = remaining.length > 0;
  nextCache.fetchedAt = nowSeconds();
  await saveCache(env, nextCache);
  return remaining.length > 0;
}

export class ScanCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  private async localAcquire() {
    const lockedUntil = (await this.state.storage.get<number>("lockedUntil")) || 0;
    if (lockedUntil > Date.now()) return null;
    const token = crypto.randomUUID();
    await this.state.storage.put("lockToken", token);
    await this.state.storage.put("lockedUntil", Date.now() + 10 * 60 * 1000);
    return token;
  }

  private async localRenew(token: string) {
    const currentToken = await this.state.storage.get<string>("lockToken");
    if (!token || token !== currentToken) return false;
    await this.state.storage.put("lockedUntil", Date.now() + 10 * 60 * 1000);
    return true;
  }

  private async localRelease(token: string) {
    const currentToken = await this.state.storage.get<string>("lockToken");
    if (!token || token !== currentToken) return;
    await this.state.storage.delete("lockToken");
    await this.state.storage.delete("lockedUntil");
  }

  async alarm() {
    const steamId = await this.state.storage.get<string>("steamId");
    if (!steamId || !this.env.STEAM_WEB_API_KEY) return;

    // Use in-DO locks only. Calling this DO via fetch from alarm deadlocks.
    const token = await this.localAcquire();
    if (!token) {
      await this.state.storage.setAlarm(Date.now() + scanContinueDelayMs);
      return;
    }

    try {
      const hasMore = await runAchievementScan(this.env, steamId, () =>
        this.localRenew(token)
      );
      if (hasMore) {
        await this.state.storage.setAlarm(Date.now() + scanContinueDelayMs);
      }
    } finally {
      await this.localRelease(token);
    }
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/metrics-add") {
      const delta = (await request.json().catch(() => null)) as MetricsSnapshot | null;
      if (!delta) return new Response("invalid metrics", { status: 400 });
      const current =
        (await this.state.storage.get<MetricsSnapshot>("metrics")) ?? emptyMetrics();
      const next = mergeMetrics(current, delta);
      await this.state.storage.put("metrics", next);
      return Response.json(next);
    }
    if (path === "/metrics-read") {
      const metrics =
        (await this.state.storage.get<MetricsSnapshot>("metrics")) ?? emptyMetrics();
      return Response.json(metrics);
    }
    if (path === "/circuit-state") {
      const state = await this.state.storage.get<CircuitState>("circuit");
      if (!state) return new Response("not found", { status: 404 });
      return Response.json(state);
    }
    if (path === "/circuit-failure") {
      const now = nowSeconds();
      const previous = await this.state.storage.get<CircuitState>("circuit");
      const failures =
        !previous?.updatedAt || now - previous.updatedAt > circuitBaseBackoffSeconds
          ? 1
          : previous.failures + 1;
      const retryAfter = Number(
        ((await request.json().catch(() => ({}))) as { retryAfter?: number }).retryAfter ??
          0
      );
      const backoff = Math.min(
        circuitMaxBackoffSeconds,
        circuitBaseBackoffSeconds * 2 ** Math.max(0, failures - circuitFailureThreshold)
      );
      const state: CircuitState = {
        failures,
        openUntil:
          failures >= circuitFailureThreshold
            ? now + Math.max(retryAfter, backoff)
            : 0,
        retryAfter: retryAfter || undefined,
        updatedAt: now,
      };
      await this.state.storage.put("circuit", state);
      return Response.json(state);
    }
    if (path === "/circuit-success") {
      await this.state.storage.delete("circuit");
      return new Response("ok");
    }
    if (path === "/schedule") {
      const steamId = (await request.text()).trim();
      if (!validSteamId(steamId)) return new Response("bad steam id", { status: 400 });
      await this.state.storage.put("steamId", steamId);
      const existingAlarm = await this.state.storage.getAlarm();
      if (existingAlarm === null) {
        await this.state.storage.setAlarm(Date.now() + 100);
      }
      return new Response("ok");
    }
    if (path === "/acquire") {
      const token = await this.localAcquire();
      return token ? new Response(token) : new Response("locked", { status: 409 });
    }
    if (path === "/renew") {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      return (await this.localRenew(token))
        ? new Response("ok")
        : new Response("not owner", { status: 409 });
    }
    if (path === "/release") {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      await this.localRelease(token);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
}

async function handleAccountStats(
  request: Request,
  env: Env,
  context: ExecutionContext
) {
  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/account-stats", steamId);
  if (edgeHit) return edgeHit;

  if (await rateLimitExceeded(request, env)) {
    return jsonResponse(
      { error: "Rate limit exceeded", retryAfter: 60 },
      env,
      429,
      { extraHeaders: { "retry-after": "60" } }
    );
  }

  const cached = await readStatsCache(env, steamId);
  const now = nowSeconds();
  if (cached && now - ownedGamesFetchedAt(cached) < accountFreshTtlSeconds) {
    const pendingCached = pendingGamesForCache(cached, now);
    if (pendingCached.length > 0) {
      context.waitUntil(scheduleScan(env, steamId));
    }

    const stats = buildStats(
      { ...cached, scanInProgress: pendingCached.length > 0 },
      false
    );
    const response = jsonResponse(stats, env, 200, {
      cacheStatus: "KV",
      maxAge: stats.scanInProgress ? 0 : edgeCacheTtlSeconds,
    });
    if (!stats.scanInProgress) {
      await putEdgeCache("/steam/account-stats", steamId, response, context);
    }
    return response;
  }

  const token = await acquireScan(env, steamId);
  if (!token) {
    return cached
      ? jsonResponse(
          buildStats({ ...cached, scanInProgress: true }, false),
          env,
          200,
          { cacheStatus: "STALE" }
        )
      : jsonResponse(
          { error: "Steam account refresh is already in progress" },
          env,
          503
        );
  }

  let response: AccountStats;
  let shouldScan = false;
  try {
    const latest = (await readStatsCache(env, steamId)) ?? cached;
    const refreshStartedAt = nowSeconds();
    if (
      latest &&
      refreshStartedAt - ownedGamesFetchedAt(latest) < accountFreshTtlSeconds
    ) {
      const pending = pendingGamesForCache(latest, refreshStartedAt);
      shouldScan = pending.length > 0;
      response = buildStats({ ...latest, scanInProgress: shouldScan }, false);
    } else {
      let ownedGames: OwnedGame[];
      try {
        ownedGames = await fetchOwnedGames(steamId, env.STEAM_WEB_API_KEY, env);
      } catch (error) {
        const requestError = error instanceof SteamRequestError ? error : undefined;
        const retryAfter = Math.max(
          60,
          (requestError?.retryAt ?? refreshStartedAt + failedRetryTtlSeconds) -
            refreshStartedAt
        );
        if (latest) {
          response = {
            ...buildStats(latest, false),
            nextPollAfter: retryAfter,
          };
          return jsonResponse(response, env, 200, { cacheStatus: "STALE" });
        }
        return jsonResponse(
          { error: "Failed to fetch Steam account", retryAfter },
          env,
          502
        );
      }

      const cache: StatsCache = {
        steamId,
        communitySummary: latest?.communitySummary,
        ownedGames,
        ownedGamesFetchedAt: refreshStartedAt,
        games: latest?.games ?? {},
        fetchedAt: refreshStartedAt,
        scanInProgress: false,
      };
      const pending = pendingGamesForCache(cache, refreshStartedAt);
      shouldScan = pending.length > 0;
      cache.scanInProgress = shouldScan;
      await saveCache(env, cache);
      response = buildStats(cache, false);
    }
  } finally {
    await releaseScan(env, steamId, token);
  }

  if (shouldScan) context.waitUntil(scheduleScan(env, steamId));
  const finalResponse = jsonResponse(response, env, 200, {
    cacheStatus: "MISS",
    maxAge: response.scanInProgress ? 0 : edgeCacheTtlSeconds,
  });
  if (!response.scanInProgress) {
    await putEdgeCache("/steam/account-stats", steamId, finalResponse, context);
  }
  return finalResponse;
}

async function handlePlayerLevel(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/player-level", steamId);
  if (edgeHit) return edgeHit;

  const cacheKey = `steam-level:v1:${steamId}`;
  const cached = await env.STATS_CACHE.get<{ playerLevel: number; fetchedAt: number }>(
    cacheKey,
    "json"
  );
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < 6 * 60 * 60) {
    const response = jsonResponse(
      { steamId, playerLevel: cached.playerLevel },
      env,
      200,
      { cacheStatus: "KV", maxAge: 300 }
    );
    await putEdgeCache("/steam/player-level", steamId, response, context);
    return response;
  }

  try {
    const data = await steamJson<{ response?: { player_level?: number } }>(
      "IPlayerService/GetSteamLevel/v1/",
      { key: env.STEAM_WEB_API_KEY, steamid: steamId },
      env,
      "player-level"
    );
    const playerLevel = Number(data?.response?.player_level ?? 0);
    if (!Number.isFinite(playerLevel) || playerLevel < 0) {
      return jsonResponse({ error: "Invalid player level" }, env, 502);
    }
    await env.STATS_CACHE.put(
      cacheKey,
      JSON.stringify({ playerLevel, fetchedAt: now }),
      { expirationTtl: 24 * 60 * 60 }
    );
    const response = jsonResponse(
      { steamId, playerLevel },
      env,
      200,
      { cacheStatus: "MISS", maxAge: 300 }
    );
    await putEdgeCache("/steam/player-level", steamId, response, context);
    return response;
  } catch {
    if (cached) {
      return jsonResponse(
        { steamId, playerLevel: cached.playerLevel, stale: true },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ error: "Failed to fetch Steam level" }, env, 502);
  }
}

async function handleOwnedGames(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/owned-games", steamId);
  if (edgeHit) return edgeHit;

  const cached = await readStatsCache(env, steamId);
  const now = nowSeconds();
  if (
    cached?.ownedGames?.length &&
    now - ownedGamesFetchedAt(cached) < accountFreshTtlSeconds
  ) {
    const response = jsonResponse(
      {
        steamId,
        games: cached.ownedGames.map((game) => ({
          appId: String(game.appid),
          name: game.name ?? "",
          playtimeForever: game.playtime_forever,
          rtimeLastPlayed: game.rtime_last_played ?? 0,
        })),
      },
      env,
      200,
      { cacheStatus: "KV", maxAge: edgeCacheTtlSeconds }
    );
    await putEdgeCache("/steam/owned-games", steamId, response, context);
    return response;
  }

  const token = await acquireScan(env, steamId);
  if (!token) {
    return cached?.ownedGames?.length
      ? jsonResponse(
          {
            steamId,
            games: cached.ownedGames.map((game) => ({
              appId: String(game.appid),
              name: game.name ?? "",
              playtimeForever: game.playtime_forever,
              rtimeLastPlayed: game.rtime_last_played ?? 0,
            })),
          },
          env,
          200,
          { cacheStatus: "STALE" }
        )
      : jsonResponse(
          { error: "Steam account refresh is already in progress" },
          env,
          503
        );
  }

  try {
    const latest = (await readStatsCache(env, steamId)) ?? cached;
    if (
      latest?.ownedGames?.length &&
      nowSeconds() - ownedGamesFetchedAt(latest) < accountFreshTtlSeconds
    ) {
      const response = jsonResponse(
        {
          steamId,
          games: latest.ownedGames.map((game) => ({
            appId: String(game.appid),
            name: game.name ?? "",
            playtimeForever: game.playtime_forever,
            rtimeLastPlayed: game.rtime_last_played ?? 0,
          })),
        },
        env,
        200,
        { cacheStatus: "KV", maxAge: edgeCacheTtlSeconds }
      );
      await putEdgeCache("/steam/owned-games", steamId, response, context);
      return response;
    }

    const ownedGames = await fetchOwnedGames(steamId, env.STEAM_WEB_API_KEY, env);
    const nextCache: StatsCache = {
      steamId,
      communitySummary: latest?.communitySummary,
      ownedGames,
      ownedGamesFetchedAt: now,
      games: latest?.games ?? {},
      fetchedAt: now,
      scanInProgress: latest?.scanInProgress ?? false,
    };
    await saveCache(env, nextCache);
    const response = jsonResponse(
      {
        steamId,
        games: ownedGames.map((game) => ({
          appId: String(game.appid),
          name: game.name ?? "",
          playtimeForever: game.playtime_forever,
          rtimeLastPlayed: game.rtime_last_played ?? 0,
        })),
      },
      env,
      200,
      { cacheStatus: "MISS", maxAge: edgeCacheTtlSeconds }
    );
    await putEdgeCache("/steam/owned-games", steamId, response, context);
    return response;
  } catch {
    if (cached?.ownedGames?.length) {
      return jsonResponse(
        {
          steamId,
          stale: true,
          games: cached.ownedGames.map((game) => ({
            appId: String(game.appid),
            name: game.name ?? "",
            playtimeForever: game.playtime_forever,
            rtimeLastPlayed: game.rtime_last_played ?? 0,
          })),
        },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ error: "Failed to fetch owned games" }, env, 502);
  } finally {
    await releaseScan(env, steamId, token);
  }
}

async function handleWishlist(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/wishlist", steamId);
  if (edgeHit) return edgeHit;

  const cached = await env.STATS_CACHE.get<WishlistCache>(wishlistCacheKey(steamId), "json");
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < wishlistFreshTtlSeconds) {
    const response = jsonResponse(
      { steamId, items: cached.items },
      env,
      200,
      { cacheStatus: "KV", maxAge: Math.min(edgeCacheTtlSeconds, wishlistFreshTtlSeconds) }
    );
    await putEdgeCache("/steam/wishlist", steamId, response, context);
    return response;
  }

  try {
    const items = await fetchWishlist(steamId, env.STEAM_WEB_API_KEY, env);
    await env.STATS_CACHE.put(
      wishlistCacheKey(steamId),
      JSON.stringify({ steamId, items, fetchedAt: now } satisfies WishlistCache),
      { expirationTtl: wishlistCacheTtlSeconds }
    );
    const response = jsonResponse(
      { steamId, items },
      env,
      200,
      { cacheStatus: "MISS", maxAge: Math.min(edgeCacheTtlSeconds, wishlistFreshTtlSeconds) }
    );
    await putEdgeCache("/steam/wishlist", steamId, response, context);
    return response;
  } catch {
    if (cached?.items) {
      return jsonResponse(
        { steamId, items: cached.items, stale: true },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ error: "Failed to fetch wishlist" }, env, 502);
  }
}

async function handleRecommendedTags(
  request: Request,
  env: Env,
  context: ExecutionContext
) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/recommended-tags", steamId);
  if (edgeHit) return edgeHit;

  const cached = await env.STATS_CACHE.get<RecommendedTagsCache>(
    tagsCacheKey(steamId),
    "json"
  );
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < tagsFreshTtlSeconds) {
    const response = jsonResponse(
      { steamId, tags: cached.tags },
      env,
      200,
      { cacheStatus: "KV", maxAge: 300 }
    );
    await putEdgeCache("/steam/recommended-tags", steamId, response, context);
    return response;
  }

  try {
    const tags = await fetchRecommendedTags(steamId, env.STEAM_WEB_API_KEY, env);
    await env.STATS_CACHE.put(
      tagsCacheKey(steamId),
      JSON.stringify({ steamId, tags, fetchedAt: now } satisfies RecommendedTagsCache),
      { expirationTtl: tagsCacheTtlSeconds }
    );
    const response = jsonResponse(
      { steamId, tags },
      env,
      200,
      { cacheStatus: "MISS", maxAge: 300 }
    );
    await putEdgeCache("/steam/recommended-tags", steamId, response, context);
    return response;
  } catch {
    if (cached?.tags) {
      return jsonResponse(
        { steamId, tags: cached.tags, stale: true },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    // Match desktop: soft-fail to empty tags so Home recommendations degrade gracefully.
    const response = jsonResponse(
      { steamId, tags: [], softFail: true },
      env,
      200,
      { cacheStatus: "MISS", maxAge: 60 }
    );
    await putEdgeCache("/steam/recommended-tags", steamId, response, context);
    return response;
  }
}

async function handleGameReviews(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const appId = url.searchParams.get("appId");
  if (!validAppId(appId)) {
    return jsonResponse({ error: "Failed to fetch Steam reviews" }, env, 502);
  }
  const languageRaw = (url.searchParams.get("language") || "brazilian").trim();
  const language =
    languageRaw === "all" || languageRaw === "english" || languageRaw === "brazilian"
      ? languageRaw
      : "brazilian";
  const reviewTypeRaw = (url.searchParams.get("reviewType") || "all").trim();
  const reviewType =
    reviewTypeRaw === "positive" || reviewTypeRaw === "negative" ? reviewTypeRaw : "all";
  const cacheKey = `${appId}:${language}:${reviewType}`;
  const edgeHit = await matchEdgeCache("/steam/game-reviews", cacheKey);
  if (edgeHit) return edgeHit;

  const kvKey = reviewsCacheKey(appId, language, reviewType);
  const cached = await env.STATS_CACHE.get<{
    payload: Record<string, unknown>;
    fetchedAt: number;
  }>(kvKey, "json");
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < reviewsFreshTtlSeconds) {
    const response = jsonResponse(cached.payload, env, 200, {
      cacheStatus: "KV",
      maxAge: Math.min(edgeCacheTtlSeconds, reviewsFreshTtlSeconds),
    });
    await putEdgeCache("/steam/game-reviews", cacheKey, response, context);
    return response;
  }

  try {
    const reviews = await fetchGameReviewsWithFallbacks(appId, language, reviewType, env);
    if (reviewType === "all") {
      try {
        const histogram = await fetchReviewHistogram(appId, env);
        if (histogram != null) reviews.reviewHistogram = histogram;
      } catch {
        // histogram is optional
      }
    }
    await env.STATS_CACHE.put(
      kvKey,
      JSON.stringify({ payload: reviews, fetchedAt: now }),
      { expirationTtl: reviewsCacheTtlSeconds }
    );
    const response = jsonResponse(reviews, env, 200, {
      cacheStatus: "MISS",
      maxAge: Math.min(edgeCacheTtlSeconds, reviewsFreshTtlSeconds),
    });
    await putEdgeCache("/steam/game-reviews", cacheKey, response, context);
    return response;
  } catch {
    if (cached?.payload) {
      return jsonResponse(
        { ...cached.payload, stale: true },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ success: 0, reviews: [] }, env, 200);
  }
}

const emptyFeatured = { topSellers: [], newReleases: [], comingSoon: [] };

async function handleFeatured(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const { cc, language } = featuredRegion(url);
  const cacheKey = `${cc}:${language}`;
  const edgeHit = await matchEdgeCache("/steam/featured", cacheKey);
  if (edgeHit) return edgeHit;

  const kvKey = featuredCacheKey(cc, language);
  const cached = await env.STATS_CACHE.get<{
    payload: ReturnType<typeof normalizeFeaturedCategories>;
    fetchedAt: number;
  }>(kvKey, "json");
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < featuredFreshTtlSeconds) {
    const response = jsonResponse(cached.payload, env, 200, {
      cacheStatus: "KV",
      maxAge: Math.min(edgeCacheTtlSeconds, featuredFreshTtlSeconds),
    });
    await putEdgeCache("/steam/featured", cacheKey, response, context);
    return response;
  }

  try {
    const raw = await storeJsonFetch(
      `https://store.steampowered.com/api/featuredcategories?cc=${cc}&l=${language}`,
      env,
      "store-featured"
    );
    const featured = normalizeFeaturedCategories(raw);
    await env.STATS_CACHE.put(
      kvKey,
      JSON.stringify({ payload: featured, fetchedAt: now }),
      { expirationTtl: featuredCacheTtlSeconds }
    );
    const response = jsonResponse(featured, env, 200, {
      cacheStatus: "MISS",
      maxAge: Math.min(edgeCacheTtlSeconds, featuredFreshTtlSeconds),
    });
    await putEdgeCache("/steam/featured", cacheKey, response, context);
    return response;
  } catch {
    if (cached?.payload) {
      return jsonResponse({ ...cached.payload, stale: true }, env, 200, { cacheStatus: "STALE" });
    }
    return jsonResponse(emptyFeatured, env, 200);
  }
}

async function handleGameSchema(request: Request, env: Env, context: ExecutionContext) {
  const url = new URL(request.url);
  const appId = url.searchParams.get("appId");
  if (!validAppId(appId)) {
    return jsonResponse({ appId: "", achievements: [] }, env, 200);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }
  const requestedLanguage = (url.searchParams.get("language") || "brazilian")
    .trim()
    .toLowerCase();
  const primaryLanguage = ["portuguese", "brazilian", "english"].includes(
    requestedLanguage
  )
    ? requestedLanguage
    : "brazilian";
  const languageFallback = [
    primaryLanguage,
    ...["brazilian", "portuguese", "english"].filter(
      (language) => language !== primaryLanguage
    ),
  ];
  const cacheKey = `${appId}:${primaryLanguage}`;
  const edgeHit = await matchEdgeCache("/steam/game-schema", cacheKey);
  if (edgeHit) return edgeHit;

  if (await rateLimitExceeded(request, env)) {
    return jsonResponse(
      { appId, language: primaryLanguage, achievements: [], status: "rate-limited", retryAfter: 60 },
      env,
      429,
      { extraHeaders: { "retry-after": "60" } }
    );
  }

  let language = primaryLanguage;
  let game: SchemaGame | undefined;
  let achievements: ReturnType<typeof normalizeSchemaAchievements> = [];
  for (const candidate of languageFallback) {
    game = await fetchGameAchievementSchema(
      env,
      appId,
      env.STEAM_WEB_API_KEY,
      candidate
    );
    achievements = normalizeSchemaAchievements(game);
    language = candidate;
    if (achievements.length > 0) break;
  }

  // Best-effort: a missing percentage only costs the client a fallback label,
  // so it must never turn a working schema response into a failure.
  if (achievements.length > 0) {
    const percentages = await fetchGlobalAchievementPercentages(env, appId);
    if (percentages.size > 0) {
      achievements = mergeGlobalPercentages(achievements, percentages);
    }
  }

  const response = jsonResponse(
    {
      appId,
      language,
      achievements,
      status: achievements.length > 0 ? "ready" : game ? "no-achievements" : "unavailable",
      retryAfter: game ? undefined : failedRetryTtlSeconds,
    },
    env,
    200,
    {
      cacheStatus: game ? "KV" : "MISS",
      maxAge: achievements.length > 0 ? 300 : 60,
    }
  );
  if (game) {
    await putEdgeCache("/steam/game-schema", cacheKey, response, context);
  }
  return response;
}

async function handleSimilar(request: Request, env: Env, context: ExecutionContext) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const appId = url.searchParams.get("appId");
  if (!validAppId(appId)) {
    return jsonResponse({ appId: "", appIds: [] }, env, 200);
  }

  const edgeHit = await matchEdgeCache("/steam/similar", appId);
  if (edgeHit) return edgeHit;

  const cached = await env.STATS_CACHE.get<{ appIds: string[]; fetchedAt: number }>(
    similarCacheKey(appId),
    "json"
  );
  const now = nowSeconds();
  const cachedFreshTtl = cached?.appIds.length
    ? similarFreshTtlSeconds
    : similarEmptyFreshTtlSeconds;
  if (cached && now - cached.fetchedAt < cachedFreshTtl) {
    const response = jsonResponse(
      { appId, appIds: cached.appIds },
      env,
      200,
      { cacheStatus: "KV", maxAge: cached.appIds.length ? 300 : 60 }
    );
    await putEdgeCache("/steam/similar", appId, response, context);
    return response;
  }

  try {
    const appIds = await fetchSimilarAppIds(appId, env);
    await env.STATS_CACHE.put(
      similarCacheKey(appId),
      JSON.stringify({ appIds, fetchedAt: now }),
      { expirationTtl: similarCacheTtlSeconds }
    );
    const response = jsonResponse(
      { appId, appIds },
      env,
      200,
      { cacheStatus: "MISS", maxAge: appIds.length ? 300 : 60 }
    );
    await putEdgeCache("/steam/similar", appId, response, context);
    return response;
  } catch {
    if (cached) {
      return jsonResponse(
        { appId, appIds: cached.appIds, stale: true },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ error: "Failed to fetch similar games" }, env, 502);
  }
}

async function fetchPlayerSummary(steamId: string, apiKey: string, env: Env) {
  const value = await steamJson<{
    response?: {
      players?: Array<{
        steamid?: string;
        personaname?: string;
        profileurl?: string;
        avatarfull?: string;
        avatarmedium?: string;
        avatar?: string;
      }>;
    };
  }>(
    "ISteamUser/GetPlayerSummaries/v2/",
    { key: apiKey, steamids: steamId },
    env,
    "player-summary"
  );
  const player = value.response?.players?.[0];
  if (!player || player.steamid !== steamId) return null;
  const avatarUrl =
    (player.avatarfull || player.avatarmedium || player.avatar || "").trim() || "";
  return {
    steamId,
    displayName: (player.personaname || `Steam ${steamId}`).trim(),
    avatarUrl,
    profileUrl:
      (player.profileurl || `https://steamcommunity.com/profiles/${steamId}`).trim(),
  };
}

async function handlePlayerSummary(
  request: Request,
  env: Env,
  context: ExecutionContext
) {
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }

  const url = new URL(request.url);
  const steamId = url.searchParams.get("steamId");
  if (!validSteamId(steamId)) {
    return jsonResponse({ error: "Invalid Steam ID" }, env, 400);
  }
  if (!env.STEAM_WEB_API_KEY) {
    return jsonResponse({ error: "Steam Web API key is not configured" }, env, 500);
  }

  const edgeHit = await matchEdgeCache("/steam/player-summary", steamId);
  if (edgeHit) return edgeHit;

  const cached = await env.STATS_CACHE.get<{
    steamId: string;
    displayName: string;
    avatarUrl: string;
    profileUrl: string;
    fetchedAt: number;
  }>(profileCacheKey(steamId), "json");
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < profileFreshTtlSeconds) {
    const response = jsonResponse(
      {
        steamId: cached.steamId,
        displayName: cached.displayName,
        avatarUrl: cached.avatarUrl,
        profileUrl: cached.profileUrl,
      },
      env,
      200,
      { cacheStatus: "KV", maxAge: 300 }
    );
    await putEdgeCache("/steam/player-summary", steamId, response, context);
    return response;
  }

  try {
    const profile = await fetchPlayerSummary(steamId, env.STEAM_WEB_API_KEY, env);
    if (!profile) {
      if (cached) {
        return jsonResponse(
          {
            steamId: cached.steamId,
            displayName: cached.displayName,
            avatarUrl: cached.avatarUrl,
            profileUrl: cached.profileUrl,
            stale: true,
          },
          env,
          200,
          { cacheStatus: "STALE" }
        );
      }
      return jsonResponse({ error: "Steam profile not found" }, env, 404);
    }
    await env.STATS_CACHE.put(
      profileCacheKey(steamId),
      JSON.stringify({ ...profile, fetchedAt: now }),
      { expirationTtl: profileCacheTtlSeconds }
    );
    const response = jsonResponse(profile, env, 200, {
      cacheStatus: "MISS",
      maxAge: 300,
    });
    await putEdgeCache("/steam/player-summary", steamId, response, context);
    return response;
  } catch {
    if (cached) {
      return jsonResponse(
        {
          steamId: cached.steamId,
          displayName: cached.displayName,
          avatarUrl: cached.avatarUrl,
          profileUrl: cached.profileUrl,
          stale: true,
        },
        env,
        200,
        { cacheStatus: "STALE" }
      );
    }
    return jsonResponse({ error: "Failed to fetch Steam profile" }, env, 502);
  }
}

async function handleMetrics(request: Request, env: Env, context: ExecutionContext) {
  const expectedToken = env.METRICS_TOKEN?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expectedToken || token !== expectedToken) {
    return jsonResponse({ error: "Not found" }, env, 404);
  }
  if (await rateLimitExceeded(request, env)) {
    return jsonResponse({ error: "Rate limit exceeded" }, env, 429);
  }
  await flushMetrics(env);
  const metricsResponse = await metricsStub(env).fetch("https://coordinator/metrics-read");
  const total = metricsResponse.ok
    ? await metricsResponse.json<MetricsSnapshot>()
    : emptyMetrics();
  return jsonResponse(
    {
      totals: total,
      generatedAt: nowSeconds(),
    },
    env,
    200,
    { cacheStatus: "BYPASS" }
  );
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    if (request.method === "OPTIONS") return jsonResponse({}, env);
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, env, 405);
    }

    const url = new URL(request.url);
    if (url.pathname === "/steam/metrics") {
      return handleMetrics(request, env, context);
    }
    recordMetric("requests");
    let response: Response;
    if (url.pathname === "/steam/account-stats") {
      response = await handleAccountStats(request, env, context);
    } else if (url.pathname === "/steam/owned-games") {
      response = await handleOwnedGames(request, env, context);
    } else if (url.pathname === "/steam/player-level") {
      response = await handlePlayerLevel(request, env, context);
    } else if (url.pathname === "/steam/wishlist") {
      response = await handleWishlist(request, env, context);
    } else if (url.pathname === "/steam/recommended-tags") {
      response = await handleRecommendedTags(request, env, context);
    } else if (url.pathname === "/steam/game-reviews") {
      response = await handleGameReviews(request, env, context);
    } else if (url.pathname === "/steam/featured") {
      response = await handleFeatured(request, env, context);
    } else if (url.pathname === "/steam/game-schema") {
      response = await handleGameSchema(request, env, context);
    } else if (url.pathname === "/steam/similar") {
      response = await handleSimilar(request, env, context);
    } else if (url.pathname === "/steam/player-summary") {
      response = await handlePlayerSummary(request, env, context);
    } else {
      response = jsonResponse({ error: "Not found" }, env, 404);
    }
    maybeFlushMetrics(env, context);
    return response;
  },
};
