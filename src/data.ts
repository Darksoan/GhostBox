import { ghostboxApi } from "./lib/ghostboxApi";
import type { SteamGameReviewsResult, SteamRecommendedTag } from "./lib/ghostboxApi.types";
import type { SteamWishlistItem } from "./types";

export type GameStatus = "installed" | "queued" | "discover" | "syncing";

export type AchievementStats = {
  unlocked: number;
  total: number;
  progress: number;
};

export type SteamAchievement = {
  name: string;
  title: string;
  description: string;
  icon: string;
  iconGray: string;
  globalPercent?: number;
  unlocked?: boolean;
  unlockedAt?: string;
};

export type GameRequirements = {
  minimum: string[];
  recommended: string[];
};

export type SteamVideoSource = {
  max: string;
  "480": string;
};

export type SteamMovie = {
  id: number;
  name: string;
  thumbnail: string;
  highlight: boolean;
  hls_h264?: string;
  dash_h264?: string;
  dash_av1?: string;
  mp4?: SteamVideoSource;
  webm?: SteamVideoSource;
};

export type GhostBoxGame = {
  appId: string;
  id: string;
  librarySource?:
    | "steam-installed"
    | "steam-owned"
    | "ghostbox"
    | "plugin"
    | "registered";
  title: string;
  subtitle: string;
  status: GameStatus;
  hours: number;
  playTimeInMilliseconds?: number;
  lastTimePlayed?: string | null;
  lastSessionRecordedAt?: string | null;
  lastSessionDurationInMilliseconds?: number;
  sessionActive?: boolean;
  rating: number;
  size: string;
  release: string;
  progress: number;
  accent: string;
  cover: string;
  hero: string;
  coverUrl: string;
  heroUrl: string;
  coverFallbacks: string[];
  heroFallbacks: string[];
  logo: string;
  tags: string[];
  genres: string[];
  developers?: string[];
  publishers?: string[];
  screenshots: string[];
  movies?: SteamMovie[];
  shortDescription?: string;
  aboutTheGame?: string;
  achievements: AchievementStats;
  achievementList: SteamAchievement[];
  pcRequirements?: GameRequirements;
  databaseAddedAt?: number;
  popularityScore?: number;
  popularityRank?: number;
  steamReviewCount?: number;
  steamPositiveRatio?: number;
  metacriticScore?: number;
  recommendations?: number;
};

export type GameDatabaseRequest = {
  query?: string;
  limit?: number;
  offset?: number;
  sort?: "popular" | "recentlyAdded";
  includeFacets?: boolean;
  facetsOnly?: boolean;
  filters?: {
    genres?: string[];
    tags?: string[];
    developers?: string[];
    publishers?: string[];
    status?: string[];
    years?: string[];
  };
};

export type GameDatabaseResult = {
  games: GhostBoxGame[];
  total: number;
  matched: number;
  limited: boolean;
  source: string;
  updatedAt?: string;
  facets?: {
    genres?: string[];
    tags?: string[];
    developers?: string[];
    publishers?: string[];
    years?: string[];
  };
};

export type HomeResult = {
  popular: GhostBoxGame[];
  recentlyAdded: GhostBoxGame[];
  total: number;
  updatedAt?: string;
  source: string;
  facets?: GameDatabaseResult["facets"];
};

export type AddGameResult =
  | {
      success: true;
      api: string;
      installedPath: string;
      manifestCount: number;
      libraryGame: GhostBoxGame;
    }
  | {
      success: false;
      error: string;
    };

export type RemoveGameResult =
  | {
      success: true;
      appId: string;
      removedFiles: string[];
    }
  | {
      success: false;
      error: string;
    };

export async function loadGames(
  request: GameDatabaseRequest = {}
): Promise<GameDatabaseResult> {
  return ghostboxApi.getGames(request);
}

export async function loadGameDetails(
  gameId: string
): Promise<GhostBoxGame | null> {
  return ghostboxApi.getGameDetails(gameId);
}

export async function loadGameStoreDetails(
  gameId: string
): Promise<GhostBoxGame | null> {
  return ghostboxApi.getGameStoreDetails(gameId);
}

export async function loadSteamWishlist(
  steamId: string
): Promise<SteamWishlistItem[]> {
  return ghostboxApi.getSteamWishlist(steamId);
}

export async function loadSteamRecommendedTagsForUser(
  steamId: string
): Promise<SteamRecommendedTag[]> {
  return ghostboxApi.getSteamRecommendedTagsForUser(steamId);
}

export async function loadSteamSimilarAppIds(appId: string): Promise<string[]> {
  return ghostboxApi.getSteamSimilarAppIds(appId);
}

export async function loadGameAchievementDetails(
  gameId: string
): Promise<GhostBoxGame | null> {
  return ghostboxApi.getGameAchievementDetails(gameId);
}

export async function loadGameReviews(
  gameId: string,
  language: "all" | "brazilian" | "english",
  reviewType: "all" | "positive" | "negative" = "all"
): Promise<SteamGameReviewsResult> {
  return ghostboxApi.getGameReviews(gameId, language, reviewType);
}

export async function loadCachedImage(url: string): Promise<string> {
  return ghostboxApi.getCachedImage(url);
}

export async function resolveSteamLibraryAsset(
  appId: string,
  fileName: string
): Promise<string> {
  return ghostboxApi.resolveSteamLibraryAsset(appId, fileName);
}

export async function addGameViaLuaTools(
  game: GhostBoxGame
): Promise<AddGameResult> {
  return ghostboxApi.addGameViaLuaTools(game);
}

export async function registerSteamLibraryGame(
  game: GhostBoxGame
): Promise<AddGameResult> {
  return ghostboxApi.registerSteamLibraryGame(game);
}

export async function removeGameViaLuaTools(
  game: GhostBoxGame
): Promise<RemoveGameResult> {
  return ghostboxApi.removeGameViaLuaTools(game);
}
