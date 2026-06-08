import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AddGameResult,
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
  LaunchGameResult,
  LocalBackupResult,
  LocalRestoreResult,
  LudusaviBackupPreviewGame,
  MorrenusStatsResult,
  NotificationSettings,
  PirateGame,
  RemoveGameResult,
  StartupSettings,
  SteamLibraryScanResult,
  SteamPathSelectionResult,
  SteamProfile,
} from "./pirateboxApi.types";

function noopUnsubscribe() {
  return undefined;
}

const emptyGameDatabase: GameDatabaseResult = {
  games: [],
  total: 0,
  matched: 0,
  limited: false,
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
  getGames(request?: GameDatabaseRequest): Promise<GameDatabaseResult> {
    return invokeOr<GameDatabaseResult>(
      "database_get_games",
      { request: request ?? null },
      emptyGameDatabase
    );
  },

  getGameDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_details",
      { gameId },
      null
    );
  },

  getGameStoreDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_store_details",
      { gameId },
      null
    );
  },

  getGameAchievementDetails(gameId: string): Promise<PirateGame | null> {
    return invokeOr<PirateGame | null>(
      "database_get_game_achievement_details",
      { gameId },
      null
    );
  },

  getCachedImage(url: string): Promise<string> {
    return invokeOr<string>("cache_get_image", { url }, url);
  },

  addGameViaLuaTools(game: PirateGame): Promise<AddGameResult> {
    void game;
    return Promise.resolve({
      success: false,
      error: "PirateBox API indisponivel.",
    });
  },

  removeGameViaLuaTools(game: PirateGame): Promise<RemoveGameResult> {
    void game;
    return Promise.resolve({
      success: false,
      error: "PirateBox API indisponivel.",
    });
  },

  getGamePlaytimes(): Promise<GamePlaytimeSnapshot> {
    return Promise.resolve({});
  },

  onGamePlaytimesChanged(
    callback: (snapshot: GamePlaytimeSnapshot) => void
  ): () => void {
    void callback;
    return noopUnsubscribe;
  },

  isSteamToolsInstalled(): Promise<boolean> {
    return Promise.resolve(true);
  },

  installSteamTools(): Promise<{ success: boolean; error?: string }> {
    return Promise.resolve({ success: false });
  },

  getSteamProfile(): Promise<SteamProfile | null> {
    return Promise.resolve(null);
  },

  saveSteamProfile(profile: SteamProfile): Promise<SteamProfile> {
    return Promise.resolve(profile);
  },

  signInWithSteam(): Promise<SteamProfile | undefined> {
    return Promise.resolve(undefined);
  },

  signOutSteam(): Promise<void> {
    return Promise.resolve();
  },

  restartSteam(): Promise<void> {
    return Promise.resolve();
  },

  scanSteamLibrary(
    steamPath?: string,
    forceRefreshOwnedGames?: boolean,
    includeOwnedGames?: boolean
  ): Promise<SteamLibraryScanResult | undefined> {
    void steamPath;
    void forceRefreshOwnedGames;
    void includeOwnedGames;
    return Promise.resolve(undefined);
  },

  selectSteamPath(): Promise<SteamPathSelectionResult | undefined> {
    return Promise.resolve(undefined);
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
    return Promise.resolve(undefined);
  },

  setMorrenusApiKey(apiKey: string): Promise<string | undefined> {
    void apiKey;
    return Promise.resolve(undefined);
  },

  getMorrenusStats(apiKey: string): Promise<MorrenusStatsResult | undefined> {
    void apiKey;
    return Promise.resolve(undefined);
  },

  validateBackupRoot(): Promise<BackupRootStatus | undefined> {
    return Promise.resolve(undefined);
  },

  onBackupSettingsChanged(
    callback: (settings: BackupSettings) => void
  ): () => void {
    void callback;
    return noopUnsubscribe;
  },

  selectBackupOutputPath(): Promise<BackupOutputPathSelectionResult | undefined> {
    return Promise.resolve(undefined);
  },

  openBackupFolder(
    appId: string,
    backupPath?: string
  ): Promise<BackupPathActionResult> {
    void appId;
    void backupPath;
    return Promise.resolve({
      success: false,
      error: "Reinicie o app para carregar os novos controles de backup.",
    });
  },

  deleteBackupFolder(
    appId: string,
    backupPath?: string
  ): Promise<BackupFolderDeletionResult> {
    void appId;
    void backupPath;
    return Promise.resolve({
      success: false,
      error: "Reinicie o app para carregar os novos controles de backup.",
    });
  },

  getBackupDetails(
    appId: string,
    backupPath?: string
  ): Promise<BackupDetails | null> {
    void appId;
    void backupPath;
    return Promise.resolve(null);
  },

  runGameLocalBackup(
    game: LudusaviBackupPreviewGame
  ): Promise<LocalBackupResult | undefined> {
    void game;
    return Promise.resolve(undefined);
  },

  restoreGameLocalBackup(
    game: LudusaviBackupPreviewGame,
    backupPath?: string
  ): Promise<LocalRestoreResult | undefined> {
    void game;
    void backupPath;
    return Promise.resolve(undefined);
  },

  setGameAutomaticBackup(
    appId: string,
    enabled: boolean
  ): Promise<BackupSettings | undefined> {
    void appId;
    void enabled;
    return Promise.resolve(undefined);
  },

  setLibraryAutomaticBackups(
    enabled: boolean,
    appIds: string[]
  ): Promise<BackupSettings | undefined> {
    void enabled;
    void appIds;
    return Promise.resolve(undefined);
  },

  refreshGameBackupMetadata(appId: string): Promise<BackupSettings | null> {
    void appId;
    return Promise.resolve(null);
  },

  selectGameExecutable(
    game: PirateGame
  ): Promise<GameExecutableSelectionResult | undefined> {
    void game;
    return Promise.resolve(undefined);
  },

  setGameCustomExecutable(
    appId: string,
    executablePath: string | null
  ): Promise<BackupSettings | undefined> {
    void appId;
    void executablePath;
    return Promise.resolve(undefined);
  },

  launchGame(game: LudusaviBackupPreviewGame): Promise<LaunchGameResult | undefined> {
    void game;
    return Promise.resolve(undefined);
  },

  getGameIconUrl(appId: string): Promise<string | null> {
    void appId;
    return Promise.resolve(null);
  },

  onSteamCmdReady(callback: () => void): () => void {
    void callback;
    return noopUnsubscribe;
  },

  minimize(): Promise<void> {
    return invokeOr<void>("window_minimize", {}, undefined);
  },

  close(): Promise<void> {
    return invokeOr<void>("window_close", {}, undefined);
  },

  openExternal(url: string): Promise<void> {
    return openUrl(url).catch(() => undefined);
  },
};
