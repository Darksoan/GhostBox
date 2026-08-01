import type { CatalogueFilters, CatalogueFilterKey } from "../types";
import type { GameDatabaseResult } from "../data";

export const cataloguePageSize = 20;
export const catalogueChunkPageCount = 10;
export const catalogueChunkSize = cataloguePageSize * catalogueChunkPageCount;
export const searchDebounceMs = 300;
export const favoriteGamesStorageKey = "ghostbox:favorites:v1";
export const userCollectionsStorageKey = "ghostbox:user-collections:v1";
export const steamProfileStorageKey = "ghostbox:steam-profile:v1";
export const cloudProfileUpdatedAtStorageKey = "ghostbox:cloud-profile-updated-at:v1";
export const startupPageStorageKey = "ghostbox:startup-page:v1";
export const imageSourceCacheKey = "ghostbox:image-source-cache:v1";
export const recentPlayedGamesStorageKey = "ghostbox:recent-played-games:v3";
export const profileHistoryGamesStorageKey = "ghostbox:profile-history-games:v1";
export const showSteamGamesStorageKey = "ghostbox:show-steam-games:v1";
export const personalCalendarStorageKey = "ghostbox:personal-calendar:v2";
export const steamWishlistRecommendationsStorageKey = "ghostbox:steam-wishlist-recommendations:v1";
export const steamWishlistReviewCacheStorageKey = "ghostbox:steam-wishlist-review-cache:v1";
export const recentLibrarySessionLimit = 50;
export const librarySortStorageKey = "ghostbox:library-sort-by:v1";
export const overviewSortStorageKey = "ghostbox:overview-sort-by:v1";
export const notificationsLastSeenStorageKey = "ghostbox:notifications-last-seen:v1";
export const autoRestoredCloudSavesStorageKey = "ghostbox:auto-restored-cloud-saves:v1";
export const imageSourceCacheLimit = 800;

const legacyStorageKeys: Record<string, string[]> = {
  [favoriteGamesStorageKey]: ["eden:favorites:v1", "piratebox:favorites:v1"],
  [userCollectionsStorageKey]: ["eden:user-collections:v1", "piratebox:user-collections:v1"],
  [steamProfileStorageKey]: ["eden:steam-profile:v1", "piratebox:steam-profile:v1"],
  [cloudProfileUpdatedAtStorageKey]: [
    "eden:cloud-profile-updated-at:v1",
    "piratebox:cloud-profile-updated-at:v1",
  ],
  [startupPageStorageKey]: ["eden:startup-page:v1", "piratebox:startup-page:v1"],
  [imageSourceCacheKey]: ["eden:image-source-cache:v1", "piratebox:image-source-cache:v1"],
  [recentPlayedGamesStorageKey]: ["eden:recent-played-games:v3", "piratebox:recent-played-games:v3"],
  [profileHistoryGamesStorageKey]: ["eden:profile-history-games:v1", "piratebox:profile-history-games:v1"],
  [showSteamGamesStorageKey]: ["eden:show-steam-games:v1", "piratebox:show-steam-games:v1"],
  [personalCalendarStorageKey]: ["eden:personal-calendar:v2", "piratebox:personal-calendar:v2"],
  [steamWishlistRecommendationsStorageKey]: ["eden:steam-wishlist-recommendations:v1", "piratebox:steam-wishlist-recommendations:v1"],
  [steamWishlistReviewCacheStorageKey]: ["eden:steam-wishlist-review-cache:v1", "piratebox:steam-wishlist-review-cache:v1"],
  [librarySortStorageKey]: ["eden:library-sort-by:v1", "piratebox:library-sort-by:v1"],
};

if (typeof window !== "undefined") {
  for (const [ghostboxKey, legacyKeys] of Object.entries(legacyStorageKeys)) {
    if (window.localStorage.getItem(ghostboxKey) === null) {
      const legacyValue = legacyKeys
        .map((legacyKey) => window.localStorage.getItem(legacyKey))
        .find((value): value is string => value !== null);
      if (legacyValue !== undefined) {
        window.localStorage.setItem(ghostboxKey, legacyValue);
      }
    }
  }
}

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

/** Category orbs — one distinct accent per filter family (no repeats). */
export const filterCategoryColors: Record<CatalogueFilterKey, string> = {
  genres: "hsl(262deg 50% 47%)", // purple
  tags: "hsl(95deg 50% 34%)", // green
  developers: "hsl(205deg 45% 42%)", // blue
  publishers: "hsl(330deg 36% 42%)", // pink
  years: "hsl(4deg 62% 48%)", // red
};
