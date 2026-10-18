import type { GhostBoxGame } from "../data";

export type Page = "home" | "catalogue" | "library" | "favorites" | "settings" | "profile" | "notifications" | "downloads";

export type StartupPage = Extract<Page, "home" | "catalogue" | "profile">;

export type StartupSettings = {
  openAtLogin: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  gameDatabaseUpdateIntervalHours: number;
};

export type BackupSettings = {
  backupRecords: Record<string, BackupRecord>;
};

export type BackupRecord = {
  title: string;
  lastBackupAt: string;
  lastBackupSuccess: boolean;
  lastBackupError?: string;
  lastBackupSizeBytes?: number;
};

export type CatalogueFilterKey = "genres" | "tags" | "developers" | "publishers" | "years";

export type CatalogueFilters = Record<CatalogueFilterKey, string[]>;

export type CatalogueSort = "popular" | "recentlyAdded" | "playingNow";

export type UserCollection = {
  id: string;
  name: string;
  gameIds: string[];
  games?: GhostBoxGame[];
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

type SteamRemoteAchievement = {
  name: string;
  title: string;
  description: string;
  icon: string;
  iconGray: string;
  unlocked: boolean;
  unlockedAt: number;
  globalPercent?: number;
};

type SteamRecentAchievement = {
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
