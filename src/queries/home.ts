import { useQuery } from "@tanstack/react-query";
import {
  loadFeatured,
  loadGames,
  loadSteamRecommendedTagsForUser,
} from "../data";

/** Steam storefront region derived from the UI language. */
type HomeStorefront = "br" | "us";

export function homeStorefront(language: "pt" | "en"): HomeStorefront {
  return language === "en" ? "us" : "br";
}

// Matches the worker TTLs so the client does not out-poll its own cache:
// /steam/featured keeps 6h in KV, sort=playingNow keeps 5min.
const featuredStaleMs = 6 * 60 * 60 * 1000;
const trendingStaleMs = 5 * 60 * 1000;
const similarStaleMs = 24 * 60 * 60 * 1000;

const homeTrendingPoolLimit = 40;
const homePoolLimit = 200;

const homeQueryKeys = {
  all: ["home"] as const,
  featured: (cc: HomeStorefront) => ["home", "featured", cc] as const,
  trending: () => ["home", "trending"] as const,
  pool: (seed: number) => ["home", "pool", seed] as const,
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

/** Steam's own tag recommendations for the signed-in user; feeds the taste profile. */
export function useHomeRecommendedTagsQuery(steamId: string | undefined) {
  return useQuery({
    queryKey: homeQueryKeys.recommendedTags(steamId ?? ""),
    queryFn: () => loadSteamRecommendedTagsForUser(steamId ?? ""),
    enabled: Boolean(steamId),
    staleTime: similarStaleMs,
  });
}
