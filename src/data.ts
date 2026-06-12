import { pirateboxApi } from "./lib/pirateboxApi";

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

export type PirateGame = {
  appId: string;
  id: string;
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
  games: PirateGame[];
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
  popular: PirateGame[];
  recentlyAdded: PirateGame[];
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
      libraryGame: PirateGame;
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
  return pirateboxApi.getGames(request);
}

export async function loadGameDetails(
  gameId: string
): Promise<PirateGame | null> {
  return pirateboxApi.getGameDetails(gameId);
}

export async function loadGameStoreDetails(
  gameId: string
): Promise<PirateGame | null> {
  return pirateboxApi.getGameStoreDetails(gameId);
}

export async function loadGameAchievementDetails(
  gameId: string
): Promise<PirateGame | null> {
  return pirateboxApi.getGameAchievementDetails(gameId);
}

export async function loadCachedImage(url: string): Promise<string> {
  return pirateboxApi.getCachedImage(url);
}

export async function resolveSteamLibraryAsset(
  appId: string,
  fileName: string
): Promise<string> {
  return pirateboxApi.resolveSteamLibraryAsset(appId, fileName);
}

export async function addGameViaLuaTools(
  game: PirateGame
): Promise<AddGameResult> {
  return pirateboxApi.addGameViaLuaTools(game);
}

export async function removeGameViaLuaTools(
  game: PirateGame
): Promise<RemoveGameResult> {
  return pirateboxApi.removeGameViaLuaTools(game);
}
