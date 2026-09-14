import type {
  AddGameResult,
  FeaturedResult,
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
  FeaturedResult,
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

/** Steam app type resolved from appdetails (`demo`, `game`, ...). */
export type SteamAppTypeMap = Record<string, string>;

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
  installerUrl?: string;
  releaseNotesUrl?: string;
  version?: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, { url?: string; signature?: string }>;
};

export type UpdateCheckResult = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  installerUrl?: string;
  releaseNotesUrl?: string;
};

export type UpdateProgressEvent = {
  event: "Started" | "Progress" | "Finished";
  downloaded: number;
  contentLength: number;
  percent: number;
};

export type UpdateInstallResult = {
  success: boolean;
  error?: string;
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

export type LocalAchievementsUnlockedPayload = {
  appId: string;
  title: string;
  achievements: string[];
};

export type CatalogueCacheUpdatedPayload = {
  updatedAt?: string;
};

/** Resultado da varredura de manutenção das raízes de downloads. */
export type DownloadRootSweepSummary = {
  /** Temporários `.ghostbox-chunks.json.tmp` órfãos removidos. */
  removedChunkTemps: number;
  /** App IDs cujo ACF apontava para pasta inexistente e foi removido da Steam. */
  removedOrphanAcfs: string[];
};

export type LaunchGameResult = {
  success: boolean;
  appId: string;
  error?: string;
};

export type GameShortcutResult = {
  success: boolean;
  path?: string;
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

export type LuaToolsDependenciesStatus = {
  steamFound: boolean;
  steamPath: string;
  luaToolsInstalled: boolean;
  luaToolsPath: string;
  stPluginFolderFound: boolean;
  betterSteamToolsInstalled: boolean;
  openSteamToolFiles: string[];
  openSteamToolConfigured: boolean;
  ready: boolean;
  checkedPaths: string[];
  lastStatus?: string | null;
  lastError?: string | null;
};

export type LuaToolsDependenciesEnsureResult = {
  status: "ready" | "running" | "started" | "failed";
  started: boolean;
  ready: boolean;
  error?: string;
};

export type LuaToolsDependenciesFinishedEvent = {
  success: boolean;
  status: "ready" | "failed" | "unsupported" | string;
  title: string;
  message: string;
  error?: string | null;
};

export type SteamRestartResult = {
  success: boolean;
  status: "opened" | "opened-url" | "failed" | "missing";
  steamPath?: string;
  checkedPaths?: string[];
  message?: string;
  error?: string;
};

/** Biblioteca Steam listada por `steam_list_libraries` (payload Rust PascalCase). */
export type SteamLibraryVolume = {
  Path: string;
  /** Letra da unidade com dois-pontos (`E:`); vazio quando não se aplica. */
  Drive: string;
  /** Rótulo do volume nomeado pelo usuário; vazio quando sem rótulo. */
  Label: string;
  /** `fixed` | `removable` | `network` | `unknown`. */
  DriveType: string;
  FreeBytes: number;
  TotalBytes: number;
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

export type SubscriptionPaymentMethod = {
  type: string | null;
  brand: string | null;
  last4: string | null;
};

export type SubscriptionStatusResult = {
  userId: string;
  steamId: string | null;
  subscription: {
    status: "free" | "active" | "expired";
    isPremium: boolean;
    planId: "monthly" | "quarterly" | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    lastPaymentId: string | null;
    cancelAtPeriodEnd?: boolean;
    updatedAt: string | null;
  };
  latestPayment: unknown | null;
  paymentMethod?: SubscriptionPaymentMethod | null;
  discordLink?: DiscordLinkStatus;
};

export type SubscriptionPlanId = "monthly" | "quarterly";

export type SubscriptionPayment = {
  id: string;
  checkoutReference: string;
  checkoutId: string | null;
  steamId: string | null;
  userId: string | null;
  planId: SubscriptionPlanId;
  amountCents: number;
  currency: string;
  status: string;
  hostedCheckoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeSubscriptionId?: string | null;
  provider?: "stripe" | null;
};

export type SubscriptionCheckoutResult = {
  payment: SubscriptionPayment | null;
};

/** Result of re-reading a checkout straight from Stripe, bypassing the webhook. */
export type SubscriptionRefreshResult = {
  payment: SubscriptionPayment;
  subscription: SubscriptionStatusResult["subscription"];
};

export type SubscriptionPortalFlow = "manage" | "payment_method_update";

export type SubscriptionPortalResult = {
  url: string;
  flow: SubscriptionPortalFlow;
  customerId?: string;
};

export type GhostBoxAccount = {
  userId: string;
  /** Null for provider-created accounts that never had an address on file. */
  email: string | null;
  username: string;
  displayName: string | null;
};

/** Providers that sign in through the system browser hand-off. Steam takes
 * its callback on the app's own loopback port instead. Both create accounts
 * directly and are the only ways into an account. */
export type OAuthProvider = "discord";

/** Every way into an account. */
export type LoginProvider = OAuthProvider | "steam";

/** A proof that an account exists, good for exactly one thing: setting a new
 * password through `completeRecovery`. Never stored as a session. */
export type RecoveryTicket = {
  token: string;
  expiresInSeconds: number;
  account: GhostBoxAccount;
};

export type AccountConnection = {
  provider: LoginProvider | string;
  providerId: string;
  metadata: unknown | null;
  linkedAt: string;
};

export type DiscordConnectionMetadata = {
  username?: string | null;
  globalName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  emailVerified?: boolean;
};

export type SteamConnectionMetadata = {
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type AccountMeResult = {
  /** Present only when the worker slid the session forward. The Rust side
   * persists it; callers can ignore it. */
  token?: string;
  account: GhostBoxAccount;
  subscription: SubscriptionStatusResult["subscription"];
  connections: AccountConnection[];
};

export type CloudSessionResult = {
  token: string;
  account: GhostBoxAccount;
  steamId?: string | null;
  isNewAccount?: boolean;
  disclaimer?: string;
};

export type CloudSaveManifest = {
  backupFormat?: number;
  source?: string;
  profileProgress?: {
    achievements?: boolean;
    achievementCount?: number;
    playtime?: boolean;
    saves?: boolean;
  };
};

export type CloudSave = {
  id: string;
  steamId: string;
  appId: string;
  gameTitle: string;
  sizeBytes: number;
  sha256: string;
  manifest: CloudSaveManifest | null;
  deviceName: string | null;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CloudSaveDeletionResult = {
  success: boolean;
  saveId: string;
  appId?: string;
  remainingSaves?: number;
  error?: string;
};

export type CloudSavePinnedResult = {
  save: CloudSave;
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

export type CloudProfileBannerPosition = {
  x: number;
  y: number;
  scale: number;
};

export type CloudProfileCollection = {
  id: string;
  name: string;
  gameIds: string[];
};

export type CloudProfileSnapshot = {
  version: number;
  updatedAt: string;
  steamProfile: {
    displayName: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    bannerPosition: CloudProfileBannerPosition | null;
  };
  favoriteGameIds: string[];
  hiddenProfileGameIds: string[];
  userCollections: CloudProfileCollection[];
};

export type StorageCategoryId =
  | "images"
  | "catalogueCache"
  | "steamcmd"
  | "webviewCache"
  | "goldbergSaves"
  | "ludusaviConfig";

export type StorageUsageCategory = {
  id: StorageCategoryId;
  bytes: number;
  present: boolean;
};

export type StorageUsage = {
  categories: StorageUsageCategory[];
  totalBytes: number;
};

export type ClearResult = {
  cleared: string[];
  failed: { id: string; reason: string }[];
  freedBytes: number;
};

export type CloudProfileResult = {
  profile: CloudProfileSnapshot | null;
};
