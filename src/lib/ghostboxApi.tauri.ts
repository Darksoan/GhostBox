import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AddGameResult,
  AppStatus,
  BackupDetails,
  BackupSettings,
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
const defaultSubscriptionsApiUrl =
  "https://ghostbox-subscriptions.hella.workers.dev";
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

function getSubscriptionsApiUrl() {
  return (
    import.meta.env.VITE_GHOSTBOX_SUBSCRIPTIONS_API_URL?.trim() ||
    defaultSubscriptionsApiUrl
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

type DiscordLinkCacheEntry = {
  steamId: string;
  status: DiscordLinkStatus;
  cachedAt: number;
};

type PremiumCacheEntry = {
  steamId: string;
  isPremium: boolean;
  cachedAt: number;
};

let memoryDiscordLinkCache: DiscordLinkCacheEntry | null = null;
const discordLinkInFlight = new Map<
  string,
  Promise<DiscordLinkStatus | null>
>();
let memoryPremiumCache: PremiumCacheEntry | null = null;
const premiumInFlight = new Map<string, Promise<boolean>>();

function readDiscordLinkLocalCache(steamId: string): DiscordLinkStatus | null {
  try {
    const raw = localStorage.getItem(DISCORD_LINK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscordLinkCacheEntry;
    if (!parsed?.steamId || parsed.steamId !== steamId || !parsed.status)
      return null;
    return parsed.status;
  } catch {
    return null;
  }
}

function writeDiscordLinkCache(steamId: string, status: DiscordLinkStatus) {
  const entry: DiscordLinkCacheEntry = {
    steamId,
    status,
    cachedAt: Date.now(),
  };
  memoryDiscordLinkCache = entry;
  try {
    localStorage.setItem(DISCORD_LINK_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

function readPremiumLocalCache(steamId: string): boolean | null {
  try {
    const raw = localStorage.getItem(PREMIUM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PremiumCacheEntry;
    if (!parsed?.steamId || parsed.steamId !== steamId) return null;
    return parsed.isPremium === true;
  } catch {
    return null;
  }
}

function writePremiumCache(steamId: string, isPremium: boolean) {
  const entry: PremiumCacheEntry = {
    steamId,
    isPremium,
    cachedAt: Date.now(),
  };
  memoryPremiumCache = entry;
  try {
    localStorage.setItem(PREMIUM_CACHE_KEY, JSON.stringify(entry));
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

  getDiscordLinkUrl(steamId: string): string {
    const url = new URL(`${getSubscriptionsApiUrl()}/discord/link`);
    url.searchParams.set("steamId", steamId);
    return url.toString();
  },

  /** Synchronous hydrate for UI — memory then localStorage. */
  getCachedDiscordLinkStatus(steamId: string): DiscordLinkStatus | null {
    const id = steamId.trim();
    if (!id) return null;
    if (memoryDiscordLinkCache?.steamId === id)
      return memoryDiscordLinkCache.status;
    const local = readDiscordLinkLocalCache(id);
    if (local) {
      memoryDiscordLinkCache = {
        steamId: id,
        status: local,
        cachedAt: Date.now(),
      };
    }
    return local;
  },

  cacheDiscordLinkStatus(status: DiscordLinkStatus | null | undefined) {
    const steamId = status?.steamId?.trim();
    if (!steamId || !status) return;
    writeDiscordLinkCache(steamId, status);
  },

  getCachedIsPremium(steamId: string): boolean | null {
    const id = steamId.trim();
    if (!id) return null;
    if (memoryPremiumCache?.steamId === id) return memoryPremiumCache.isPremium;
    const local = readPremiumLocalCache(id);
    if (local !== null) {
      memoryPremiumCache = {
        steamId: id,
        isPremium: local,
        cachedAt: Date.now(),
      };
    }
    return local;
  },

  cacheIsPremium(steamId: string, isPremium: boolean) {
    const id = steamId.trim();
    if (!id) return;
    writePremiumCache(id, isPremium);
  },

  async getDiscordLinkStatus(
    steamId: string,
  ): Promise<DiscordLinkStatus | null> {
    const id = steamId.trim();
    if (!id) return null;

    const inFlight = discordLinkInFlight.get(id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<DiscordLinkStatus | null> => {
      const url = new URL(`${getSubscriptionsApiUrl()}/discord/link-status`);
      url.searchParams.set("steamId", id);

      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          return ghostboxApi.getCachedDiscordLinkStatus(id);
        }
        const status = (await response.json()) as DiscordLinkStatus;
        writeDiscordLinkCache(id, status);
        return status;
      } catch {
        return ghostboxApi.getCachedDiscordLinkStatus(id);
      } finally {
        discordLinkInFlight.delete(id);
      }
    })();

    discordLinkInFlight.set(id, promise);
    return promise;
  },

  async getSubscriptionStatus(
    steamId: string,
  ): Promise<SubscriptionStatusResult | null> {
    const id = steamId.trim();
    const url = new URL(`${getSubscriptionsApiUrl()}/subscription/status`);
    url.searchParams.set("steamId", id);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      if (!response.ok) return null;
      const status = (await response.json()) as SubscriptionStatusResult;
      if (status.discordLink) {
        writeDiscordLinkCache(id, status.discordLink);
      }
      writePremiumCache(id, resolveIsPremium(status));
      return status;
    } catch {
      return null;
    }
  },

  async isPremiumUser(steamId: string): Promise<boolean> {
    const id = steamId.trim();
    if (!id) return false;

    const inFlight = premiumInFlight.get(id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<boolean> => {
      try {
        const status = await ghostboxApi.getSubscriptionStatus(id);
        const premium = resolveIsPremium(status);
        writePremiumCache(id, premium);
        return premium;
      } catch {
        return ghostboxApi.getCachedIsPremium(id) === true;
      } finally {
        premiumInFlight.delete(id);
      }
    })();

    premiumInFlight.set(id, promise);
    return promise;
  },

  async createSubscriptionCheckout(
    steamId: string,
    planId: SubscriptionPlanId,
  ): Promise<SubscriptionCheckoutResult | null> {
    if ("__TAURI_INTERNALS__" in window) {
      try {
        return await invoke<SubscriptionCheckoutResult>(
          "subscription_create_checkout",
          { steamId, planId },
        );
      } catch {
        return null;
      }
    }

    const response = await fetch(
      `${getSubscriptionsApiUrl()}/subscription/checkouts`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ steamId, planId }),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as SubscriptionCheckoutResult;
  },

  async createSubscriptionPortalSession(
    steamId: string,
    flow: SubscriptionPortalFlow = "manage",
  ): Promise<SubscriptionPortalResult | null> {
    const id = steamId.trim();
    if (!id) return null;

    try {
      const response = await fetch(
        `${getSubscriptionsApiUrl()}/subscription/portal`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ steamId: id, flow }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Could not open billing portal.");
      }
      return (await response.json()) as SubscriptionPortalResult;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("Could not open billing portal.");
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

  getGames(request?: GameDatabaseRequest): Promise<GameDatabaseResult> {
    return invokeOr<GameDatabaseResult>(
      "database_get_games",
      { request: request ?? null, apiUrl: getGamesApiUrl() },
      emptyGameDatabase,
    );
  },

  getGameDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null,
    );
  },

  getGameStoreDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_store_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null,
    );
  },

  getGameAchievementDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_achievement_details",
      { gameId, apiUrl: getGamesApiUrl() },
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

  getGamePlaytimes(): Promise<GamePlaytimeSnapshot> {
    return invokeOr<GamePlaytimeSnapshot>("game_get_playtimes", {}, {});
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

  /** Fetch GetOwnedGames via Steam Web API (proxy key or local) and rebuild playtimes. */
  syncSteamPlaytimes(steamId: string): Promise<GamePlaytimeSnapshot> {
    return invokeOr<GamePlaytimeSnapshot>(
      "steam_sync_playtimes",
      { steamId },
      {},
    );
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

  async signInWithSteam(): Promise<SteamProfile> {
    const profile = await invoke<SteamProfile>("steam_sign_in", {});
    if (!profile?.steamId) {
      throw new Error("Steam profile is invalid");
    }
    return profile;
  },

  signOutSteam(): Promise<void> {
    return invokeOr<void>("steam_sign_out", {}, undefined);
  },

  getCloudSession(): Promise<CloudSessionResult | null> {
    return invokeOr<CloudSessionResult | null>("cloud_get_session", {}, null);
  },

  signOutCloud(): Promise<void> {
    return invokeOr<void>("cloud_sign_out", {}, undefined);
  },

  listCloudSaves(appId?: string): Promise<CloudSave[]> {
    return invokeOr<{ saves: CloudSave[] }>(
      "cloud_list_saves",
      { appId: appId ?? null },
      { saves: [] },
    ).then((result) => result.saves ?? []);
  },

  backupGameToCloud(game: GhostBoxGame): Promise<CloudBackupResult | null> {
    return invokeOr<CloudBackupResult | null>(
      "cloud_backup_game",
      { game },
      null,
    );
  },

  restoreCloudSave(
    game: GhostBoxGame,
    saveId: string,
  ): Promise<CloudRestoreResult | null> {
    return invokeOr<CloudRestoreResult | null>(
      "cloud_restore_save",
      { game, saveId },
      null,
    );
  },

  deleteCloudSave(saveId: string): Promise<CloudSaveDeletionResult | null> {
    return invokeOr<CloudSaveDeletionResult | null>(
      "cloud_delete_save",
      { saveId },
      null,
    );
  },

  setCloudSavePinned(
    saveId: string,
    pinned: boolean,
  ): Promise<CloudSavePinnedResult | null> {
    return invokeOr<CloudSavePinnedResult | null>(
      "cloud_set_save_pinned",
      { saveId, pinned },
      null,
    );
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
