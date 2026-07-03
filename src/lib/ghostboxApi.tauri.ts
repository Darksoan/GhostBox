import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AddGameResult,
  AppStatus,
  BackupDetails,
  BackupFolderDeletionResult,
  BackupOutputPathSelectionResult,
  BackupPathActionResult,
  BackupRootStatus,
  BackupSettings,
  GameDatabaseRequest,
  GameDatabaseResult,
  GameExecutableSelectionResult,
  GamePlaytimeSnapshot,
  SteamGameReviewsResult,
  SteamRecommendedTag,
  HomeResult,
  CatalogueCacheUpdatedPayload,
  LaunchGameResult,
  LocalAchievementsUnlockedPayload,
  LocalBackupResult,
  LocalRestoreResult,
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
  UpdateManifest,
  DiscordLinkStatus,
  CloudBackupResult,
  CloudRestoreResult,
  CloudSave,
  CloudSessionResult,
  SubscriptionStatusResult,
} from "./ghostboxApi.types";

function noopUnsubscribe() {
  return undefined;
}

const defaultGamesApiUrl = "https://piratebox-catalogue.hella.workers.dev";
const defaultSubscriptionsApiUrl = "https://ghostbox-subscriptions.hella.workers.dev";
const defaultFeedbackApiUrl = "https://ghostbox-feedback.hella.workers.dev/feedback";
const defaultUpdatesApiUrl = "https://ghostbox-feedback.hella.workers.dev/updates/latest";
const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "0.1.0";

function compareVersions(left: string, right: string) {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
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
  return import.meta.env.VITE_GHOSTBOX_FEEDBACK_API_URL?.trim() || defaultFeedbackApiUrl;
}

function getUpdatesApiUrl() {
  return import.meta.env.VITE_GHOSTBOX_UPDATES_API_URL?.trim() || defaultUpdatesApiUrl;
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
  fallback: T
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

  async getDiscordLinkStatus(steamId: string): Promise<DiscordLinkStatus | null> {
    const url = new URL(`${getSubscriptionsApiUrl()}/discord/link-status`);
    url.searchParams.set("steamId", steamId);

    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json() as DiscordLinkStatus;
    } catch {
      return null;
    }
  },

  async getSubscriptionStatus(steamId: string): Promise<SubscriptionStatusResult | null> {
    const url = new URL(`${getSubscriptionsApiUrl()}/subscription/status`);
    url.searchParams.set("steamId", steamId);

    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json() as SubscriptionStatusResult;
    } catch {
      return null;
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
        const payload = await response.json().catch(() => null) as { error?: string } | null;
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
    const apiUrl = getUpdatesApiUrl();

    try {
      const url = new URL(apiUrl);
      url.searchParams.set("currentVersion", appVersion);
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) return null;

      const manifest = await response.json() as Partial<UpdateManifest>;
      const latestVersion = manifest.latestVersion?.trim() || appVersion;
      const installerUrl = manifest.installerUrl?.trim() || "";
      const updateAvailable = compareVersions(latestVersion, appVersion) > 0 && installerUrl.startsWith("https://");

      return {
        updateAvailable,
        currentVersion: appVersion,
        latestVersion,
        installerUrl: updateAvailable ? installerUrl : "",
        releaseNotesUrl: manifest.releaseNotesUrl?.trim() || undefined,
      };
    } catch {
      return null;
    }
  },

  installUpdate(installerUrl: string): Promise<UpdateInstallResult> {
    return invokeOr<UpdateInstallResult>(
      "app_download_and_run_update",
      { request: { installerUrl } },
      { success: false }
    );
  },

  getAppStatus(): Promise<AppStatus | undefined> {
    return invokeOr<AppStatus | undefined>("app_get_status", {}, undefined);
  },

  getHome(): Promise<HomeResult> {
    return invokeOr<HomeResult>(
      "catalogue_get_home",
      { apiUrl: getGamesApiUrl() },
      emptyHomeResult
    );
  },

  getGames(request?: GameDatabaseRequest): Promise<GameDatabaseResult> {
    return invokeOr<GameDatabaseResult>(
      "database_get_games",
      { request: request ?? null, apiUrl: getGamesApiUrl() },
      emptyGameDatabase
    );
  },

  getGameDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
    );
  },

  getGameStoreDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_store_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
    );
  },

  getGameAchievementDetails(gameId: string): Promise<GhostBoxGame | null> {
    return invokeOr<GhostBoxGame | null>(
      "database_get_game_achievement_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
    );
  },

  getGameReviews(
    gameId: string,
    language: "all" | "brazilian" | "english",
    reviewType: "all" | "positive" | "negative" = "all"
  ): Promise<SteamGameReviewsResult> {
    return invokeOr<SteamGameReviewsResult>(
      "database_get_game_reviews",
      { gameId, language, reviewType },
      { success: 0, reviews: [] }
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
      ""
    );
  },

  addGameViaLuaTools(game: GhostBoxGame): Promise<AddGameResult> {
    return invokeOr<AddGameResult>(
      "luatools_add_game",
      { game },
      { success: false, error: "Não foi possível adicionar o jogo via LuaTools." }
    );
  },

  removeGameViaLuaTools(game: GhostBoxGame): Promise<RemoveGameResult> {
    return invokeOr<RemoveGameResult>(
      "luatools_remove_game",
      { game },
      { success: false, error: "Não foi possível remover o jogo via LuaTools." }
    );
  },

  getGamePlaytimes(): Promise<GamePlaytimeSnapshot> {
    return invokeOr<GamePlaytimeSnapshot>("game_get_playtimes", {}, {});
  },

  onGamePlaytimesChanged(
    callback: (snapshot: GamePlaytimeSnapshot) => void
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
      { success: true }
    );
  },

  getSteamProfile(): Promise<SteamProfile | null> {
    return invokeOr<SteamProfile | null>("steam_get_profile", {}, null);
  },

  getSteamAccountStats(steamId: string): Promise<SteamAccountStats | null> {
    return invokeOr<SteamAccountStats | null>(
      "steam_get_account_stats",
      { steamId },
      null
    );
  },

  onSteamAccountStatsUpdated(
    callback: (stats: SteamAccountStats) => void
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
      { saves: [] }
    ).then((result) => result.saves ?? []);
  },

  backupGameToCloud(game: GhostBoxGame): Promise<CloudBackupResult | null> {
    return invokeOr<CloudBackupResult | null>("cloud_backup_game", { game }, null);
  },

  restoreCloudSave(game: GhostBoxGame, saveId: string): Promise<CloudRestoreResult | null> {
    return invokeOr<CloudRestoreResult | null>(
      "cloud_restore_save",
      { game, saveId },
      null
    );
  },

  getSteamWishlist(steamId: string): Promise<SteamWishlistItem[]> {
    return invokeOr<SteamWishlistItem[]>(
      "steam_get_wishlist",
      { steamId },
      []
    );
  },

  getSteamRecommendedTagsForUser(steamId: string): Promise<SteamRecommendedTag[]> {
    return invokeOr<SteamRecommendedTag[]>(
      "steam_get_recommended_tags_for_user",
      { steamId },
      []
    );
  },

  getSteamSimilarAppIds(appId: string): Promise<string[]> {
    return invokeOr<string[]>(
      "steam_get_similar_app_ids",
      { appId },
      []
    );
  },

  restartSteam(): Promise<SteamRestartResult | undefined> {
    return invokeOr<SteamRestartResult | undefined>(
      "steam_restart",
      {},
      undefined
    );
  },

  scanSteamLibrary(
    steamPath?: string,
    forceRefreshOwnedGames?: boolean,
    includeOwnedGames?: boolean
  ): Promise<SteamLibraryScanResult | undefined> {
    return invokeOr<SteamLibraryScanResult | undefined>(
      "steam_scan_library",
      {
        steamPath: steamPath ?? null,
        forceRefreshOwnedGames: forceRefreshOwnedGames ?? false,
        includeOwnedGames: includeOwnedGames ?? true,
      },
      undefined
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
      undefined
    );
  },

  getStartupSettings(): Promise<StartupSettings | undefined> {
    return invokeOr<StartupSettings | undefined>(
      "app_get_startup_settings",
      {},
      undefined
    );
  },

  setStartupSettings(
    settings: Partial<StartupSettings>
  ): Promise<StartupSettings | undefined> {
    return invokeOr<StartupSettings | undefined>(
      "app_set_startup_settings",
      { settings },
      undefined
    );
  },

  setNotificationSettings(settings: NotificationSettings): Promise<void> {
    return invokeOr<void>("app_set_notification_settings", { settings }, undefined);
  },

  getMorrenusApiKey(): Promise<string | undefined> {
    return invokeOr<string | undefined>("app_get_morrenus_api_key", {}, undefined);
  },

  setMorrenusApiKey(apiKey: string): Promise<string> {
    return invoke<string>("app_set_morrenus_api_key", { apiKey });
  },

  getMorrenusStats(apiKey: string): Promise<MorrenusStatsResult | undefined> {
    return invokeOr<MorrenusStatsResult | undefined>(
      "app_get_morrenus_stats",
      { apiKey },
      undefined
    );
  },

  validateBackupRoot(): Promise<BackupRootStatus | undefined> {
    return invokeOr<BackupRootStatus | undefined>(
      "backup_validate_root",
      {},
      undefined
    );
  },

  ensureBackupRoot(): Promise<BackupRootStatus | undefined> {
    return invokeOr<BackupRootStatus | undefined>(
      "backup_ensure_root",
      {},
      undefined
    );
  },

  getBackupSettings(): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_get_settings",
      {},
      undefined
    );
  },

  setBackupOutputPath(outputPath: string): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_set_output_path",
      { outputPath },
      undefined
    );
  },

  onBackupSettingsChanged(
    callback: (settings: BackupSettings) => void
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

  async selectBackupOutputPath(): Promise<BackupOutputPathSelectionResult | undefined> {
    const settings = await invokeOr<BackupSettings | undefined>(
      "backup_get_settings",
      {},
      undefined
    );
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Selecione a pasta de backups",
      defaultPath: settings?.outputPath,
    });

    if (typeof selectedPath !== "string") {
      return settings ? { status: "cancelled", settings } : undefined;
    }

    const nextSettings = await invoke<BackupSettings>("backup_set_output_path", {
      outputPath: selectedPath,
    });
    return { status: "ok", settings: nextSettings };
  },

  openBackupFolder(
    appId: string,
    backupPath?: string
  ): Promise<BackupPathActionResult> {
    return invokeOr<BackupPathActionResult>(
      "backup_open_folder",
      { appId, backupPath: backupPath ?? null },
      { success: false, error: "Não foi possível abrir a pasta de backup." }
    );
  },

  deleteBackupFolder(
    appId: string,
    backupPath?: string
  ): Promise<BackupFolderDeletionResult> {
    return invokeOr<BackupFolderDeletionResult>(
      "backup_delete_folder",
      { appId, backupPath: backupPath ?? null },
      { success: false, error: "Não foi possível excluir a pasta de backup." }
    );
  },

  getBackupDetails(
    appId: string,
    backupPath?: string
  ): Promise<BackupDetails | null> {
    return invokeOr<BackupDetails | null>(
      "backup_get_details",
      { appId, backupPath: backupPath ?? null, apiUrl: getGamesApiUrl() },
      null
    );
  },

  runGameLocalBackup(
    game: LudusaviBackupPreviewGame
  ): Promise<LocalBackupResult | undefined> {
    return invokeOr<LocalBackupResult | undefined>(
      "backup_run_game_local",
      { game },
      undefined
    );
  },

  restoreGameLocalBackup(
    game: LudusaviBackupPreviewGame,
    backupPath?: string
  ): Promise<LocalRestoreResult | undefined> {
    return invokeOr<LocalRestoreResult | undefined>(
      "backup_restore_game_local",
      { game, backupPath: backupPath ?? null },
      undefined
    );
  },

  setGameAutomaticBackup(
    appId: string,
    enabled: boolean
  ): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_set_game_automatic",
      { appId, enabled },
      undefined
    );
  },

  setLibraryAutomaticBackups(
    enabled: boolean,
    appIds: string[]
  ): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_set_library_automatic",
      { enabled, appIds },
      undefined
    );
  },

  setBackupEntryPinned(
    appId: string,
    backupPath: string,
    pinned: boolean
  ): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_set_entry_pinned",
      { appId, backupPath, pinned },
      undefined
    );
  },

  refreshGameBackupMetadata(appId: string): Promise<BackupSettings | null> {
    return invokeOr<BackupSettings | null>(
      "backup_refresh_game_metadata",
      { appId },
      null
    );
  },

  async selectGameExecutable(
    game: GhostBoxGame
  ): Promise<GameExecutableSelectionResult | undefined> {
    const executablePath = await open({
      directory: false,
      multiple: false,
      title: "Selecione o executável do jogo",
      filters: [{ name: "Executável", extensions: ["exe"] }],
    });

    if (typeof executablePath !== "string") {
      return undefined;
    }

    return invokeOr<GameExecutableSelectionResult | undefined>(
      "backup_select_game_executable",
      { game, executablePath },
      undefined
    );
  },

  getLudusaviBackupPreviews(
    games: LudusaviBackupPreviewGame[]
  ): Promise<LudusaviBackupPreviewGame[]> {
    return invokeOr<LudusaviBackupPreviewGame[]>(
      "ludusavi_get_backup_previews",
      { games },
      []
    );
  },

  setGameCustomExecutable(
    appId: string,
    executablePath: string | null
  ): Promise<BackupSettings | undefined> {
    return invokeOr<BackupSettings | undefined>(
      "backup_set_game_custom_executable",
      { appId, executablePath },
      undefined
    );
  },

  launchGame(game: LudusaviBackupPreviewGame): Promise<LaunchGameResult | undefined> {
    return invokeOr<LaunchGameResult | undefined>(
      "game_launch",
      { game },
      {
        success: false,
        appId: game.appId,
        error: "Não foi possível iniciar o jogo.",
      }
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
      }
    );
  },

  showMainWindowFromTray(): Promise<void> {
    return invokeOr<void>("tray_show_main_window", {}, undefined);
  },

  navigateFromTray(page: "home" | "catalogue" | "library" | "profile"): Promise<void> {
    return invokeOr<void>("tray_navigate", { page }, undefined);
  },

  onTrayNavigate(
    callback: (payload: { page: "home" | "catalogue" | "library" | "profile" }) => void
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<{ page: "home" | "catalogue" | "library" | "profile" }>(
      "tray-navigate",
      (event) => callback(event.payload)
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
    return invokeOr<string | null>(
      "steam_get_game_icon_url",
      { appId },
      null
    );
  },

  onSteamCmdReady(callback: () => void): () => void {
    void callback;
    return noopUnsubscribe;
  },

  onCatalogueCacheUpdated(
    callback: (payload: CatalogueCacheUpdatedPayload) => void
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<CatalogueCacheUpdatedPayload>(
      "catalogue-cache-updated",
      (event) => {
        callback(event.payload);
      }
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
    callback: (payload: LocalAchievementsUnlockedPayload) => void
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<LocalAchievementsUnlockedPayload>(
      "local-achievements-unlocked",
      (event) => {
        callback(event.payload);
      }
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
