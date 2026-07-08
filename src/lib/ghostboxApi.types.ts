import type {
  AddGameResult,
  GameDatabaseRequest,
  GameDatabaseResult,
  HomeResult,
  GhostBoxGame,
  RemoveGameResult,
} from "../data";

import type {
  BackupDetails,
  BackupRootStatus,
  BackupSettings,
  StartupSettings,
  SteamLibraryScanResult,
  SteamAccountStats,
  SteamProfile,
  SteamWishlistItem,
} from "../types";

export type {
  AddGameResult,
  GameDatabaseRequest,
  GameDatabaseResult,
  HomeResult,
  GhostBoxGame,
  RemoveGameResult,
  BackupDetails,
  BackupRootStatus,
  BackupSettings,
  StartupSettings,
  SteamLibraryScanResult,
  SteamAccountStats,
  SteamProfile,
  SteamWishlistItem,
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
  lastSessionRecordedAt?: string | null;
  lastSessionDurationInMilliseconds?: number;
  sessionActive?: boolean;
};

export type GamePlaytimeSnapshot = Record<string, GamePlaytimeEntry>;

export type SteamGameReviewAuthor = {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  playtime_forever?: number;
  playtime_last_two_weeks?: number;
  playtime_at_review?: number;
  last_played?: number;
};

export type SteamGameReview = {
  recommendationid: string;
  author: SteamGameReviewAuthor;
  language: string;
  review: string;
  timestamp_created: number;
  timestamp_updated?: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny?: number;
  weighted_vote_score?: string;
  steam_purchase?: boolean;
  received_for_free?: boolean;
};

export type SteamReviewHistogramBucket = {
  date: number;
  recommendations_up: number;
  recommendations_down: number;
};

export type SteamReviewHistogram = {
  start_date?: number;
  end_date?: number;
  weeks?: SteamReviewHistogramBucket[];
  rollups?: SteamReviewHistogramBucket[];
  rollup_type?: string;
  recent?: SteamReviewHistogramBucket[];
};

export type SteamGameReviewsResult = {
  success: number;
  query_summary?: {
    num_reviews?: number;
    review_score?: number;
    review_score_desc?: string;
    total_positive?: number;
    total_negative?: number;
    total_reviews?: number;
  };
  reviews: SteamGameReview[];
  reviewHistogram?: SteamReviewHistogram;
};

export type SteamRecommendedTag = {
  tagid?: number;
  tagId?: number;
  name?: string;
  tag_name?: string;
  tagName?: string;
  weight?: number;
  score?: number;
};

export type AppStatus = {
  name: string;
  version: string;
  runtime: string;
  dev: boolean;
};

export type FeedbackRequest = {
  message: string;
  language: "pt" | "en";
  steamId?: string;
  userName?: string;
};

export type FeedbackResult = {
  success: boolean;
  error?: string;
};

export type UpdateManifest = {
  latestVersion: string;
  installerUrl: string;
  releaseNotesUrl?: string;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  installerUrl: string;
  releaseNotesUrl?: string;
};

export type UpdateInstallResult = {
  success: boolean;
  installerPath?: string;
};

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
  libraryGame?: GhostBoxGame;
  message?: string;
};

export type LocalAchievementsUnlockedPayload = {
  appId: string;
  title: string;
  achievements: string[];
};

export type CatalogueCacheUpdatedPayload = {
  updatedAt?: string;
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

export type SteamRestartResult = {
  success: boolean;
  status: "opened" | "opened-url" | "failed" | "missing";
  steamPath?: string;
  checkedPaths?: string[];
  message?: string;
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

export type DiscordLinkStatus = {
  steamId: string;
  linked: boolean;
  discordUserId: string | null;
  discordUsername: string | null;
  discordGlobalName: string | null;
  linkedAt: string | null;
  premiumRole: {
    synced: boolean;
    skipped: boolean;
    reason: string | null;
  } | null;
};

export type SubscriptionStatusResult = {
  steamId: string;
  subscription: {
    status: "free" | "active" | "expired";
    isPremium: boolean;
    planId: "monthly" | "quarterly" | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    lastPaymentId: string | null;
    updatedAt: string | null;
  };
  latestPayment: unknown | null;
  discordLink?: DiscordLinkStatus;
};

export type SubscriptionPlanId = "monthly" | "quarterly";

export type SubscriptionPayment = {
  id: string;
  checkoutReference: string;
  checkoutId: string | null;
  steamId: string;
  planId: SubscriptionPlanId;
  amountCents: number;
  currency: string;
  status: string;
  hostedCheckoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  pixCode: string | null;
  pixQrCodeUrl: string | null;
};

export type SubscriptionCheckoutResult = {
  payment: SubscriptionPayment | null;
};

export type CloudSessionResult = {
  token: string;
  user: {
    steamId: string;
    displayName: string | null;
    avatarUrl: string | null;
    isPremium: boolean;
  };
  subscription: SubscriptionStatusResult["subscription"];
};

export type CloudSave = {
  id: string;
  steamId: string;
  appId: string;
  gameTitle: string;
  sizeBytes: number;
  sha256: string;
  manifest: unknown | null;
  deviceName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CloudSavesResult = {
  saves: CloudSave[];
};

export type CloudBackupResult = {
  save: CloudSave;
};

export type CloudRestoreResult = {
  success: boolean;
  appId: string;
  title: string;
  saveId: string;
  backupSizeBytes: number;
};
