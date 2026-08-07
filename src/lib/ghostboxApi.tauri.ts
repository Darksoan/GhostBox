import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { clearStoredAccountData } from "../utils/storage";
import type {
  AddGameResult,
  AppStatus,
  BackupDetails,
  BackupSettings,
  FeaturedResult,
  GameDatabaseRequest,
  GameDatabaseResult,
  GamePlaytimeSnapshot,
  SteamGameReviewsResult,
  SteamRecommendedTag,
  HomeResult,
  CatalogueCacheUpdatedPayload,
  LaunchGameResult,
  LocalAchievementsUnlockedPayload,
  LudusaviBackupPreviewGame,
  MorrenusStatsResult,
  LuaToolsDependenciesEnsureResult,
  LuaToolsDependenciesFinishedEvent,
  LuaToolsDependenciesStatus,
  NotificationSettings,
  GhostBoxGame,
  RemoveGameResult,
  StartupSettings,
  SteamRestartResult,
  SteamLibraryScanResult,
  SteamAccountStats,
  SteamPathSelectionResult,
  SteamProfile,
  SteamWishlistItem,
  FeedbackRequest,
  FeedbackResult,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateProgressEvent,
  DiscordLinkStatus,
  CloudBackupResult,
  CloudProfileResult,
  CloudProfileSnapshot,
  CloudRestoreResult,
  CloudSave,
  CloudSaveDeletionResult,
  CloudSavePinnedResult,
  CloudSessionResult,
  AccountMeResult,
  SubscriptionCheckoutResult,
  SubscriptionPortalFlow,
  SubscriptionPortalResult,
  SubscriptionPlanId,
  SubscriptionStatusResult,
} from "./ghostboxApi.types";

function noopUnsubscribe() {
  return undefined;
}

const defaultGamesApiUrl = "https://piratebox-catalogue.hella.workers.dev";
const defaultFeedbackApiUrl =
  "https://ghostbox-feedback.hella.workers.dev/feedback";
const defaultUpdatesApiUrl =
  "https://ghostbox-feedback.hella.workers.dev/updates/latest";
const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "0.1.3";

function compareVersions(left: string, right: string) {
  const leftParts = left
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function getGamesApiUrl() {
  return (
    import.meta.env.VITE_GHOSTBOX_GAMES_API_URL?.trim() ||
    import.meta.env.VITE_EDEN_GAMES_API_URL?.trim() ||
    import.meta.env.VITE_PIRATEBOX_GAMES_API_URL?.trim() ||
    defaultGamesApiUrl
  ).replace(/\/+$/, "");
}

function getFeedbackApiUrl() {
  return (
    import.meta.env.VITE_GHOSTBOX_FEEDBACK_API_URL?.trim() ||
    defaultFeedbackApiUrl
  );
}

function getUpdatesApiUrl() {
  return (
    import.meta.env.VITE_GHOSTBOX_UPDATES_API_URL?.trim() ||
    defaultUpdatesApiUrl
  );
}

const DISCORD_LINK_CACHE_KEY = "ghostbox:discord-link-status";
const PREMIUM_CACHE_KEY = "ghostbox:premium-status";
const PREMIUM_STATUS_TTL_MS = 5 * 60 * 1000;

type DiscordLinkCacheEntry = {
  status: DiscordLinkStatus;
  cachedAt: number;
};

type PremiumCacheEntry = {
  isPremium: boolean;
  currentPeriodEnd?: string | null;
  cachedAt: number;
};

let memoryDiscordLinkCache: DiscordLinkCacheEntry | null = null;
let discordLinkInFlight: Promise<DiscordLinkStatus | null> | null = null;
let memoryPremiumCache: PremiumCacheEntry | null = null;
let premiumInFlight: Promise<boolean> | null = null;

function readDiscordLinkLocalCache(): DiscordLinkStatus | null {
  try {
    const raw = localStorage.getItem(DISCORD_LINK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscordLinkCacheEntry;
    return parsed?.status ?? null;
  } catch {
    return null;
  }
}

function writeDiscordLinkCache(status: DiscordLinkStatus) {
  const entry: DiscordLinkCacheEntry = { status, cachedAt: Date.now() };
  memoryDiscordLinkCache = entry;
  try {
    localStorage.setItem(DISCORD_LINK_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

function readPremiumLocalCache(): boolean | null {
  return readPremiumLocalCacheEntry()?.isPremium ?? null;
}

function readPremiumLocalCacheEntry(): PremiumCacheEntry | null {
  try {
    const raw = localStorage.getItem(PREMIUM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PremiumCacheEntry;
    return {
      isPremium: parsed.isPremium === true,
      currentPeriodEnd: parsed.currentPeriodEnd ?? null,
      cachedAt: Number.isFinite(parsed.cachedAt) ? parsed.cachedAt : 0,
    };
  } catch {
    return null;
  }
}

function writePremiumCache(isPremium: boolean, currentPeriodEnd?: string | null) {
  const entry: PremiumCacheEntry = {
    isPremium,
    currentPeriodEnd: currentPeriodEnd ?? null,
    cachedAt: Date.now(),
  };
  memoryPremiumCache = entry;
  try {
    localStorage.setItem(PREMIUM_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

/** Clears cached subscription/Discord state — call on account logout. */
function clearAccountCaches() {
  memoryDiscordLinkCache = null;
  memoryPremiumCache = null;
  discordLinkInFlight = null;
  premiumInFlight = null;
  try {
    localStorage.removeItem(DISCORD_LINK_CACHE_KEY);
    localStorage.removeItem(PREMIUM_CACHE_KEY);
  } catch {
    // ignore
  }
}

function resolveIsPremium(
  status: SubscriptionStatusResult | null | undefined,
): boolean {
  if (!status?.subscription) return false;
  const sub = status.subscription;
  if (sub.isPremium === true) return true;
  if (sub.status === "active") {
    if (!sub.currentPeriodEnd) return true;
    const end = Date.parse(sub.currentPeriodEnd);
    return !Number.isFinite(end) || end > Date.now();
  }
  return false;
}

const emptyGameDatabase: GameDatabaseResult = {
  games: [],
  total: 0,
  matched: 0,
  limited: false,
  source: "tauri-stub",
};

const emptyHomeResult: HomeResult = {
  popular: [],
  recentlyAdded: [],
  total: 0,
  source: "tauri-stub",
};

const emptyFeaturedResult: FeaturedResult = {
  topSellers: [],
  newReleases: [],
  comingSoon: [],
};

async function invokeOr<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch {
    return fallback;
  }
}

export const ghostboxApi = {
  async openExternalUrl(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },

  /** Opens the browser for Discord OAuth; the returned URL already carries a
   * signed, per-account state token minted by the worker. */
  async getDiscordLinkUrl(): Promise<string | null> {
    try {
      const result = await invoke<{ url: string }>("discord_link_start", {});
      return result?.url ?? null;
    } catch {
      return null;
    }
  },

  /** Synchronous hydrate for UI — memory then localStorage. */
  getCachedDiscordLinkStatus(): DiscordLinkStatus | null {
    if (memoryDiscordLinkCache) return memoryDiscordLinkCache.status;
    const local = readDiscordLinkLocalCache();
    if (local) memoryDiscordLinkCache = { status: local, cachedAt: Date.now() };
    return local;
  },

  cacheDiscordLinkStatus(status: DiscordLinkStatus | null | undefined) {
    if (!status) return;
    writeDiscordLinkCache(status);
  },

  getCachedIsPremium(): boolean | null {
    if (memoryPremiumCache) return memoryPremiumCache.isPremium;
    const local = readPremiumLocalCache();
    if (local !== null) memoryPremiumCache = { isPremium: local, cachedAt: Date.now() };
    return local;
  },

  getFreshCachedPremiumStatus(): PremiumCacheEntry | null {
    const cached = memoryPremiumCache ?? readPremiumLocalCacheEntry();
    if (!cached || Date.now() - cached.cachedAt > PREMIUM_STATUS_TTL_MS) return null;
    memoryPremiumCache = cached;
    return cached;
  },

  cacheIsPremium(isPremium: boolean) {
    writePremiumCache(isPremium);
  },

  clearAccountCaches,

  async getDiscordLinkStatus(): Promise<DiscordLinkStatus | null> {
    if (discordLinkInFlight) return discordLinkInFlight;

    const promise = (async (): Promise<DiscordLinkStatus | null> => {
      try {
        const status = await invoke<DiscordLinkStatus>("discord_link_status", {});
        writeDiscordLinkCache(status);
        return status;
      } catch {
        return ghostboxApi.getCachedDiscordLinkStatus();
      } finally {
        discordLinkInFlight = null;
      }
    })();

    discordLinkInFlight = promise;
    return promise;
  },

  async getSubscriptionStatus(): Promise<SubscriptionStatusResult | null> {
    try {
      const status = await invoke<SubscriptionStatusResult>("subscription_get_status", {});
      if (status.discordLink) {
        writeDiscordLinkCache(status.discordLink);
      }
      writePremiumCache(resolveIsPremium(status), status.subscription?.currentPeriodEnd ?? null);
      return status;
    } catch {
      return null;
    }
  },

  async isPremiumUser(): Promise<boolean> {
    const cached = ghostboxApi.getFreshCachedPremiumStatus();
    if (cached) return cached.isPremium;

    if (premiumInFlight) return premiumInFlight;

    const promise = (async (): Promise<boolean> => {
      try {
        const status = await ghostboxApi.getSubscriptionStatus();
        const premium = resolveIsPremium(status);
        writePremiumCache(premium, status?.subscription?.currentPeriodEnd ?? null);
        return premium;
      } catch {
        return ghostboxApi.getCachedIsPremium() === true;
      } finally {
        premiumInFlight = null;
      }
    })();

    premiumInFlight = promise;
    return promise;
  },

  async createSubscriptionCheckout(
    planId: SubscriptionPlanId,
  ): Promise<SubscriptionCheckoutResult | null> {
    try {
      return await invoke<SubscriptionCheckoutResult>("subscription_create_checkout", { planId });
    } catch {
      return null;
    }
  },

  async createSubscriptionPortalSession(
    flow: SubscriptionPortalFlow = "manage",
  ): Promise<SubscriptionPortalResult | null> {
    try {
      return await invoke<SubscriptionPortalResult>("subscription_create_portal_session", { flow });
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(
        typeof error === "string" ? error : "Could not open billing portal.",
      );
    }
  },

  async sendFeedback(request: FeedbackRequest): Promise<FeedbackResult> {
    const apiUrl = getFeedbackApiUrl();

    if (!apiUrl) {
      return { success: false, error: "Feedback endpoint is not configured." };
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: request.message,
          language: request.language,
          steamId: request.steamId,
          userName: request.userName,
          appVersion,
          source: "ghostbox-tauri",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        return {
          success: false,
          error: payload?.error || "Could not send feedback.",
        };
      }

      return { success: true };
    } catch {
      return { success: false, error: "Could not send feedback." };
    }
  },

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        return {
          updateAvailable: false,
          currentVersion: appVersion,
          latestVersion: appVersion,
        };
      }

      return {
        updateAvailable: true,
        currentVersion: appVersion,
        latestVersion: update.version,
      };
    } catch {
      // Fallback: HTTP manifest (no install without signed updater artifacts)
      try {
        const url = new URL(getUpdatesApiUrl());
        url.searchParams.set("currentVersion", appVersion);
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) return null;
        const manifest = (await response.json()) as Partial<{
          version?: string;
          latestVersion?: string;
          notes?: string;
          releaseNotesUrl?: string;
        }>;
        const latestVersion =
          manifest.version?.trim() ||
          manifest.latestVersion?.trim() ||
          appVersion;
        const updateAvailable = compareVersions(latestVersion, appVersion) > 0;
        return {
          updateAvailable,
          currentVersion: appVersion,
          latestVersion,
          releaseNotesUrl: manifest.releaseNotesUrl?.trim() || undefined,
        };
      } catch {
        return null;
      }
    }
  },

  async installUpdate(
    onProgress?: (event: UpdateProgressEvent) => void,
  ): Promise<UpdateInstallResult> {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        return { success: false, error: "No update available." };
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          onProgress?.({
            event: "Started",
            downloaded: 0,
            contentLength,
            percent: 0,
          });
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent =
            contentLength > 0
              ? Math.min(100, Math.round((downloaded / contentLength) * 100))
              : 0;
          onProgress?.({
            event: "Progress",
            downloaded,
            contentLength,
            percent,
          });
          return;
        }
        if (event.event === "Finished") {
          onProgress?.({
            event: "Finished",
            downloaded,
            contentLength,
            percent: 100,
          });
        }
      });

      await relaunch();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getAppStatus(): Promise<AppStatus | undefined> {
    return invokeOr<AppStatus | undefined>("app_get_status", {}, undefined);
  },

  getHome(): Promise<HomeResult> {
    return invokeOr<HomeResult>(
      "catalogue_get_home",
      { apiUrl: getGamesApiUrl() },
      emptyHomeResult,
    );
  },

  getFeatured(cc: "br" | "us"): Promise<FeaturedResult> {
    return invokeOr<FeaturedResult>("steam_get_featured", { cc }, emptyFeaturedResult);
  },

  getGames(request?: GameDatabaseRequest): Promise<GameDatabaseResult> {
    return invokeOr<GameDatabaseResult>(
      "database_get_games",
      { request: request ?? null, apiUrl: getGamesApiUrl() },
      emptyGameDatabase,
    );
  },

  /**
   * Igual a `getGames`, mas propaga a falha em vez de devolver um resultado
   * vazio. O catálogo precisa distinguir "backend fora" de "nenhum resultado";
   * quem só enfeita a home continua usando a versão tolerante.
   */
  getGamesOrThrow(request?: GameDatabaseRequest): Promise<GameDatabaseResult> {
    return invoke<GameDatabaseResult>("database_get_games", {
      request: request ?? null,
      apiUrl: getGamesApiUrl(),
    });
  },

  getGameDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null,
    );
  },

  getGameStoreDetails(
    gameId: string,
    language?: "pt" | "en",
  ): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_store_details",
      { gameId, apiUrl: getGamesApiUrl(), language },
      null,
    );
  },

  async ingestRemoteGameByAppId(appId: string): Promise<void> {
    const normalizedAppId = appId.trim();
    if (!/^\d{1,10}$/.test(normalizedAppId)) return;
    const response = await fetch(`${getGamesApiUrl()}/games/${normalizedAppId}/ingest`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Remote catalogue ingest failed: ${response.status}`);
    }
  },

  getGameAchievementDetails(
    gameId: string,
    language?: "pt" | "en",
  ): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_achievement_details",
      { gameId, apiUrl: getGamesApiUrl(), language },
      null,
    );
  },

  getGameReviews(
    gameId: string,
    language: "all" | "brazilian" | "english",
    reviewType: "all" | "positive" | "negative" = "all",
  ): Promise<SteamGameReviewsResult> {
    return invokeOr<SteamGameReviewsResult>(
      "database_get_game_reviews",
      { gameId, language, reviewType },
      { success: 0, reviews: [] },
    );
  },

  getCachedImage(url: string): Promise<string> {
    return invokeOr<string>("cache_get_image", { url }, url).then((result) => {
      if (!result || result === url || /^https?:\/\//i.test(result)) {
        return result || url;
      }
      return convertFileSrc(result);
    });
  },

  resolveSteamLibraryAsset(appId: string, fileName: string): Promise<string> {
    return invokeOr<string>(
      "cache_resolve_steam_library_asset",
      { appId, fileName },
      "",
    );
  },

  /**
   * Propaga a falha de propósito: engolir o erro aqui fazia o lote inteiro ser
   * marcado como resolvido sem manifesto, e as capas desses appIds sumiam pelo
   * resto da sessão. Quem chama precisa poder tentar de novo.
   */
  getSteamAssetManifests(
    appIds: string[],
  ): Promise<Record<string, Record<string, string>>> {
    return invoke<Record<string, Record<string, string>>>(
      "steam_get_asset_manifests",
      { appIds },
    );
  },

  getCachedSteamAssetManifests(
    appIds: string[],
  ): Promise<Record<string, Record<string, string>>> {
    return invokeOr<Record<string, Record<string, string>>>(
      "steam_get_cached_asset_manifests",
      { appIds },
      {},
    );
  },

  addGameViaLuaTools(game: GhostBoxGame): Promise<AddGameResult> {
    return invokeOr<AddGameResult>(
      "luatools_add_game",
      { game },
      {
        success: false,
        error: "Não foi possível adicionar o jogo via LuaTools.",
      },
    );
  },

  registerSteamLibraryGame(game: GhostBoxGame): Promise<AddGameResult> {
    return invokeOr<AddGameResult>(
      "ghostbox_library_register_steam_game",
      { game },
      { success: false, error: "Não foi possível registrar o jogo da Steam." },
    );
  },

  /**
   * `downloadsRoot` é a RAIZ escolhida pelo usuário, não o destino final. O Rust
   * resolve `installdir` no appinfo e monta `<root>\steamapps\common\<installdir>`,
   * devolvendo o caminho no evento `depot-plan` e no resultado.
   */
  downloadDepotGame(
    appId: string,
    downloadsRoot: string,
    gameTitle?: string,
    steamPath?: string,
    parallelChunks?: number,
  ): Promise<Record<string, unknown>> {
    return invokeOr<Record<string, unknown>>(
      "cdndownload_download_game",
      { appId, downloadsRoot, gameTitle, steamPath, parallelChunks },
      { Type: "error", Message: "Não foi possível iniciar o download." },
    );
  },

  cancelDepotGame(appId: string): Promise<boolean> {
    return invokeOr<boolean>("cdndownload_cancel_game", { appId }, false);
  },

  deleteDownloadOutputDir(
    appId: string,
    downloadsRoot: string,
    outputDir: string,
  ): Promise<boolean> {
    return invoke<boolean>("cdndownload_delete_output_dir", {
      appId,
      downloadsRoot,
      outputDir,
    });
  },

  revealDownloadFolder(outputDir: string): Promise<void> {
    return revealItemInDir(outputDir);
  },

  launchDownloadedGame(
    appId: string,
    title: string,
    downloadsRoot: string,
    outputDir: string,
    installDir?: string,
  ): Promise<string> {
    return invoke<string>("cdndownload_launch_game", {
      appId,
      title,
      downloadsRoot,
      outputDir,
      installDir,
    });
  },

  getDefaultDownloadsDir(): Promise<string> {
    return invokeOr<string>("cdndownload_default_dir", {}, "");
  },

  async selectDownloadsDir(): Promise<string | null> {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Selecione a pasta de downloads",
    });

    return typeof selectedPath === "string" ? selectedPath : null;
  },

  onDownloadProgress(
    callback: (payload: Record<string, unknown>) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<Record<string, unknown>>("download-progress", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  removeGameViaLuaTools(game: GhostBoxGame): Promise<RemoveGameResult> {
    return invokeOr<RemoveGameResult>(
      "luatools_remove_game",
      { game },
      {
        success: false,
        error: "Não foi possível remover o jogo via LuaTools.",
      },
    );
  },

  /**
   * Intentionally NOT wrapped in invokeOr: when the Rust command fails we want the
   * Promise to reject so callers (refreshGamePlaytimes) can log the real reason
   * instead of silently rendering every game at 0 playtime.
   */
  getGamePlaytimes(): Promise<GamePlaytimeSnapshot> {
    return invoke<GamePlaytimeSnapshot>("game_get_playtimes", {});
  },

  onGamePlaytimesChanged(
    callback: (snapshot: GamePlaytimeSnapshot) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<GamePlaytimeSnapshot>("game-playtimes-changed", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  isSteamToolsInstalled(): Promise<boolean> {
    return invokeOr<boolean>("app_is_steamtools_installed", {}, true);
  },

  installSteamTools(): Promise<{ success: boolean; error?: string }> {
    return invokeOr<{ success: boolean; error?: string }>(
      "app_install_steamtools",
      {},
      { success: true },
    );
  },

  getLuaToolsDependenciesStatus(): Promise<LuaToolsDependenciesStatus> {
    return invokeOr<LuaToolsDependenciesStatus>(
      "luatools_dependencies_status",
      {},
      {
        steamFound: false,
        steamPath: "",
        luaToolsInstalled: false,
        luaToolsPath: "",
        stPluginFolderFound: false,
        betterSteamToolsInstalled: false,
        openSteamToolFiles: [],
        openSteamToolConfigured: false,
        ready: false,
        checkedPaths: [],
      },
    );
  },

  ensureLuaToolsDependencies(): Promise<LuaToolsDependenciesEnsureResult> {
    return invokeOr<LuaToolsDependenciesEnsureResult>(
      "luatools_dependencies_ensure",
      {},
      { status: "failed", started: false, ready: false },
    );
  },

  onLuaToolsDependenciesFinished(
    callback: (event: LuaToolsDependenciesFinishedEvent) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<LuaToolsDependenciesFinishedEvent>(
      "luatools-dependencies-finished",
      (event) => {
        callback(event.payload);
      },
    ).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  getSteamProfile(): Promise<SteamProfile | null> {
    return invokeOr<SteamProfile | null>("steam_get_profile", {}, null);
  },

  getSteamAccountStats(steamId: string): Promise<SteamAccountStats | null> {
    return invokeOr<SteamAccountStats | null>(
      "steam_get_account_stats",
      { steamId },
      null,
    );
  },

  /**
   * Fetch GetOwnedGames via Steam Web API (proxy key or local) and rebuild playtimes.
   * Intentionally NOT wrapped in invokeOr: callers need to distinguish "sync failed"
   * from "sync succeeded with an empty snapshot" so failures can be logged/surfaced
   * instead of silently rendering every game as 0 playtime.
   */
  syncSteamPlaytimes(steamId: string): Promise<GamePlaytimeSnapshot> {
    return invoke<GamePlaytimeSnapshot>("steam_sync_playtimes", { steamId });
  },

  getSteamPlayerLevel(steamId: string): Promise<number | null> {
    return invokeOr<number | null>("steam_get_player_level", { steamId }, null);
  },

  isSteamRunning(): Promise<boolean> {
    return invokeOr<boolean>("steam_is_running", {}, false);
  },

  onSteamAccountStatsUpdated(
    callback: (stats: SteamAccountStats) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SteamAccountStats>("steam-account-stats-updated", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  saveSteamProfile(profile: SteamProfile): Promise<SteamProfile> {
    return invokeOr<SteamProfile>("steam_save_profile", { profile }, profile);
  },

  /** Links Steam to the currently signed-in GhostBox account. Requires an
   * active account session — it no longer signs anyone in on its own. */
  async connectSteamAccount(): Promise<SteamProfile> {
    const profile = await invoke<SteamProfile>("steam_connect_account", {});
    if (!profile?.steamId) {
      throw new Error("Steam profile is invalid");
    }
    return profile;
  },

  /** Disconnects Steam without touching the GhostBox account session. */
  disconnectSteamAccount(): Promise<void> {
    return invokeOr<void>("steam_disconnect_account", {}, undefined);
  },

  getCloudSession(): Promise<CloudSessionResult | null> {
    return invokeOr<CloudSessionResult | null>("cloud_get_session", {}, null);
  },

  /**
   * Ends the GhostBox account session entirely (all connections go with it).
   * The Steam session and the account-scoped localStorage go too: without
   * that, the next account to sign in on this device inherits the previous
   * user's Steam profile, library, collections and cloud-sync bookkeeping.
   */
  async signOutCloud(): Promise<void> {
    await invokeOr<void>("steam_disconnect_account", {}, undefined);
    await invokeOr<void>("cloud_sign_out", {}, undefined);
    clearAccountCaches();
    clearStoredAccountData();
  },

  async registerAccount(
    email: string,
    username: string,
    password: string,
    displayName?: string,
  ): Promise<CloudSessionResult> {
    return invoke<CloudSessionResult>("cloud_register", {
      email,
      username,
      password,
      displayName: displayName || null,
    });
  },

  async loginAccount(identifier: string, password: string): Promise<CloudSessionResult> {
    return invoke<CloudSessionResult>("cloud_login", { identifier, password });
  },

  async requestPasswordReset(identifier: string): Promise<void> {
    await invoke<void>("cloud_request_password_reset", { identifier });
  },

  async resendVerificationEmail(): Promise<{ ok: boolean; emailVerified: boolean }> {
    return invoke("cloud_resend_verification", {});
  },

  async changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
    await invoke<void>("cloud_change_password", { currentPassword, newPassword });
  },

  /**
   * Resolves to `null` only when the worker actually rejected the session.
   * Network failures reject instead of resolving, so callers can tell "your
   * session is gone" apart from "we could not reach the worker".
   */
  async getAccount(): Promise<AccountMeResult | null> {
    return invoke<AccountMeResult | null>("cloud_get_account", {});
  },

  async disconnectConnection(provider: "steam" | "discord"): Promise<void> {
    await invoke<void>("cloud_disconnect_connection", { provider });
  },

  // Cloud save calls propagate errors on purpose: the Rust side already
  // translates worker error codes into user-facing pt-BR messages, and
  // swallowing them makes an expired session look like "no backups yet".
  async listCloudSaves(appId?: string): Promise<CloudSave[]> {
    const result = await invoke<{ saves: CloudSave[] }>("cloud_list_saves", {
      appId: appId ?? null,
    });
    return result?.saves ?? [];
  },

  backupGameToCloud(game: GhostBoxGame): Promise<CloudBackupResult | null> {
    return invoke<CloudBackupResult | null>("cloud_backup_game", { game });
  },

  restoreCloudSave(
    game: GhostBoxGame,
    saveId: string,
  ): Promise<CloudRestoreResult | null> {
    return invoke<CloudRestoreResult | null>("cloud_restore_save", {
      game,
      saveId,
    });
  },

  deleteCloudSave(saveId: string): Promise<CloudSaveDeletionResult | null> {
    return invoke<CloudSaveDeletionResult | null>("cloud_delete_save", {
      saveId,
    });
  },

  setCloudSavePinned(
    saveId: string,
    pinned: boolean,
  ): Promise<CloudSavePinnedResult | null> {
    return invoke<CloudSavePinnedResult | null>("cloud_set_save_pinned", {
      saveId,
      pinned,
    });
  },

  getCloudProfileSnapshot(): Promise<CloudProfileSnapshot | null> {
    return invokeOr<CloudProfileResult | null>(
      "cloud_get_profile_snapshot",
      {},
      null,
    ).then((result) => result?.profile ?? null);
  },

  saveCloudProfileSnapshot(
    snapshot: CloudProfileSnapshot,
  ): Promise<CloudProfileSnapshot | null> {
    return invokeOr<CloudProfileResult | null>(
      "cloud_put_profile_snapshot",
      { snapshot },
      null,
    ).then((result) => result?.profile ?? null);
  },

  async uploadProfileImage(
    imageData: string,
    kind: "avatar" | "banner",
  ): Promise<string> {
    try {
      const result = await invoke<{ url?: string }>(
        "cloud_upload_profile_image",
        { imageData, kind },
      );
      if (!result?.url)
        throw new Error("O servidor não retornou a URL da imagem.");
      return result.url;
    } catch (error) {
      throw new Error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Falha ao enviar a imagem para a nuvem.",
      );
    }
  },

  async deleteProfileBanner(): Promise<boolean> {
    try {
      const result = await invoke<{ ok?: boolean }>(
        "cloud_delete_profile_banner",
        {},
      );
      if (result?.ok !== true)
        throw new Error("O servidor não confirmou a remoção da capa.");
      return true;
    } catch (error) {
      throw new Error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Falha ao remover a capa da nuvem.",
      );
    }
  },

  getSteamWishlist(steamId: string): Promise<SteamWishlistItem[]> {
    return invokeOr<SteamWishlistItem[]>("steam_get_wishlist", { steamId }, []);
  },

  getSteamRecommendedTagsForUser(
    steamId: string,
  ): Promise<SteamRecommendedTag[]> {
    return invokeOr<SteamRecommendedTag[]>(
      "steam_get_recommended_tags_for_user",
      { steamId },
      [],
    );
  },

  getSteamSimilarAppIds(appId: string): Promise<string[]> {
    return invokeOr<string[]>("steam_get_similar_app_ids", { appId }, []);
  },

  restartSteam(): Promise<SteamRestartResult | undefined> {
    return invokeOr<SteamRestartResult | undefined>(
      "steam_restart",
      {},
      undefined,
    );
  },

  scanSteamLibrary(
    steamPath?: string,
    forceRefreshOwnedGames?: boolean,
    includeOwnedGames?: boolean,
  ): Promise<SteamLibraryScanResult | undefined> {
    return invokeOr<SteamLibraryScanResult | undefined>(
      "steam_scan_library",
      {
        steamPath: steamPath ?? null,
        forceRefreshOwnedGames: forceRefreshOwnedGames ?? false,
        includeOwnedGames: includeOwnedGames ?? true,
      },
      undefined,
    );
  },

  async selectSteamPath(): Promise<SteamPathSelectionResult | undefined> {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Selecione a pasta da Steam",
    });

    if (typeof selectedPath !== "string") {
      return { status: "cancelled" };
    }

    return invokeOr<SteamPathSelectionResult | undefined>(
      "steam_select_path",
      { steamPath: selectedPath },
      undefined,
    );
  },

  getStartupSettings(): Promise<StartupSettings | undefined> {
    return invokeOr<StartupSettings | undefined>(
      "app_get_startup_settings",
      {},
      undefined,
    );
  },

  setStartupSettings(
    settings: Partial<StartupSettings>,
  ): Promise<StartupSettings | undefined> {
    return invokeOr<StartupSettings | undefined>(
      "app_set_startup_settings",
      { settings },
      undefined,
    );
  },

  setNotificationSettings(settings: NotificationSettings): Promise<void> {
    return invokeOr<void>(
      "app_set_notification_settings",
      { settings },
      undefined,
    );
  },

  getMorrenusApiKey(): Promise<string | undefined> {
    return invokeOr<string | undefined>(
      "app_get_morrenus_api_key",
      {},
      undefined,
    );
  },

  setMorrenusApiKey(apiKey: string): Promise<string> {
    return invoke<string>("app_set_morrenus_api_key", { apiKey });
  },

  getMorrenusStats(apiKey: string): Promise<MorrenusStatsResult | undefined> {
    return invokeOr<MorrenusStatsResult | undefined>(
      "app_get_morrenus_stats",
      { apiKey },
      undefined,
    );
  },

  getBackupSettings(): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_get_settings",
      {},
      undefined,
    );
  },

  removeBackupRecord(appId: string): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_remove_record",
      { appId },
      undefined,
    );
  },

  getBackupDetails(
    appId: string,
    backupPath?: string | null,
  ): Promise<BackupDetails | null> {
    return invokeOr<BackupDetails | null>(
      "backup_get_details",
      { appId, backupPath: backupPath ?? null, apiUrl: getGamesApiUrl() },
      null,
    );
  },

  onBackupSettingsChanged(
    callback: (settings: BackupSettings) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<BackupSettings>("backup-settings-changed", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  launchGame(
    game: LudusaviBackupPreviewGame,
  ): Promise<LaunchGameResult | undefined> {
    return invokeOr<LaunchGameResult | undefined>(
      "game_launch",
      { game },
      {
        success: false,
        appId: game.appId,
        error: "Não foi possível iniciar o jogo.",
      },
    );
  },

  setTrayLibraryGames(games: GhostBoxGame[]): Promise<void> {
    return invokeOr<void>("tray_set_library_games", { games }, undefined);
  },

  getTrayLibraryGames(): Promise<GhostBoxGame[]> {
    return invokeOr<GhostBoxGame[]>("tray_get_library_games", {}, []);
  },

  launchTrayGame(appId: string): Promise<LaunchGameResult | undefined> {
    return invokeOr<LaunchGameResult | undefined>(
      "tray_launch_game",
      { appId },
      {
        success: false,
        appId,
        error: "Não foi possível iniciar o jogo.",
      },
    );
  },

  showMainWindowFromTray(): Promise<void> {
    return invokeOr<void>("tray_show_main_window", {}, undefined);
  },

  navigateFromTray(
    page: "home" | "catalogue" | "library" | "profile",
  ): Promise<void> {
    return invokeOr<void>("tray_navigate", { page }, undefined);
  },

  onTrayNavigate(
    callback: (payload: {
      page: "home" | "catalogue" | "library" | "profile";
    }) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<{ page: "home" | "catalogue" | "library" | "profile" }>(
      "tray-navigate",
      (event) => callback(event.payload),
    ).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  hideTrayMenu(): Promise<void> {
    return invokeOr<void>("tray_hide_menu", {}, undefined);
  },

  quitFromTray(): Promise<void> {
    return invokeOr<void>("tray_quit_application", {}, undefined);
  },

  getGameIconUrl(appId: string): Promise<string | null> {
    return invokeOr<string | null>("steam_get_game_icon_url", { appId }, null);
  },

  getGameIconUrls(appIds: string[]): Promise<Record<string, string>> {
    return invokeOr<Record<string, string>>("steam_get_game_icon_urls", { appIds }, {});
  },

  getLocalGameIconUrls(appIds: string[]): Promise<Record<string, string>> {
    return invokeOr<Record<string, string>>(
      "steam_get_local_game_icon_urls",
      { appIds },
      {},
    );
  },

  resolveGameIconUrls(appIds: string[]): Promise<Record<string, string>> {
    return invokeOr<Record<string, string>>(
      "steam_resolve_game_icon_urls",
      { appIds },
      {},
    );
  },

  onGameIconUrlsResolved(
    callback: (icons: Record<string, string>) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<Record<string, string>>("game-icon-urls-resolved", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  onSteamCmdReady(callback: () => void): () => void {
    void callback;
    return noopUnsubscribe;
  },

  onCatalogueCacheUpdated(
    callback: (payload: CatalogueCacheUpdatedPayload) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<CatalogueCacheUpdatedPayload>(
      "catalogue-cache-updated",
      (event) => {
        callback(event.payload);
      },
    ).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  onLocalAchievementsUnlocked(
    callback: (payload: LocalAchievementsUnlockedPayload) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<LocalAchievementsUnlockedPayload>(
      "local-achievements-unlocked",
      (event) => {
        callback(event.payload);
      },
    ).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  onWindowHiddenToTray(callback: () => void): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("window-hidden-to-tray", () => {
      callback();
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  minimize(): Promise<void> {
    return invokeOr<void>("window_minimize", {}, undefined);
  },

  close(): Promise<void> {
    return invokeOr<void>("window_close", {}, undefined);
  },

  openExternal(url: string): Promise<void> {
    return invokeOr<void>("shell_open_external", { url }, undefined);
  },
};
