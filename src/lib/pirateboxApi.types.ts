import type {
  AddGameResult,
  GameDatabaseRequest,
  GameDatabaseResult,
  PirateGame,
  RemoveGameResult,
} from "../data";

import type {
  BackupDetails,
  BackupRootStatus,
  BackupSettings,
  StartupSettings,
  SteamLibraryScanResult,
  SteamProfile,
} from "../types";

export type {
  AddGameResult,
  GameDatabaseRequest,
  GameDatabaseResult,
  PirateGame,
  RemoveGameResult,
  BackupDetails,
  BackupRootStatus,
  BackupSettings,
  StartupSettings,
  SteamLibraryScanResult,
  SteamProfile,
};

export type NotificationSettings = {
  inAppToastsEnabled: boolean;
  inAppSuccessToastsEnabled: boolean;
  inAppErrorToastsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  achievementsEnabled: boolean;
  backupSuccessEnabled: boolean;
  backupErrorEnabled: boolean;
  restoreSuccessEnabled: boolean;
  restoreErrorEnabled: boolean;
};

export type GamePlaytimeEntry = {
  appId: string;
  playTimeInMilliseconds: number;
  lastTimePlayed: string | null;
};

export type GamePlaytimeSnapshot = Record<string, GamePlaytimeEntry>;

export type BackupOutputPathSelectionResult = {
  status: "ok" | "cancelled";
  settings: BackupSettings;
};

export type BackupPathActionResult = {
  success: boolean;
  path?: string;
  error?: string;
};

export type BackupFolderDeletionResult = BackupPathActionResult & {
  settings?: BackupSettings;
};

export type GameExecutableSelectionResult = {
  status: "ok" | "cancelled" | "invalid";
  appId: string;
  executablePath?: string;
  settings: BackupSettings;
  libraryGame?: PirateGame;
  message?: string;
};

export type LaunchGameResult = {
  success: boolean;
  appId: string;
  customExecutable?: boolean;
  error?: string;
};

export type LocalBackupResult = {
  success: boolean;
  appId: string;
  title: string;
  skipped?: boolean;
  outputPath?: string;
  error?: string;
  settings?: BackupSettings;
};

export type LocalRestoreResult = {
  success: boolean;
  appId: string;
  title: string;
  backupPath?: string;
  backupSizeBytes?: number;
  error?: string;
  settings?: BackupSettings;
};

export type LudusaviBackupPreviewGame = {
  id: string;
  appId: string;
  title: string;
};

export type MorrenusStatsResult = {
  success: boolean;
  stats?: unknown;
  error?: string;
};

export type SteamPathSelectionResult =
  | {
      status: "ok";
      steamPath: string;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "invalid";
      selectedPath: string;
      missingEntries: string[];
      message: string;
    };
