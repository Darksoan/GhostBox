import type { GhostBoxGame } from "../data";

export type Page = "home" | "catalogue" | "library" | "favorites" | "backup" | "settings" | "profile" | "notifications";

export type StartupPage = Extract<Page, "home" | "catalogue" | "profile">;

export type StartupSettings = {
  openAtLogin: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  gameDatabaseUpdateIntervalHours: number;
};

export type BackupSettings = {
  outputPath: string;
  automaticBackupsForLibrary: boolean;
  automaticBackups: Record<string, boolean>;
  backupRecords: Record<string, BackupRecord>;
  customExecutables: Record<string, string>;
};

export type BackupRootStatus = {
  status: "ok" | "missing" | "invalid";
  outputPath: string;
  settings: BackupSettings;
  message: string;
};

export type BackupRecord = {
  title: string;
  lastBackupAt: string;
  lastBackupSuccess: boolean;
  lastBackupPath?: string;
  lastBackupError?: string;
  lastBackupSizeBytes?: number;
  entries?: BackupEntry[];
};

export type BackupEntry = {
  path: string;
  backupAt: string;
  sizeBytes?: number;
  pinned?: boolean;
};

export type BackupFileTreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  sizeBytes?: number;
  children?: BackupFileTreeEntry[];
};

export type BackupDetails = {
  appId: string;
  backupPath: string;
  files: BackupFileTreeEntry[];
  fileCount: number;
  directoryCount: number;
  truncated: boolean;
  achievements: Array<{
    name: string;
    title: string;
    unlockedAt?: string;
    icon?: string;
    iconGray?: string;
  }>;
};

export type CatalogueFilterKey = "genres" | "tags" | "developers" | "publishers" | "years";

export type CatalogueFilters = Record<CatalogueFilterKey, string[]>;

export type CatalogueSort = "popular" | "recentlyAdded";

export type UserCollection = {
  id: string;
  name: string;
  gameIds: string[];
  games?: GhostBoxGame[];
};

export type GameCollection = {
  id: string;
  name: string;
  gamesCount: number;
};

export type SteamProfile = {
  steamId: string;
  displayName: string;
  avatarUrl: string;
  bannerUrl?: string;
  bannerPosition?: {
    x: number;
    y: number;
    scale?: number;
  };
  profileUrl: string;
};

export type SteamWishlistItem = {
  appId: string;
  priority: number;
  dateAdded: number;
};

export type SteamLibraryScanResult =
  | {
      status: "ok";
      steamPath: string;
      libraryPaths: string[];
      appIds: string[];
      addedAppIds: string[];
      games: GhostBoxGame[];
    }
  | {
      status: "missing";
      checkedPaths: string[];
      message: string;
    };
