import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { GameDatabaseRequest } from "../data";
import {
  loadGameStoreDetails,
  loadGamesOrThrow,
} from "../data";
import { emptyCatalogueFilters } from "../constants/catalogue";
import type { CatalogueFilterKey, CatalogueFilters } from "../types";

const catalogueFacetsCacheVersion = "catalogue-response-v3";

function normalizeFilterValues(
  filters: Partial<CatalogueFilters> | undefined,
  key: CatalogueFilterKey
) {
  return [...(filters?.[key] ?? emptyCatalogueFilters[key])].sort();
}

function normalizeFilters(filters?: Partial<CatalogueFilters>) {
  return {
    genres: normalizeFilterValues(filters, "genres"),
    tags: normalizeFilterValues(filters, "tags"),
    developers: normalizeFilterValues(filters, "developers"),
    publishers: normalizeFilterValues(filters, "publishers"),
    years: normalizeFilterValues(filters, "years"),
  };
}

export function normalizeGameRequest(
  request: GameDatabaseRequest = {}
): GameDatabaseRequest {
  return {
    query: request.query?.trim().toLowerCase() ?? "",
    limit: request.limit ?? 0,
    offset: request.offset ?? 0,
    sort: request.sort ?? "popular",
    includeFacets: request.includeFacets ?? false,
    facetsOnly: request.facetsOnly ?? false,
    seed: request.seed ?? 0,
    match: request.match ?? "all",
    filters: normalizeFilters(request.filters),
  };
}

export const gamesQueryKeys = {
  all: ["games"] as const,
  list: (request: GameDatabaseRequest) =>
    [
      "games",
      "list",
      catalogueFacetsCacheVersion,
      normalizeGameRequest(request),
    ] as const,
  details: (gameId: string) => ["games", "details", gameId] as const,
  storeDetails: (gameId: string) =>
    ["games", "store-details", gameId] as const,
  achievementDetails: (gameId: string) =>
    ["games", "achievement-details", gameId] as const,
  facets: () =>
    [
      "games",
      "list",
      catalogueFacetsCacheVersion,
      normalizeGameRequest({
        query: "",
        limit: 1,
        offset: 0,
        sort: "popular",
        includeFacets: true,
        facetsOnly: true,
        filters: emptyCatalogueFilters,
      }),
    ] as const,
};

type GamesQueryOptions = {
  enabled?: boolean;
  refreshKey?: number;
};

export function useGamesQuery(
  request: GameDatabaseRequest,
  options: GamesQueryOptions = {}
) {
  const normalizedRequest = normalizeGameRequest(request);
  const queryKey =
    options.refreshKey !== undefined
      ? ([...gamesQueryKeys.list(normalizedRequest), options.refreshKey] as const)
      : gamesQueryKeys.list(normalizedRequest);

  return useQuery({
    queryKey,
    queryFn: () => loadGamesOrThrow(normalizedRequest),
    enabled: options.enabled ?? true,
    // Mantém a página anterior visível enquanto o próximo chunk chega — sem
    // isso cada tecla do debounce troca a lista inteira por skeleton.
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useGameStoreDetailsQuery(
  gameId: string,
  options: GamesQueryOptions = {}
) {
  return useQuery({
    queryKey: gamesQueryKeys.storeDetails(gameId),
    queryFn: () => loadGameStoreDetails(gameId),
    enabled: Boolean(gameId) && (options.enabled ?? true),
  });
}
