import type { GhostBoxGame } from "../data";

export type Page = "home" | "catalogue" | "library" | "backup" | "favorites" | "settings" | "profile" | "notifications";

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

export type SteamOwnedPlaytime = {
  appId: string;
  name?: string;
  playtimeForever: number;
  rtimeLastPlayed: number;
};

export type SteamAccountStats = {
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
  nextPollAfter?: number;
  recentAchievements: SteamRecentAchievement[];
  ownedPlaytimes?: SteamOwnedPlaytime[];
  achievements?: SteamGameAchievementSummary[];
};

export type SteamGameAchievementSummary = {
  appId: string;
  gameTitle: string;
  achievements: SteamRemoteAchievement[];
};

export type SteamRemoteAchievement = {
  name: string;
  title: string;
  description: string;
  icon: string;
  iconGray: string;
  unlocked: boolean;
  unlockedAt: number;
};

export type SteamRecentAchievement = {
  id: string;
  title: string;
  gameTitle: string;
  icon: string;
  appId: string;
  unlockedAt: number;
};

export type SteamWishlistItem = {
  appId: string;
  title?: string;
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
