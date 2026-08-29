import { useEffect, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import {
  homeStorefront,
  useHomeFeaturedQuery,
  useHomePoolQuery,
  useHomeRecommendedTagsQuery,
  useHomeTrendingQuery,
} from "../queries/home";
import { useEnrichedGameCards } from "./useEnrichedGameCards";
import { createSeedGame } from "../utils/gameSeed";
import { gameTraitAppId } from "../utils/gameTraits";
import { homeRotationSeed } from "../utils/homeRotation";
import {
  buildTasteProfile,
  steamRecommendedTagNames,
  type TasteProfile,
} from "../utils/tasteProfile";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";

type HomeShelfId =
  | "recommended"
  | "newReleases"
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
  recommended: 5,
  newReleases: 12,
  topSellers: 12,
  topRated: 15,
};

const exploreCandidateLimit = 120;

const fixedTopRatedAppIds = [
  "2050650",
  "1145360",
  "367520",
  "1222140",
  "203160",
  "1449690",
  "379720",
  "814380",
  "483980",
  "1575990",
  "424840",
  "2262610",
  "254700",
  "307690",
  "7670",
] as const;

const fixedRecommendedAppIds = [
  "2584270",
  "2163330",
  "2825860",
  "2713000",
  "4317690",
] as const;

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
function createShelfPicker(
  libraryGameAppIds: Set<string>,
  initialUsedAppIds: ReadonlySet<string> = new Set()
) {
  const usedAppIds = new Set<string>(initialUsedAppIds);

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

function createFixedTopRatedGames(): GhostBoxGame[] {
  return fixedTopRatedAppIds.map((appId, index) =>
    createSeedGame({ appId, title: `Steam App ${appId}` }, index, "")
  );
}

function createFixedRecommendedGames(): GhostBoxGame[] {
  return fixedRecommendedAppIds.map((appId, index) =>
    createSeedGame({ appId, title: `Steam App ${appId}` }, index, "")
  );
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

  // Stable identity while a query is still pending: `?? []` would hand the
  // memo below a fresh array on every render and defeat it entirely.
  const poolGames = poolQuery.data?.games ?? emptyGames;
  const trendingGames = trendingQuery.data?.games ?? emptyGames;

  const selection = useMemo(() => {
    const fixedTopRatedGames = createFixedTopRatedGames();
    const fixedRecommendedGames = createFixedRecommendedGames();
    const take = createShelfPicker(
      libraryGameAppIds,
      new Set([
        ...(fixedTopRatedAppIds as readonly string[]),
        ...(fixedRecommendedAppIds as readonly string[]),
      ])
    );

    const recommended = fixedRecommendedGames;

    // New releases lead; "coming soon" fills whatever is left so the rail is
    // never short on a quiet release week.
    const newReleases = take(
      [
        ...featuredToGames(featuredQuery.data?.newReleases),
        ...featuredToGames(featuredQuery.data?.comingSoon),
      ],
      shelfSizes.newReleases
    );

    const topSellers = take(
      featuredToGames(featuredQuery.data?.topSellers),
      shelfSizes.topSellers
    );

    const topRated = fixedTopRatedGames;

    const upcomingAppIds = new Set(
      (featuredQuery.data?.comingSoon ?? []).flatMap((entry) => {
        const appId = entry.appId?.trim();
        return appId ? [appId] : [];
      })
    );

    return {
      recommended,
      newReleases,
      topSellers,
      topRated,
      upcomingAppIds,
    };
  }, [featuredQuery.data, libraryGameAppIds]);

  // Featured rails arrive as bare seeds and catalogue rails lack the short
  // description, so every rail goes through the shared enrichment queue.
  // Conquistas ficam de fora (`includeAchievements = false`): nenhum card da
  // home exibe progresso e cada busca extra competiria pelo mesmo teto de 6
  // slots da fila, empurrando título/tags/descrição dos cards visíveis.
  const recommended = useEnrichedGameCards(
    selection.recommended,
    shelfSizes.recommended,
    true,
    false
  );
  const newReleases = useEnrichedGameCards(
    selection.newReleases,
    shelfSizes.newReleases,
    true,
    false
  );
  const topSellers = useEnrichedGameCards(
    selection.topSellers,
    shelfSizes.topSellers,
    true,
    false
  );
  const topRated = useEnrichedGameCards(
    selection.topRated,
    shelfSizes.topRated,
    true,
    false
  );

  const shelves: HomeShelves = useMemo(() => {
    const noUpcoming = new Set<string>();

    return {
      recommended: {
        id: "recommended",
        games: recommended,
        loading: false,
        upcomingAppIds: noUpcoming,
      },
      newReleases: {
        id: "newReleases",
        games: newReleases,
        loading: featuredQuery.isPending,
        upcomingAppIds: selection.upcomingAppIds,
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
        loading: false,
        upcomingAppIds: noUpcoming,
      },
    };
  }, [
    featuredQuery.isPending,
    newReleases,
    recommended,
    selection.upcomingAppIds,
    topRated,
    topSellers,
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
