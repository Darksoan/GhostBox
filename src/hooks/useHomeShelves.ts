import { useEffect, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import {
  homeStorefront,
  useHomeFeaturedQuery,
  useHomePoolQuery,
  useHomeRecommendedTagsQuery,
  useHomeSimilarGamesQuery,
  useHomeTrendingQuery,
} from "../queries/home";
import { useEnrichedGameCards } from "./useEnrichedGameCards";
import { createSeedGame } from "../utils/gameSeed";
import { gameCategoryScore, gameTraitAppId } from "../utils/gameTraits";
import { homeRotationSeed, pickRotationWindow } from "../utils/homeRotation";
import {
  buildTasteProfile,
  scoreGameAgainstTaste,
  steamRecommendedTagNames,
  type TasteProfile,
} from "../utils/tasteProfile";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";

export type HomeShelfId =
  | "recommended"
  | "trending"
  | "newReleases"
  | "becauseYouPlayed"
  | "topSellers"
  | "topRated";

export type HomeShelf = {
  id: HomeShelfId;
  games: GhostBoxGame[];
  loading: boolean;
  /** App ids inside `games` that have not released yet — they get an "Em breve" pill. */
  upcomingAppIds: Set<string>;
};

export type HomeShelves = Record<HomeShelfId, HomeShelf>;

// Card counts per rail. `recommended` matches the hero carousel group size the
// preloader already assumes; the wider rails hold roughly two screens so the
// Shelf arrows have something to scroll to.
const shelfSizes: Record<HomeShelfId, number> = {
  recommended: 8,
  trending: 12,
  newReleases: 12,
  becauseYouPlayed: 8,
  topSellers: 12,
  topRated: 8,
};

// Candidate depth each rotating rail draws its weekly window from. Bigger pool
// = more weeks before an arrangement repeats; too big and quality drops off.
const recommendedCandidateDepth = 48;
const topRatedCandidateDepth = 60;
const exploreCandidateLimit = 120;

const emptyGames: GhostBoxGame[] = [];

// The rotation boundary is weekly, so an hourly check crosses it promptly
// without ever being a meaningful cost.
const rotationSeedCheckMs = 60 * 60 * 1000;

type UseHomeShelvesInput = {
  language: "pt" | "en";
  libraryGameAppIds: Set<string>;
  libraryGames: GhostBoxGame[];
  favoriteGames: GhostBoxGame[];
  historyGames: GhostBoxGame[];
  steamId?: string;
};

function isDisplayableGame(game: GhostBoxGame) {
  return (
    Boolean(gameTraitAppId(game)) &&
    !isSteamTitlePlaceholder(game.title, game.appId)
  );
}

/**
 * Sequential de-duplication across rails: every shelf consumes from the same
 * pools, so without a shared ledger the same blockbuster lands in three rails
 * at once. Rails are filled in visual order, so the higher rail keeps the game.
 */
function createShelfPicker(libraryGameAppIds: Set<string>) {
  const usedAppIds = new Set<string>();

  return function take(candidates: GhostBoxGame[], count: number) {
    const picked: GhostBoxGame[] = [];

    for (const game of candidates) {
      if (picked.length >= count) break;
      const appId = gameTraitAppId(game);
      if (!appId || usedAppIds.has(appId) || libraryGameAppIds.has(appId)) continue;
      if (!isDisplayableGame(game)) continue;
      usedAppIds.add(appId);
      picked.push(game);
    }

    return picked;
  };
}

/** Steam's featured payload only carries {appId, name, headerImage}. */
function featuredToGames(
  featured: ReadonlyArray<{ appId: string; name: string }> | undefined
) {
  return (featured ?? []).flatMap((entry, index) => {
    const appId = entry.appId?.trim();
    if (!appId) return [];
    return [createSeedGame({ appId, title: entry.name || `Steam App ${appId}` }, index, "")];
  });
}

export function useHomeShelves({
  language,
  libraryGameAppIds,
  libraryGames,
  favoriteGames,
  historyGames,
  steamId,
}: UseHomeShelvesInput) {
  // One seed for the whole page: every rail rotates on the same Monday, and a
  // re-render inside the week can never reshuffle a rail under the user. It is
  // state rather than a memo because the app stays open for days — pinning it
  // at mount would keep serving last week's pool until a full reload.
  const [seed, setSeed] = useState(() => homeRotationSeed());

  useEffect(() => {
    const syncSeed = () =>
      setSeed((current) => {
        const next = homeRotationSeed();
        return next === current ? current : next;
      });

    const interval = window.setInterval(syncSeed, rotationSeedCheckMs);
    // A machine that slept through the boundary fires no interval tick, so the
    // window regaining focus is the second chance to notice the rollover.
    document.addEventListener("visibilitychange", syncSeed);
    window.addEventListener("focus", syncSeed);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", syncSeed);
      window.removeEventListener("focus", syncSeed);
    };
  }, []);
  const storefront = homeStorefront(language);

  const featuredQuery = useHomeFeaturedQuery(storefront);
  const trendingQuery = useHomeTrendingQuery();
  const poolQuery = useHomePoolQuery(seed);
  const recommendedTagsQuery = useHomeRecommendedTagsQuery(steamId);

  const tasteProfile: TasteProfile = useMemo(
    () =>
      buildTasteProfile({
        libraryGames,
        favoriteGames,
        historyGames,
        steamRecommendedTags: steamRecommendedTagNames(recommendedTagsQuery.data),
      }),
    [libraryGames, favoriteGames, historyGames, recommendedTagsQuery.data]
  );

  const seedGameAppId = tasteProfile.seedGame
    ? gameTraitAppId(tasteProfile.seedGame)
    : "";
  const similarQuery = useHomeSimilarGamesQuery(seedGameAppId);

  // Stable identity while a query is still pending: `?? []` would hand the
  // memo below a fresh array on every render and defeat it entirely.
  const poolGames = poolQuery.data?.games ?? emptyGames;
  const trendingGames = trendingQuery.data?.games ?? emptyGames;
  const similarGames = similarQuery.data ?? emptyGames;

  const selection = useMemo(() => {
    const take = createShelfPicker(libraryGameAppIds);

    const tasteRanked = [...poolGames].sort(
      (left, right) =>
        scoreGameAgainstTaste(right, tasteProfile) -
        scoreGameAgainstTaste(left, tasteProfile)
    );
    const qualityRanked = [...poolGames].sort(
      (left, right) => gameCategoryScore(right) - gameCategoryScore(left)
    );

    const recommended = take(
      pickRotationWindow(tasteRanked.slice(0, recommendedCandidateDepth), {
        seed,
        count: shelfSizes.recommended,
        salt: "recommended",
      }),
      shelfSizes.recommended
    );

    const trending = take(trendingGames, shelfSizes.trending);

    // New releases lead; "coming soon" fills whatever is left so the rail is
    // never short on a quiet release week.
    const newReleases = take(
      [
        ...featuredToGames(featuredQuery.data?.newReleases),
        ...featuredToGames(featuredQuery.data?.comingSoon),
      ],
      shelfSizes.newReleases
    );

    const becauseYouPlayed = seedGameAppId
      ? take(
          pickRotationWindow(similarGames, {
            seed,
            count: shelfSizes.becauseYouPlayed,
            salt: `similar:${seedGameAppId}`,
          }),
          shelfSizes.becauseYouPlayed
        )
      : [];

    const topSellers = take(
      featuredToGames(featuredQuery.data?.topSellers),
      shelfSizes.topSellers
    );

    const topRated = take(
      pickRotationWindow(qualityRanked.slice(0, topRatedCandidateDepth), {
        seed,
        count: shelfSizes.topRated,
        salt: "top-rated",
      }),
      shelfSizes.topRated
    );

    const upcomingAppIds = new Set(
      (featuredQuery.data?.comingSoon ?? []).flatMap((entry) => {
        const appId = entry.appId?.trim();
        return appId ? [appId] : [];
      })
    );

    return {
      recommended,
      trending,
      newReleases,
      becauseYouPlayed,
      topSellers,
      topRated,
      upcomingAppIds,
    };
  }, [
    featuredQuery.data,
    libraryGameAppIds,
    poolGames,
    seed,
    seedGameAppId,
    similarGames,
    tasteProfile,
    trendingGames,
  ]);

  // Featured rails arrive as bare seeds and catalogue rails lack the short
  // description, so every rail goes through the shared enrichment queue.
  const recommended = useEnrichedGameCards(selection.recommended, shelfSizes.recommended);
  const trending = useEnrichedGameCards(selection.trending, shelfSizes.trending);
  const newReleases = useEnrichedGameCards(selection.newReleases, shelfSizes.newReleases);
  const becauseYouPlayed = useEnrichedGameCards(
    selection.becauseYouPlayed,
    shelfSizes.becauseYouPlayed
  );
  const topSellers = useEnrichedGameCards(selection.topSellers, shelfSizes.topSellers);
  const topRated = useEnrichedGameCards(selection.topRated, shelfSizes.topRated);

  const shelves: HomeShelves = useMemo(() => {
    const noUpcoming = new Set<string>();

    return {
      recommended: {
        id: "recommended",
        games: recommended,
        loading: poolQuery.isPending,
        upcomingAppIds: noUpcoming,
      },
      trending: {
        id: "trending",
        games: trending,
        loading: trendingQuery.isPending,
        upcomingAppIds: noUpcoming,
      },
      newReleases: {
        id: "newReleases",
        games: newReleases,
        loading: featuredQuery.isPending,
        upcomingAppIds: selection.upcomingAppIds,
      },
      becauseYouPlayed: {
        id: "becauseYouPlayed",
        games: becauseYouPlayed,
        loading: Boolean(seedGameAppId) && similarQuery.isPending,
        upcomingAppIds: noUpcoming,
      },
      topSellers: {
        id: "topSellers",
        games: topSellers,
        loading: featuredQuery.isPending,
        upcomingAppIds: noUpcoming,
      },
      topRated: {
        id: "topRated",
        games: topRated,
        loading: poolQuery.isPending,
        upcomingAppIds: noUpcoming,
      },
    };
  }, [
    becauseYouPlayed,
    featuredQuery.isPending,
    newReleases,
    poolQuery.isPending,
    recommended,
    seedGameAppId,
    selection.upcomingAppIds,
    similarQuery.isPending,
    topRated,
    topSellers,
    trending,
    trendingQuery.isPending,
  ]);

  /**
   * Category rail source. Uses the whole catalogue pool rather than the picked
   * rails so the categories describe the catalogue, not the eight games that
   * happened to win this week's rotation.
   */
  const explorePool = useMemo(
    () => [...poolGames, ...trendingGames].slice(0, exploreCandidateLimit),
    [poolGames, trendingGames]
  );

  return { shelves, explorePool, tasteProfile, seed };
}
