import type {
  GhostBoxGame,
  GameRequirements,
  GameStatus,
  SteamAchievement,
} from "../data";
import type { SteamGameReview } from "../lib/ghostboxApi.types";
import type { StartupPage, UserCollection, SteamProfile } from "../types";
import {
  favoriteGamesStorageKey,
  userCollectionsStorageKey,
  steamProfileStorageKey,
  cloudProfileUpdatedAtStorageKey,
  startupPageStorageKey,
  profileHistoryGamesStorageKey,
  showSteamGamesStorageKey,
  personalCalendarStorageKey,
  steamWishlistRecommendationsStorageKey,
  steamWishlistReviewCacheStorageKey,
  recentLibrarySessionLimit,
  librarySortStorageKey,
  overviewSortStorageKey,
  notificationsLastSeenStorageKey,
  autoRestoredCloudSavesStorageKey,
  downloadsDirStorageKey,
  downloadParallelChunksStorageKey,
} from "../constants/catalogue";

export type LibrarySortBy = "title" | "recent" | "playtime";
export type OverviewSortBy = "recent" | "playtime" | "title" | "achievements" | "perfect";

export type StoredPersonalCalendar = {
  algorithmVersion: string;
  weekStart: string;
  cycleStart: string;
  expiresAt: string;
  gameIds: string[];
  monthGameIds: Record<string, string[]>;
};

export type StoredSteamWishlistRecommendations = {
  steamId: string;
  expiresAt: string;
  algorithmVersion?: string;
  gameIds: string[];
  recommendationPairs?: Array<{
    sourceAppId: string;
    sourceTitle?: string;
    recommendedAppId: string;
    recommendedTitle?: string;
  }>;
};

export type StoredSteamWishlistReview = {
  appId: string;
  language: string;
  expiresAt: string;
  review: SteamGameReview;
};

type StoredSteamWishlistReviewCache = Record<string, StoredSteamWishlistReview>;

function storedString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function storedNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function storedBannerPosition(value: unknown) {
  if (!value || typeof value !== "object") return undefined;

  const position = value as Record<string, unknown>;
  return {
    x: Math.min(100, Math.max(0, Math.round(storedNumber(position.x, 50)))),
    y: Math.min(100, Math.max(0, Math.round(storedNumber(position.y, 50)))),
    scale: Math.min(3, Math.max(1, Number(storedNumber(position.scale, 1).toFixed(2)))),
  };
}

function storedStartupPage(value: unknown): StartupPage | null {
  return value === "home" || value === "catalogue" || value === "profile" ? value : null;
}

function storedStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function storedStringArrayRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string[]>>(
    (record, [key, item]) => {
      const values = storedStringArray(item);
      if (key && values.length) record[key] = values;
      return record;
    },
    {}
  );
}

function normalizeStoredPersonalCalendar(
  value: unknown
): StoredPersonalCalendar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const calendar = value as Record<string, unknown>;
  const algorithmVersion = storedString(calendar.algorithmVersion);
  const cycleStart = storedString(calendar.cycleStart);
  const weekStart = storedString(calendar.weekStart) || cycleStart;
  const expiresAt = storedString(calendar.expiresAt);
  const gameIds = storedStringArray(calendar.gameIds);
  const monthGameIds = storedStringArrayRecord(calendar.monthGameIds);

  if (
    !algorithmVersion ||
    !cycleStart ||
    !weekStart ||
    !expiresAt ||
    !Number.isFinite(Date.parse(cycleStart)) ||
    !Number.isFinite(Date.parse(weekStart)) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    gameIds.length === 0 ||
    Object.keys(monthGameIds).length === 0
  ) {
    return null;
  }

  return { algorithmVersion, weekStart, cycleStart, expiresAt, gameIds, monthGameIds };
}

function normalizeStoredSteamWishlistRecommendations(
  value: unknown
): StoredSteamWishlistRecommendations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const wishlist = value as Record<string, unknown>;
  const steamId = storedString(wishlist.steamId);
  const expiresAt = storedString(wishlist.expiresAt);
  const algorithmVersion = storedString(wishlist.algorithmVersion) || undefined;
  const gameIds = storedStringArray(wishlist.gameIds);
  const recommendationPairs = Array.isArray(wishlist.recommendationPairs)
    ? wishlist.recommendationPairs.flatMap((pair) => {
        if (!pair || typeof pair !== "object" || Array.isArray(pair)) return [];
        const record = pair as Record<string, unknown>;
        const sourceAppId = storedString(record.sourceAppId);
        const sourceTitle = storedString(record.sourceTitle) || undefined;
        const recommendedAppId = storedString(record.recommendedAppId);
        const recommendedTitle = storedString(record.recommendedTitle) || undefined;
        return sourceAppId && recommendedAppId
          ? [{ sourceAppId, sourceTitle, recommendedAppId, recommendedTitle }]
          : [];
      })
    : [];

  if (
    !steamId ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    (gameIds.length === 0 && recommendationPairs.length === 0)
  ) {
    return null;
  }

  return { steamId, expiresAt, algorithmVersion, gameIds, recommendationPairs };
}

function normalizeStoredSteamReviewAuthor(value: unknown): SteamGameReview["author"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const author = value as Record<string, unknown>;

  return {
    steamid: storedString(author.steamid),
    personaname: storedString(author.personaname),
    profileurl: storedString(author.profileurl),
    avatar: storedString(author.avatar),
    playtime_forever: storedNumber(author.playtime_forever) || undefined,
    playtime_last_two_weeks: storedNumber(author.playtime_last_two_weeks) || undefined,
    playtime_at_review: storedNumber(author.playtime_at_review) || undefined,
    last_played: storedNumber(author.last_played) || undefined,
  };
}

function normalizeStoredSteamWishlistReview(
  value: unknown
): StoredSteamWishlistReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const cachedReview = value as Record<string, unknown>;
  const appId = storedString(cachedReview.appId);
  const language = storedString(cachedReview.language);
  const expiresAt = storedString(cachedReview.expiresAt);
  const reviewRecord = cachedReview.review;
  if (!reviewRecord || typeof reviewRecord !== "object" || Array.isArray(reviewRecord)) {
    return null;
  }

  const review = reviewRecord as Record<string, unknown>;
  const author = normalizeStoredSteamReviewAuthor(review.author);
  const reviewText = storedString(review.review).trim();

  if (
    !appId ||
    !language ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    !author ||
    !reviewText
  ) {
    return null;
  }

  return {
    appId,
    language,
    expiresAt,
    review: {
      recommendationid: storedString(review.recommendationid),
      author,
      language: storedString(review.language, language),
      review: reviewText,
      timestamp_created: storedNumber(review.timestamp_created),
      timestamp_updated: storedNumber(review.timestamp_updated) || undefined,
      voted_up: review.voted_up !== false,
      votes_up: storedNumber(review.votes_up),
      votes_funny: storedNumber(review.votes_funny) || undefined,
      weighted_vote_score: storedString(review.weighted_vote_score) || undefined,
      steam_purchase: typeof review.steam_purchase === "boolean" ? review.steam_purchase : undefined,
      received_for_free: typeof review.received_for_free === "boolean" ? review.received_for_free : undefined,
    },
  };
}

function storedGameStatus(value: unknown): GameStatus {
  return value === "installed" || value === "queued" || value === "syncing"
    ? value
    : "discover";
}

function storedAchievements(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { unlocked: 0, total: 0, progress: 0 };
  }

  const achievements = value as Record<string, unknown>;

  return {
    unlocked: storedNumber(achievements.unlocked),
    total: storedNumber(achievements.total),
    progress: storedNumber(achievements.progress),
  };
}

function normalizeStoredAchievement(value: unknown): SteamAchievement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const achievement = value as Record<string, unknown>;
  const name = storedString(achievement.name);
  const title = storedString(achievement.title, name);
  if (!name && !title) return null;

  return {
    name,
    title,
    description: storedString(achievement.description),
    icon: storedString(achievement.icon),
    iconGray: storedString(achievement.iconGray),
    globalPercent:
      typeof achievement.globalPercent === "number" &&
      Number.isFinite(achievement.globalPercent)
        ? achievement.globalPercent
        : undefined,
    unlocked: achievement.unlocked === true,
    unlockedAt: storedString(achievement.unlockedAt) || undefined,
  };
}

function storedRequirements(value: unknown): GameRequirements | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const requirements = value as Record<string, unknown>;

  return {
    minimum: storedStringArray(requirements.minimum),
    recommended: storedStringArray(requirements.recommended),
  };
}

function normalizeStoredFavoriteGame(value: unknown): GhostBoxGame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const game = value as Record<string, unknown>;
  const id = storedString(game.id);
  if (!id) return null;

  const appId = storedString(game.appId, id.replace(/^steam-/, ""));

  return {
    appId,
    id,
    title: storedString(game.title, id),
    subtitle: storedString(game.subtitle),
    status: storedGameStatus(game.status),
    hours: storedNumber(game.hours),
    playTimeInMilliseconds: storedNumber(game.playTimeInMilliseconds),
    lastTimePlayed: storedString(game.lastTimePlayed) || null,
    lastSessionRecordedAt: storedString(game.lastSessionRecordedAt) || null,
    rating: storedNumber(game.rating),
    size: storedString(game.size),
    release: storedString(game.release),
    progress: storedNumber(game.progress),
    accent: storedString(game.accent, "#f0f1f7"),
    cover: storedString(game.cover),
    hero: storedString(game.hero),
    coverUrl: storedString(game.coverUrl),
    heroUrl: storedString(game.heroUrl),
    coverFallbacks: storedStringArray(game.coverFallbacks),
    heroFallbacks: storedStringArray(game.heroFallbacks),
    logo: storedString(game.logo),
    tags: storedStringArray(game.tags),
    genres: storedStringArray(game.genres),
    screenshots: storedStringArray(game.screenshots),
    achievements: storedAchievements(game.achievements),
    achievementList: Array.isArray(game.achievementList)
      ? game.achievementList.flatMap((achievement) => {
          const normalizedAchievement = normalizeStoredAchievement(achievement);
          return normalizedAchievement ? [normalizedAchievement] : [];
        })
      : [],
    pcRequirements: storedRequirements(game.pcRequirements),
    databaseAddedAt: storedNumber(game.databaseAddedAt) || undefined,
  };
}

function normalizeStoredCollection(value: unknown): UserCollection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const collection = value as Record<string, unknown>;
  const name = storedString(collection.name).trim();
  if (!name) return null;

  const storedId = storedString(collection.id).trim();
  const id = storedId || `collection-${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`;

  return {
    id,
    name,
    gameIds: storedStringArray(collection.gameIds),
    games: Array.isArray(collection.games)
      ? collection.games.flatMap((game) => {
          const normalizedGame = normalizeStoredFavoriteGame(game);
          return normalizedGame ? [normalizedGame] : [];
        })
      : [],
  };
}

export function readStoredFavoriteGames(): GhostBoxGame[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(favoriteGamesStorageKey) ?? "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];

    const uniqueGames = new Map<string, GhostBoxGame>();
    parsed.forEach((game) => {
      const favoriteGame = normalizeStoredFavoriteGame(game);
      if (favoriteGame) {
        uniqueGames.set(favoriteGame.id, favoriteGame);
      }
    });

    return [...uniqueGames.values()];
  } catch {
    return [];
  }
}

export function writeStoredFavoriteGames(favoriteGames: GhostBoxGame[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      favoriteGamesStorageKey,
      JSON.stringify(favoriteGames)
    );
  } catch {
    // Favorites still work during the session if localStorage is unavailable.
  }
}

export function readStoredProfileHistoryGames(): GhostBoxGame[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(profileHistoryGamesStorageKey) ?? "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];

    const uniqueGames = new Map<string, GhostBoxGame>();
    parsed.forEach((game) => {
      const historyGame = normalizeStoredFavoriteGame(game);
      if (historyGame) uniqueGames.set(historyGame.appId, historyGame);
    });

    return [...uniqueGames.values()].slice(0, recentLibrarySessionLimit);
  } catch {
    return [];
  }
}

export function writeStoredProfileHistoryGames(games: GhostBoxGame[]) {
  if (typeof window === "undefined") return;

  try {
    // Never persist playtime locally — Steam sync is the only source of truth.
    const sanitized = games.slice(0, recentLibrarySessionLimit).map((game) => {
      const {
        playTimeInMilliseconds: _playTimeInMilliseconds,
        lastSessionRecordedAt: _lastSessionRecordedAt,
        lastSessionDurationInMilliseconds: _lastSessionDurationInMilliseconds,
        sessionActive: _sessionActive,
        ...rest
      } = game;
      return rest;
    });
    window.localStorage.setItem(
      profileHistoryGamesStorageKey,
      JSON.stringify(sanitized)
    );
  } catch {
    // Profile history still works during the session if localStorage is unavailable.
  }
}

export function writeStoredShowSteamGames(value: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(showSteamGamesStorageKey, value ? "true" : "false");
  } catch {
    // Setting still works during the session if localStorage is unavailable.
  }
}

export function readStoredPersonalCalendar(): StoredPersonalCalendar | null {
  if (typeof window === "undefined") return null;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(personalCalendarStorageKey) ?? "null"
    ) as unknown;

    return normalizeStoredPersonalCalendar(parsed);
  } catch {
    return null;
  }
}

export function writeStoredPersonalCalendar(
  calendar: StoredPersonalCalendar
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      personalCalendarStorageKey,
      JSON.stringify(calendar)
    );
  } catch {
    // Calendar can be regenerated if localStorage is unavailable.
  }
}

export function readStoredSteamWishlistRecommendations(): StoredSteamWishlistRecommendations | null {
  if (typeof window === "undefined") return null;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(steamWishlistRecommendationsStorageKey) ?? "null"
    ) as unknown;

    return normalizeStoredSteamWishlistRecommendations(parsed);
  } catch {
    return null;
  }
}

export function writeStoredSteamWishlistRecommendations(
  wishlist: StoredSteamWishlistRecommendations
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      steamWishlistRecommendationsStorageKey,
      JSON.stringify(wishlist)
    );
  } catch {
    // Wishlist recommendations can be regenerated if localStorage is unavailable.
  }
}

function steamWishlistReviewCacheKey(appId: string, language: string) {
  return `${appId.trim()}:${language.trim().toLowerCase()}`;
}

function readStoredSteamWishlistReviewCache(): StoredSteamWishlistReviewCache {
  if (typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(steamWishlistReviewCacheStorageKey) ?? "{}"
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const now = Date.now();
    const cache: StoredSteamWishlistReviewCache = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const cachedReview = normalizeStoredSteamWishlistReview(value);
      if (!cachedReview || Date.parse(cachedReview.expiresAt) <= now) return;
      cache[key] = cachedReview;
    });

    return cache;
  } catch {
    return {};
  }
}

function writeStoredSteamWishlistReviewCache(cache: StoredSteamWishlistReviewCache) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      steamWishlistReviewCacheStorageKey,
      JSON.stringify(cache)
    );
  } catch {
    // Reviews still load from the network if localStorage is unavailable.
  }
}

export function readStoredSteamWishlistReview(
  appId: string,
  language: string
): StoredSteamWishlistReview | null {
  const key = steamWishlistReviewCacheKey(appId, language);
  return readStoredSteamWishlistReviewCache()[key] ?? null;
}

export function writeStoredSteamWishlistReview(review: StoredSteamWishlistReview) {
  const key = steamWishlistReviewCacheKey(review.appId, review.language);
  const cache = readStoredSteamWishlistReviewCache();
  cache[key] = review;
  writeStoredSteamWishlistReviewCache(cache);
}

export function readStoredUserCollections(): UserCollection[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(userCollectionsStorageKey) ?? "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];

    const uniqueCollections = new Map<string, UserCollection>();
    parsed.forEach((collection) => {
      const userCollection = normalizeStoredCollection(collection);
      if (userCollection) {
        uniqueCollections.set(userCollection.id, userCollection);
      }
    });

    return [...uniqueCollections.values()];
  } catch {
    return [];
  }
}

export function writeStoredUserCollections(collections: UserCollection[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      userCollectionsStorageKey,
      JSON.stringify(collections)
    );
  } catch {
    // Collections still work during the session if localStorage is unavailable.
  }
}

export function readStoredSteamProfile(): SteamProfile | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(steamProfileStorageKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const profile = parsed as Record<string, unknown>;
    return {
      steamId: storedString(profile.steamId),
      displayName: storedString(profile.displayName),
      avatarUrl: storedString(profile.avatarUrl),
      bannerUrl: storedString(profile.bannerUrl),
      bannerPosition: storedBannerPosition(profile.bannerPosition),
      profileUrl: storedString(profile.profileUrl),
    };
  } catch {
    return null;
  }
}

export function writeStoredSteamProfile(profile: SteamProfile | null) {
  if (typeof window === "undefined") return;

  try {
    if (profile) {
      window.localStorage.setItem(steamProfileStorageKey, JSON.stringify(profile));
    } else {
      window.localStorage.removeItem(steamProfileStorageKey);
    }
  } catch {
    // Profile still works during the session if localStorage is unavailable.
  }
}

export function readStoredCloudProfileUpdatedAt(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(cloudProfileUpdatedAtStorageKey);
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeStoredCloudProfileUpdatedAt(value: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (value) {
      window.localStorage.setItem(cloudProfileUpdatedAtStorageKey, value);
    } else {
      window.localStorage.removeItem(cloudProfileUpdatedAtStorageKey);
    }
  } catch {
    // Timestamp is best-effort for multi-device merge.
  }
}

export function readStoredStartupPage(): StartupPage {
  if (typeof window === "undefined") return "home";

  try {
    const stored = window.localStorage.getItem(startupPageStorageKey);
    return storedStartupPage(stored) ?? "home";
  } catch {
    return "home";
  }
}

export function writeStoredStartupPage(page: StartupPage) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(startupPageStorageKey, page);
  } catch {
    // Startup page still works during the session if localStorage is unavailable.
  }
}

export function readStoredAutoRestoredCloudSaves(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(autoRestoredCloudSavesStorageKey) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function writeStoredAutoRestoredCloudSaves(value: Record<string, string>) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      autoRestoredCloudSavesStorageKey,
      JSON.stringify(value),
    );
  } catch {
    // Auto-restore still works during the session if localStorage is unavailable.
  }
}

export function readStoredLibrarySortBy(): LibrarySortBy {
  if (typeof window === "undefined") return "title";

  try {
    const stored = window.localStorage.getItem(librarySortStorageKey);
    return stored === "recent" || stored === "playtime" || stored === "title"
      ? stored
      : "title";
  } catch {
    return "title";
  }
}

export function writeStoredLibrarySortBy(sortBy: LibrarySortBy) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(librarySortStorageKey, sortBy);
  } catch {
    // The setting still works during the session if localStorage is unavailable.
  }
}

export function readStoredDownloadsDir(): string {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(downloadsDirStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeStoredDownloadsDir(directory: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(downloadsDirStorageKey, directory);
  } catch {
    // The chosen folder still applies for the rest of the session.
  }
}

/* Faixa espelha o clamp do worker em SteamKitPocRunner: fora dela o valor é ignorado. */
export const downloadParallelChunksMin = 1;
export const downloadParallelChunksMax = 32;
export const downloadParallelChunksDefault = 24;

export function readStoredDownloadParallelChunks(): number {
  if (typeof window === "undefined") return downloadParallelChunksDefault;

  try {
    const raw = window.localStorage.getItem(downloadParallelChunksStorageKey);
    const parsed = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(parsed)) return downloadParallelChunksDefault;
    return Math.min(downloadParallelChunksMax, Math.max(downloadParallelChunksMin, parsed));
  } catch {
    return downloadParallelChunksDefault;
  }
}

export function writeStoredDownloadParallelChunks(value: number) {
  if (typeof window === "undefined") return;

  const clamped = Math.min(
    downloadParallelChunksMax,
    Math.max(downloadParallelChunksMin, Math.round(value)),
  );

  try {
    window.localStorage.setItem(downloadParallelChunksStorageKey, String(clamped));
  } catch {
    // The chosen value still applies for the rest of the session.
  }
}

export function readStoredOverviewSortBy(): OverviewSortBy {
  if (typeof window === "undefined") return "recent";

  try {
    const stored = window.localStorage.getItem(overviewSortStorageKey);
    return stored === "recent" ||
      stored === "playtime" ||
      stored === "title" ||
      stored === "achievements" ||
      stored === "perfect"
      ? stored
      : "recent";
  } catch {
    return "recent";
  }
}

export function writeStoredOverviewSortBy(sortBy: OverviewSortBy) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(overviewSortStorageKey, sortBy);
  } catch {
    // The setting still works during the session if localStorage is unavailable.
  }
}

/** Timestamp of last visit to the notifications page. First call seeds "now" (no badge spam). */
export function readNotificationsLastSeenAt(): number {
  if (typeof window === "undefined") return Date.now();

  try {
    const raw = window.localStorage.getItem(notificationsLastSeenStorageKey);
    if (raw == null) {
      const now = Date.now();
      window.localStorage.setItem(notificationsLastSeenStorageKey, String(now));
      return now;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

export function writeNotificationsLastSeenAt(timestamp = Date.now()) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(notificationsLastSeenStorageKey, String(timestamp));
  } catch {
    // Session-only if localStorage is unavailable.
  }
}
