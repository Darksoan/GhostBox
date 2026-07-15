type Env = {
  STEAM_WEB_API_KEY: string;
  STATS_CACHE: KVNamespace;
  ALLOWED_ORIGIN?: string;
  RATE_LIMIT_PER_MINUTE?: string;
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
};

type StatsCache = {
  steamId: string;
  communitySummary?: AchievementSummary;
  games: Record<string, AchievementEntry>;
  ownedGames: OwnedGame[];
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
  recentAchievements: RecentAchievement[];
  ownedPlaytimes: OwnedPlaytime[];
  achievements: GameAchievementSummary[];
};

type GameAchievementSummary = {
  appId: string;
  gameTitle: string;
  achievements: GameAchievement[];
};

const accountCacheTtlSeconds = 6 * 60 * 60;
const achievementCacheTtlSeconds = 7 * 24 * 60 * 60;
const noStatsCacheTtlSeconds = 30 * 24 * 60 * 60;
const failedRetryTtlSeconds = 15 * 60;
const scanLockTtlSeconds = 3 * 60;
const scanConcurrency = 6;
const maxScanBatchPerRequest = 40;
const maxBatchesPerScan = 4;
const defaultRateLimitPerMinute = 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function jsonResponse(value: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

function validSteamId(value: string | null) {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

function statsCacheKey(steamId: string) {
  return `steam-stats:v8:${steamId}`;
}

function scanLockKey(steamId: string) {
  return `steam-stats-scan-lock:v8:${steamId}`;
}

function compareOwnedGamesForAchievementScan(left: OwnedGame, right: OwnedGame) {
  const lastPlayedDelta = (right.rtime_last_played ?? 0) - (left.rtime_last_played ?? 0);
  if (lastPlayedDelta !== 0) return lastPlayedDelta;

  return right.playtime_forever - left.playtime_forever;
}

function parseLocalizedNumber(value: string) {
  const normalized = value.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractShowcaseValue(showcase: string, labels: string | string[]) {
  for (const label of Array.isArray(labels) ? labels : [labels]) {
    const pattern = new RegExp(
      `<div\\s+class="value">\\s*([^<]+?)\\s*</div>\\s*<div\\s+class="label">\\s*${escapeRegex(label)}\\s*</div>`,
      "i"
    );
    const value = showcase.match(pattern)?.[1];
    if (value) return Math.round(parseLocalizedNumber(value.replace("%", "")));
  }
  return undefined;
}

function rateLimitKey(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  return `rate:${Math.floor(Date.now() / 60_000)}:${ip}`;
}

async function rateLimitExceeded(request: Request, env: Env) {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE || defaultRateLimitPerMinute);
  const key = rateLimitKey(request);
  const current = Number((await env.STATS_CACHE.get(key)) || "0") + 1;
  await env.STATS_CACHE.put(key, String(current), { expirationTtl: 90 });
  return current > Math.max(1, limit);
}

async function steamJson<T>(path: string, params: Record<string, string>) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  return response.json<T>();
}

async function fetchOwnedGames(steamId: string, apiKey: string) {
  const value = await steamJson<{ response?: { games?: OwnedGame[] } }>(
    "IPlayerService/GetOwnedGames/v1/",
    {
      key: apiKey,
      steamid: steamId,
      include_appinfo: "1",
      include_played_free_games: "1",
    }
  );
  return value.response?.games ?? [];
}

async function fetchCommunityAchievementSummary(steamId: string): Promise<AchievementSummary | undefined> {
  // Showcase totals live on the main profile page, not /stats/?tab=achievements.
  const response = await fetch(
    `https://steamcommunity.com/profiles/${steamId}/?l=english`,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 GhostBox/1.0 SteamStatsProxy",
      },
    }
  );
  if (!response.ok) return undefined;

  const html = await response.text();
  const showcase =
    html.match(/showcase_stats_row[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i)?.[0] ??
    html.match(
      /(?:Achievement Showcase|Vitrine de Conquistas)[\s\S]*?(?:Recent Activity|Atividade recente|View\s+All Recently Played|$)/i
    )?.[0] ??
    html;

  const achievements = extractShowcaseValue(showcase, ["Achievements", "Conquistas"]);
  const perfect = extractShowcaseValue(showcase, ["Perfect Games", "Jogos perfeitos"]);
  const average = extractShowcaseValue(showcase, [
    "Avg. Game Completion Rate",
    "Média de conquistas por jogo",
  ]);
  if (achievements === undefined && perfect === undefined && average === undefined) return undefined;

  return {
    unlockedAchievements: achievements ?? 0,
    perfectGames: perfect ?? 0,
    averageProgress: average ?? 0,
  };
}

async function fetchGameAchievementSchema(appId: string, apiKey: string) {
  try {
    const value = await steamJson<{
      game?: {
        gameName?: string;
        availableGameStats?: {
          achievements?: Array<{
            name?: string;
            displayName?: string;
            description?: string;
            icon?: string;
            icongray?: string;
          }>;
        };
      };
    }>("ISteamUserStats/GetSchemaForGame/v2/", {
      key: apiKey,
      appid: appId,
      l: "english",
    });

    return value.game;
  } catch {
    return undefined;
  }
}

function shouldRefresh(entry: AchievementEntry | undefined, game: OwnedGame, now: number) {
  if (!entry) return true;
  if (entry.playtimeForever !== game.playtime_forever) return true;
  if (entry.totalAchievements > 0 && !entry.achievements?.length) return true;
  let ttl = achievementCacheTtlSeconds;
  if (entry.lastError === "no_stats") ttl = noStatsCacheTtlSeconds;
  else if (entry.lastError) ttl = failedRetryTtlSeconds;
  return now - entry.lastFetchedAt > ttl;
}

async function fetchAchievementEntry(
  steamId: string,
  apiKey: string,
  game: OwnedGame
): Promise<[string, AchievementEntry]> {
  const now = nowSeconds();
  const appId = String(game.appid);
  const url = new URL("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("appid", appId);

  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return [
        appId,
        {
          playtimeForever: game.playtime_forever,
          unlockedAchievements: 0,
          totalAchievements: 0,
          hasAchievements: false,
          recentAchievements: [],
          lastFetchedAt: now,
          lastError: response.status === 400 ? "no_stats" : "http_error",
        },
      ];
    }

    const value = (await response.json()) as {
      playerstats?: {
        achievements?: Array<{
          apiname?: string;
          name?: string;
          achieved?: number;
          unlocktime?: number;
        }>;
      };
    };
    const achievements = value.playerstats?.achievements ?? [];
    const unlocked = achievements.filter((achievement) => achievement.achieved === 1);
    const schema = achievements.length > 0 ? await fetchGameAchievementSchema(appId, apiKey) : undefined;
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
  } catch {
    return [
      appId,
      {
        playtimeForever: game.playtime_forever,
        unlockedAchievements: 0,
        totalAchievements: 0,
        hasAchievements: false,
        recentAchievements: [],
        lastFetchedAt: now,
        lastError: "request_failed",
      },
    ];
  }
}

function buildStats(cache: StatsCache, privateProfile: boolean): AccountStats {
  const ownedIds = new Set(cache.ownedGames.map((game) => String(game.appid)));
  const entries = Object.entries(cache.games).filter(([appId]) => ownedIds.has(appId));
  const gamesWithAchievements = entries
    .map(([, entry]) => entry)
    .filter((entry) => entry.totalAchievements > 0);
  const scannedGames = entries.filter(([, entry]) => entry.lastFetchedAt > 0).length;
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
      gameTitle: cache.ownedGames.find((game) => String(game.appid) === appId)?.name || `Steam ${appId}`,
      achievements: entry.achievements ?? [],
    }))
    .filter((game) => game.achievements.length > 0);

  return {
    steamId: cache.steamId,
    gamesCount: cache.ownedGames.length,
    totalPlaytimeMinutes: cache.ownedGames.reduce((total, game) => total + game.playtime_forever, 0),
    unlockedAchievements:
      cache.communitySummary?.unlockedAchievements ??
      entries.reduce((total, [, entry]) => total + entry.unlockedAchievements, 0),
    totalAchievements: entries.reduce((total, [, entry]) => total + entry.totalAchievements, 0),
    perfectGames:
      cache.communitySummary?.perfectGames ??
      gamesWithAchievements.filter((entry) => entry.unlockedAchievements >= entry.totalAchievements).length,
    averageProgress:
      cache.communitySummary?.averageProgress ??
      (gamesWithAchievements.length
        ? Math.round(
            (gamesWithAchievements.reduce(
              (total, entry) => total + entry.unlockedAchievements / entry.totalAchievements,
              0
            ) /
              gamesWithAchievements.length) *
              100
          )
        : 0),
    scannedGames,
    pendingGames: Math.max(0, cache.ownedGames.length - scannedGames),
    failedGames: entries.filter(([, entry]) => entry.lastError && entry.lastError !== "no_stats").length,
    fetchedAt: cache.fetchedAt,
    private: privateProfile,
    hasApiKey: true,
    scanInProgress: cache.scanInProgress,
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

async function scanAchievements(env: Env, cache: StatsCache, pending: OwnedGame[]) {
  const lockKey = scanLockKey(cache.steamId);
  const existingLock = await env.STATS_CACHE.get(lockKey);
  if (existingLock) return;
  await env.STATS_CACHE.put(lockKey, "1", { expirationTtl: scanLockTtlSeconds });

  try {
    const nextCache: StatsCache = { ...cache, games: { ...cache.games }, scanInProgress: true };
    let remaining = pending.slice().sort(compareOwnedGamesForAchievementScan);
    let batches = 0;

    // Keep scanning in this waitUntil so progress does not stall at the first
    // batch (previously left scanInProgress=true and never resumed).
    while (remaining.length > 0 && batches < maxBatchesPerScan) {
      const batch = remaining.slice(0, maxScanBatchPerRequest);
      remaining = remaining.slice(batch.length);
      batches += 1;

      for (let index = 0; index < batch.length; index += scanConcurrency) {
        const chunk = batch.slice(index, index + scanConcurrency);
        const results = await Promise.all(
          chunk.map((game) => fetchAchievementEntry(cache.steamId, env.STEAM_WEB_API_KEY, game))
        );
        for (const [appId, entry] of results) {
          nextCache.games[appId] = entry;
        }
        nextCache.fetchedAt = nowSeconds();
        nextCache.scanInProgress = remaining.length > 0 || index + scanConcurrency < batch.length;
        await saveCache(env, nextCache);
      }
    }

    nextCache.scanInProgress = remaining.length > 0;
    nextCache.fetchedAt = nowSeconds();
    await saveCache(env, nextCache);
  } finally {
    await env.STATS_CACHE.delete(lockKey);
  }
}

async function handleAccountStats(request: Request, env: Env, context: ExecutionContext) {
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

  const cached = await env.STATS_CACHE.get<StatsCache>(statsCacheKey(steamId), "json");
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < 10 * 60) {
    const pendingCached = cached.ownedGames.filter((game) =>
      shouldRefresh(cached.games[String(game.appid)], game, now)
    );
    const needsCommunitySummary = !cached.communitySummary;

    // Always try to resume unfinished work. The scan lock prevents overlaps;
    // requiring !scanInProgress previously stuck scans after the first batch.
    if (pendingCached.length > 0) {
      const resumeCache: StatsCache = { ...cached, scanInProgress: true, fetchedAt: now };
      await saveCache(env, resumeCache);
      context.waitUntil(scanAchievements(env, resumeCache, pendingCached));
      if (!needsCommunitySummary) {
        return jsonResponse(buildStats(resumeCache, false), env);
      }
    } else if (!needsCommunitySummary) {
      const idleCache: StatsCache = cached.scanInProgress
        ? { ...cached, scanInProgress: false, fetchedAt: now }
        : cached;
      if (idleCache !== cached) await saveCache(env, idleCache);
      return jsonResponse(buildStats(idleCache, false), env);
    }
  }

  let ownedGames = cached?.ownedGames ?? [];
  let communitySummary = cached?.communitySummary;
  let privateProfile = false;
  try {
    const [games, summary] = await Promise.all([
      fetchOwnedGames(steamId, env.STEAM_WEB_API_KEY),
      fetchCommunityAchievementSummary(steamId),
    ]);
    ownedGames = games;
    communitySummary = summary ?? communitySummary;
  } catch {
    privateProfile = true;
  }

  const cache: StatsCache = {
    steamId,
    communitySummary,
    ownedGames,
    games: cached?.games ?? {},
    fetchedAt: now,
    scanInProgress: false,
  };
  const pending = ownedGames.filter((game) => shouldRefresh(cache.games[String(game.appid)], game, now));
  cache.scanInProgress = pending.length > 0;
  await saveCache(env, cache);
  if (pending.length > 0) {
    context.waitUntil(scanAchievements(env, cache, pending));
  }

  return jsonResponse(buildStats(cache, privateProfile), env);
}

async function handlePlayerLevel(request: Request, env: Env) {
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

  const cacheKey = `steam-level:v1:${steamId}`;
  const cached = await env.STATS_CACHE.get<{ playerLevel: number; fetchedAt: number }>(
    cacheKey,
    "json"
  );
  const now = nowSeconds();
  if (cached && now - cached.fetchedAt < 6 * 60 * 60) {
    return jsonResponse({ steamId, playerLevel: cached.playerLevel }, env);
  }

  try {
    const data = await steamJson<{ response?: { player_level?: number } }>(
      "IPlayerService/GetSteamLevel/v1/",
      { key: env.STEAM_WEB_API_KEY, steamid: steamId }
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
    return jsonResponse({ steamId, playerLevel }, env);
  } catch {
    return jsonResponse({ error: "Failed to fetch Steam level" }, env, 502);
  }
}

async function handleOwnedGames(request: Request, env: Env) {
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

  const cached = await env.STATS_CACHE.get<StatsCache>(statsCacheKey(steamId), "json");
  const now = nowSeconds();
  if (cached?.ownedGames?.length && now - cached.fetchedAt < 10 * 60) {
    return jsonResponse(
      {
        steamId,
        games: cached.ownedGames.map((game) => ({
          appId: String(game.appid),
          name: game.name ?? "",
          playtimeForever: game.playtime_forever,
          rtimeLastPlayed: game.rtime_last_played ?? 0,
        })),
      },
      env
    );
  }

  try {
    const ownedGames = await fetchOwnedGames(steamId, env.STEAM_WEB_API_KEY);
    const nextCache: StatsCache = {
      steamId,
      communitySummary: cached?.communitySummary,
      ownedGames,
      games: cached?.games ?? {},
      fetchedAt: now,
      scanInProgress: cached?.scanInProgress ?? false,
    };
    await saveCache(env, nextCache);
    return jsonResponse(
      {
        steamId,
        games: ownedGames.map((game) => ({
          appId: String(game.appid),
          name: game.name ?? "",
          playtimeForever: game.playtime_forever,
          rtimeLastPlayed: game.rtime_last_played ?? 0,
        })),
      },
      env
    );
  } catch {
    return jsonResponse({ error: "Failed to fetch owned games" }, env, 502);
  }
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    if (request.method === "OPTIONS") return jsonResponse({}, env);
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, env, 405);

    const url = new URL(request.url);
    if (url.pathname === "/steam/account-stats") {
      return handleAccountStats(request, env, context);
    }
    if (url.pathname === "/steam/owned-games") {
      return handleOwnedGames(request, env);
    }
    if (url.pathname === "/steam/player-level") {
      return handlePlayerLevel(request, env);
    }

    return jsonResponse({ error: "Not found" }, env, 404);
  },
};
