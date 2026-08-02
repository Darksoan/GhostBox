import { useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import { emptyCatalogueFilters } from "../constants/catalogue";
import { useGamesQuery } from "../queries/games";
import { catalogueRotationSeed } from "../utils/rotation";
import { buildAffinityProfile, scoreAffinity, topAffinityTraits } from "../utils/affinity";

const CANDIDATE_LIMIT = 60;
const RESULT_LIMIT = 20;
const TOP_GENRE_COUNT = 4;

interface UseCatalogueRecommendationsOptions {
  libraryGames: GhostBoxGame[];
  favoriteGames: GhostBoxGame[];
  collectionGames?: GhostBoxGame[];
  enabled: boolean;
}

export function useCatalogueRecommendations({
  libraryGames,
  favoriteGames,
  collectionGames = [],
  enabled,
}: UseCatalogueRecommendationsOptions) {
  // Fixed for the component's lifetime, same reasoning as the catalogue's own
  // rotation seed: a value that changed per render would reshuffle candidates
  // on every keystroke elsewhere in the app.
  const [seed] = useState(() => catalogueRotationSeed());

  const profile = useMemo(
    () => buildAffinityProfile({ libraryGames, favoriteGames, collectionGames }),
    [libraryGames, favoriteGames, collectionGames]
  );

  const topGenres = useMemo(
    () => topAffinityTraits(profile.genres, TOP_GENRE_COUNT),
    [profile]
  );

  const excludedAppIds = useMemo(() => {
    const ids = new Set<string>();
    for (const game of libraryGames) if (game.appId) ids.add(game.appId);
    for (const game of favoriteGames) if (game.appId) ids.add(game.appId);
    return ids;
  }, [libraryGames, favoriteGames]);

  const hasCandidateFilter = topGenres.length > 0;

  const query = useGamesQuery(
    {
      limit: CANDIDATE_LIMIT,
      offset: 0,
      sort: "popular",
      seed,
      match: "any",
      filters: { ...emptyCatalogueFilters, genres: topGenres },
    },
    { enabled: enabled && hasCandidateFilter }
  );

  const recommendations = useMemo(() => {
    if (!hasCandidateFilter) return [];
    return (query.data?.games ?? [])
      .filter((game) => !excludedAppIds.has(game.appId))
      .map((game) => ({ game, score: scoreAffinity(profile, game) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, RESULT_LIMIT)
      .map((entry) => entry.game);
  }, [excludedAppIds, hasCandidateFilter, profile, query.data]);

  return {
    recommendations,
    // No genre affinity yet (new user, or a library with no genre data) —
    // the caller falls back to showing the rotated catalogue top instead.
    hasProfile: hasCandidateFilter,
    isLoading: hasCandidateFilter && query.isLoading,
  };
}
