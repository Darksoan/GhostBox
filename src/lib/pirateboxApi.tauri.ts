import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
  HomeResult,
  CatalogueCacheUpdatedPayload,
  LaunchGameResult,
  LocalAchievementsUnlockedPayload,
  LocalBackupResult,
  LocalRestoreResult,
  LudusaviBackupPreviewGame,
  MorrenusStatsResult,
  NotificationSettings,
  PirateGame,
  RemoveGameResult,
  StartupSettings,
  SteamRestartResult,
  SteamLibraryScanResult,
  SteamPathSelectionResult,
  SteamProfile,
} from "./pirateboxApi.types";

function noopUnsubscribe() {
  return undefined;
}

const defaultGamesApiUrl = "https://piratebox-catalogue.hella.workers.dev";

function getGamesApiUrl() {
  return (
    import.meta.env.VITE_PIRATEBOX_GAMES_API_URL?.trim() || defaultGamesApiUrl
  ).replace(/\/+$/, "");
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

export const pirateboxApi = {
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

  getGameDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
    );
  },

  getGameStoreDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_store_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
    );
  },

  getGameAchievementDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_achievement_details",
      { gameId, apiUrl: getGamesApiUrl() },
      null
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

  addGameViaLuaTools(game: PirateGame): Promise<AddGameResult> {
    return invokeOr<AddGameResult>(
      "luatools_add_game",
      { game },
      { success: false, error: "Não foi possível adicionar o jogo via LuaTools." }
    );
  },

  removeGameViaLuaTools(game: PirateGame): Promise<RemoveGameResult> {
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
    game: PirateGame
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
