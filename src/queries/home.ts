import { useQuery } from "@tanstack/react-query";
import type { GhostBoxGame } from "../data";
import {
  loadFeatured,
  loadGames,
  loadSteamRecommendedTagsForUser,
  loadSteamSimilarAppIds,
} from "../data";
import { loadGameStoreDetailsCached } from "../utils/gameCache";
import { createSeedGame } from "../utils/gameSeed";

/** Steam storefront region derived from the UI language. */
export type HomeStorefront = "br" | "us";

export function homeStorefront(language: "pt" | "en"): HomeStorefront {
  return language === "en" ? "us" : "br";
}

// Matches the worker TTLs so the client does not out-poll its own cache:
// /steam/featured keeps 6h in KV, sort=playingNow keeps 5min.
const featuredStaleMs = 6 * 60 * 60 * 1000;
const trendingStaleMs = 5 * 60 * 1000;
const similarStaleMs = 24 * 60 * 60 * 1000;

export const homeTrendingPoolLimit = 40;
export const homePoolLimit = 200;
export const homeSimilarPoolLimit = 12;

export const homeQueryKeys = {
  all: ["home"] as const,
  featured: (cc: HomeStorefront) => ["home", "featured", cc] as const,
  trending: () => ["home", "trending"] as const,
  pool: (seed: number) => ["home", "pool", seed] as const,
  similar: (appId: string) => ["home", "similar", appId] as const,
  recommendedTags: (steamId: string) => ["home", "recommended-tags", steamId] as const,
};

/**
 * Steam's curated storefront rails. `FeaturedGame` carries only
 * `{ appId, name, headerImage }`, so callers seed a paintable card with
 * `createSeedGame` and let `useEnrichedGameCards` fill in tags/description.
 */
export function useHomeFeaturedQuery(cc: HomeStorefront) {
  return useQuery({
    queryKey: homeQueryKeys.featured(cc),
    queryFn: () => loadFeatured(cc),
    staleTime: featuredStaleMs,
    gcTime: featuredStaleMs,
  });
}

/** Live concurrent-player ranking (SteamSpy CCU). Changes on its own all day. */
export function useHomeTrendingQuery() {
  return useQuery({
    queryKey: homeQueryKeys.trending(),
    queryFn: () =>
      loadGames({
        query: "",
        limit: homeTrendingPoolLimit,
        sort: "playingNow",
      }),
    staleTime: trendingStaleMs,
  });
}

/**
 * The catalogue pool every non-Steam-sourced shelf slices from. `seed` is the
 * weekly rotation seed: the worker reshuffles inside each ranking tier, so the
 * pool stays high-quality while its order changes once a week.
 */
export function useHomePoolQuery(seed: number) {
  return useQuery({
    queryKey: homeQueryKeys.pool(seed),
    queryFn: () =>
      loadGames({
        query: "",
        limit: homePoolLimit,
        sort: "popular",
        seed,
      }),
    // The selection is pinned for the whole cycle, and the cycle boundary is
    // already expressed by `seed` being part of the query key — when Monday
    // rolls over the key changes and the pool refetches on its own. A
    // time-based staleTime here would be recomputed on every render (the
    // shelves re-render on each enrichment flush) and drift toward refetching
    // mid-cycle, reshuffling the rails under the user.
    staleTime: Infinity,
  });
}

async function loadSimilarGames(appId: string): Promise<GhostBoxGame[]> {
  const similarAppIds = (await loadSteamSimilarAppIds(appId)).slice(
    0,
    homeSimilarPoolLimit
  );

  const games = await Promise.all(
    similarAppIds.map(async (similarAppId, index) => {
      const details = await loadGameStoreDetailsCached(similarAppId).catch(
        () => null
      );
      return (
        details ??
        createSeedGame({ appId: similarAppId, title: `Steam App ${similarAppId}` }, index, "")
      );
    })
  );

  return games;
}

/** "Porque você jogou X" — Steam's own similarity graph for the anchor game. */
export function useHomeSimilarGamesQuery(appId: string) {
  return useQuery({
    queryKey: homeQueryKeys.similar(appId),
    queryFn: () => loadSimilarGames(appId),
    enabled: Boolean(appId),
    staleTime: similarStaleMs,
  });
}

/** Steam's own tag recommendations for the signed-in user; feeds the taste profile. */
export function useHomeRecommendedTagsQuery(steamId: string | undefined) {
  return useQuery({
    queryKey: homeQueryKeys.recommendedTags(steamId ?? ""),
    queryFn: () => loadSteamRecommendedTagsForUser(steamId ?? ""),
    enabled: Boolean(steamId),
    staleTime: similarStaleMs,
  });
}
