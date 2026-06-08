import type { CatalogueFilters, CatalogueFilterKey } from "../types";
import type { GameDatabaseResult } from "../data";

export const gameResultLimit = 200;
export const cataloguePageSize = 20;
export const catalogueChunkPageCount = 10;
export const catalogueChunkSize = cataloguePageSize * catalogueChunkPageCount;
export const searchDebounceMs = 750;
export const catalogueFilterLimit = 120;
export const hiddenLibraryAppIds = new Set(["228980"]);
export const favoriteGamesStorageKey = "piratebox:favorites:v1";
export const userCollectionsStorageKey = "piratebox:user-collections:v1";
export const steamProfileStorageKey = "piratebox:steam-profile:v1";
export const startupPageStorageKey = "piratebox:startup-page:v1";
export const imageSourceCacheKey = "piratebox:image-source-cache:v1";
export const recentPlayedGamesStorageKey = "piratebox:recent-played-games:v3";
export const profileHistoryGamesStorageKey = "piratebox:profile-history-games:v1";
export const showSteamGamesStorageKey = "piratebox:show-steam-games:v1";
export const recentLibrarySessionLimit = 50;
export const librarySortStorageKey = "piratebox:library-sort-by:v1";
export const imageSourceCacheLimit = 800;

export const emptyCatalogueFilters: CatalogueFilters = {
  genres: [],
  tags: [],
  developers: [],
  publishers: [],
  years: [],
};

export const emptyGameDatabase: GameDatabaseResult = {
  games: [],
  total: 0,
  matched: 0,
  limited: false,
  source: "atualizardatabase.md",
};

export const filterCategoryColors: Record<CatalogueFilterKey, string> = {
  genres: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 24%)",
  developers: "hsl(205deg 45% 36%)",
  publishers: "hsl(330deg 36% 36%)",
  years: "hsl(38deg 50% 40%)",
};
