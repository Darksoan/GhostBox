import type {
  GhostBoxGame,
  GameRequirements,
  GameStatus,
  SteamAchievement,
} from "../data";
import type { StartupPage, UserCollection, SteamProfile } from "../types";
import {
  favoriteGamesStorageKey,
  userCollectionsStorageKey,
  steamProfileStorageKey,
  startupPageStorageKey,
  recentPlayedGamesStorageKey,
  profileHistoryGamesStorageKey,
  showSteamGamesStorageKey,
  personalCalendarStorageKey,
  steamWishlistRecommendationsStorageKey,
  recentLibrarySessionLimit,
  librarySortStorageKey,
} from "../constants/catalogue";

export type LibrarySortBy = "title" | "recent" | "playtime";

export type StoredPersonalCalendar = {
  weekStart: string;
  expiresAt: string;
  gameIds: string[];
  recentGameIds: string[];
};

export type StoredSteamWishlistRecommendations = {
  steamId: string;
  expiresAt: string;
  gameIds: string[];
};

function storedString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function storedNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasCompletedPlaySession(game: GhostBoxGame) {
  return (
    Number.isFinite(Date.parse(game.lastTimePlayed ?? "")) &&
    !/^Steam App \d+$/i.test(game.title.trim())
  );
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

function normalizeStoredPersonalCalendar(
  value: unknown
): StoredPersonalCalendar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const calendar = value as Record<string, unknown>;
  const weekStart = storedString(calendar.weekStart);
  const expiresAt = storedString(calendar.expiresAt);
  const gameIds = storedStringArray(calendar.gameIds);
  const recentGameIds = storedStringArray(calendar.recentGameIds);

  if (
    !weekStart ||
    !expiresAt ||
    !Number.isFinite(Date.parse(weekStart)) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    gameIds.length === 0
  ) {
    return null;
  }

  return { weekStart, expiresAt, gameIds, recentGameIds };
}

function normalizeStoredSteamWishlistRecommendations(
  value: unknown
): StoredSteamWishlistRecommendations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const wishlist = value as Record<string, unknown>;
  const steamId = storedString(wishlist.steamId);
  const expiresAt = storedString(wishlist.expiresAt);
  const gameIds = storedStringArray(wishlist.gameIds);

  if (
    !steamId ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    gameIds.length === 0
  ) {
    return null;
  }

  return { steamId, expiresAt, gameIds };
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

export function readStoredRecentPlayedGames(): GhostBoxGame[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(recentPlayedGamesStorageKey) ?? "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];

    const games: GhostBoxGame[] = [];
    const seenAppIds = new Set<string>();

    parsed.forEach((game) => {
      const recentGame = normalizeStoredFavoriteGame(game);
      if (
        !recentGame ||
        !hasCompletedPlaySession(recentGame) ||
        seenAppIds.has(recentGame.appId)
      ) return;

      seenAppIds.add(recentGame.appId);
      games.push(recentGame);
    });

    return games.slice(0, recentLibrarySessionLimit);
  } catch {
    return [];
  }
}

export function writeStoredRecentPlayedGames(games: GhostBoxGame[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      recentPlayedGamesStorageKey,
      JSON.stringify(
        games.filter(hasCompletedPlaySession).slice(0, recentLibrarySessionLimit)
      )
    );
  } catch {
    // Recent games still work during the session if localStorage is unavailable.
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
    window.localStorage.setItem(
      profileHistoryGamesStorageKey,
      JSON.stringify(games.slice(0, recentLibrarySessionLimit))
    );
  } catch {
    // Profile history still works during the session if localStorage is unavailable.
  }
}

export function readStoredShowSteamGames(): boolean {
  if (typeof window === "undefined") return true;

  try {
    const raw = window.localStorage.getItem(showSteamGamesStorageKey);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
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
