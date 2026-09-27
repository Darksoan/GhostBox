import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameDatabaseResult, GhostBoxGame } from "../data";
import type { CatalogueFilters, CatalogueSort } from "../types";
import {
  catalogueChunkPageCount,
  catalogueChunkSize,
  emptyCatalogueFilters,
  emptyGameDatabase,
} from "../constants/catalogue";
import { hasSelectedCatalogueFilters } from "../utils/filters";
import { setHasLoadedCatalogueGlobally } from "../utils/gameCache";
import { catalogueRotationSeed } from "../utils/rotation";
import { filterOutSteamDemos } from "../utils/steamAppType";
import { useGamesQuery } from "../queries/games";
import { useExpandedGameSearch } from "./useExpandedGameSearch";
import { useSettings } from "../context/settings";
import {
  mergeGameSearchResults,
  normalizeGameSearchText,
  searchKnownGames,
} from "../utils/gameSearch";

function normalizeCatalogueQuery(query: string) {
  return normalizeGameSearchText(query);
}

export function useCatalogueState(
  debouncedQuery: string,
  enabled: boolean,
  knownGames: readonly GhostBoxGame[] = [],
  currentQuery = debouncedQuery,
) {
  const { appearance } = useSettings();
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueFilters, setCatalogueFilters] =
    useState<CatalogueFilters>(emptyCatalogueFilters);
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("popular");
  // Fixed for the lifetime of the hook. Recomputing per render would reshuffle
  // the pool mid-navigation and make pages repeat or skip games.
  const [catalogueRotationSeedValue] = useState(() => catalogueRotationSeed());
  const [hasLoadedCatalogueOnce, setHasLoadedCatalogueOnce] = useState(false);
  const [lastCatalogueFacets, setLastCatalogueFacets] =
    useState<GameDatabaseResult["facets"]>();
  const normalizedQuery = normalizeCatalogueQuery(debouncedQuery);
  const isCurrentQuery =
    normalizeCatalogueQuery(currentQuery) === normalizedQuery;
  const previousNormalizedQueryRef = useRef(normalizedQuery);
  const isQueryResetPending = previousNormalizedQueryRef.current !== normalizedQuery;
  const effectiveCataloguePage = isQueryResetPending ? 1 : cataloguePage;

  const catalogueRequestMeta = useMemo(() => {
    const requestedChunkOffset =
      Math.floor((effectiveCataloguePage - 1) / catalogueChunkPageCount) *
      catalogueChunkSize;
    const requestedLimit = catalogueChunkSize;

    return {
      requestedChunkOffset,
      requestedLimit,
      request: {
        query: normalizedQuery,
        limit: requestedLimit,
        offset: requestedChunkOffset,
        filters: catalogueFilters,
        sort: catalogueSort,
        includeFacets: false,
        seed: catalogueRotationSeedValue,
      },
    };
  }, [
    catalogueFilters,
    catalogueRotationSeedValue,
    catalogueSort,
    effectiveCataloguePage,
    normalizedQuery,
  ]);

  const {
    catalogueQuery,
    expandedCatalogueQuery,
    steamSearchQuery,
    shouldSearchSteam,
    expandedData,
    isExpansionPending,
  } = useExpandedGameSearch(
    catalogueRequestMeta.request,
    enabled,
    20,
    appearance.language,
  );

  const hasActiveFilters = hasSelectedCatalogueFilters(catalogueFilters);
  const canUseSearchFallback =
    enabled && Boolean(normalizedQuery) && !hasActiveFilters;
  const localFallbackGames = useMemo(
    () =>
      canUseSearchFallback
        ? searchKnownGames(knownGames, normalizedQuery, 20)
        : [],
    [canUseSearchFallback, knownGames, normalizedQuery],
  );
  const activeCatalogueData =
    !isCurrentQuery
      ? undefined
      : expandedData ??
        (!catalogueQuery.isPlaceholderData ? catalogueQuery.data : undefined);
  const primaryIsEmpty =
    catalogueQuery.isError ||
    (catalogueQuery.isFetched &&
      !catalogueQuery.isFetching &&
      !catalogueQuery.isPlaceholderData &&
      (catalogueQuery.data?.games.length ?? 0) === 0);
  const isFallbackMode =
    canUseSearchFallback &&
    isCurrentQuery &&
    primaryIsEmpty &&
    !isExpansionPending &&
    !expandedData?.games.length;
  const fallbackGames = useMemo(
    () =>
      mergeGameSearchResults(
        [
          localFallbackGames,
          shouldSearchSteam && !isExpansionPending
            ? (steamSearchQuery.data ?? [])
            : [],
        ],
        20,
      ),
    [isExpansionPending, localFallbackGames, shouldSearchSteam, steamSearchQuery.data],
  );
  const resolvedCatalogueDatabase = useMemo<GameDatabaseResult>(() => {
    if (!isFallbackMode) {
      const data = activeCatalogueData ?? emptyGameDatabase;
      // Once the complete catalogue result fits in this chunk, append only
      // Steam games whose AppID is absent there. Catalogue records keep their
      // screenshots and metadata even if Steam returned the same title.
      const canAppendSteamOnly =
        Boolean(expandedData) &&
        canUseSearchFallback &&
        catalogueRequestMeta.requestedChunkOffset === 0 &&
        data.matched === data.games.length;
      const catalogueIds = new Set(data.games.map((game) => game.appId ?? game.id));
      const steamOnlyGames = canAppendSteamOnly
        ? (steamSearchQuery.data ?? []).filter(
            (game) => !catalogueIds.has(game.appId ?? game.id),
          )
        : [];
      const appendSteamOnly =
        steamOnlyGames.length > 0 &&
        data.games.length + steamOnlyGames.length <= catalogueRequestMeta.requestedLimit;
      const combinedGames = appendSteamOnly
          ? mergeGameSearchResults(
              [data.games, steamOnlyGames],
              catalogueRequestMeta.requestedLimit,
            )
          : data.games;
      const games = filterOutSteamDemos(combinedGames);
      if (games === data.games) return data;
      return {
        ...data,
        games,
        matched: appendSteamOnly ? games.length : Math.min(data.matched, games.length),
      };
    }
    const games = filterOutSteamDemos(fallbackGames);
    return {
      games,
      total: games.length,
      matched: games.length,
      limited: false,
      source: localFallbackGames.length > 0 ? "local" : "steam-store",
    };
  }, [
    activeCatalogueData,
    canUseSearchFallback,
    catalogueRequestMeta.requestedChunkOffset,
    catalogueRequestMeta.requestedLimit,
    expandedData,
    fallbackGames,
    isFallbackMode,
    localFallbackGames.length,
    steamSearchQuery.data,
  ]);

  const facetsQuery = useGamesQuery(
    {
      query: "",
      limit: 1,
      offset: 0,
      filters: emptyCatalogueFilters,
      sort: "popular",
      includeFacets: true,
      facetsOnly: true,
    },
    { enabled }
  );

  // `keepPreviousData` mantém o chunk anterior visível enquanto o próximo
  // carrega. O slice da página precisa então acompanhar o chunk que está *na
  // tela*, não o que foi pedido — senão a página nova fatia o array velho no
  // offset errado e pinta um "nenhum resultado" de um frame.
  const displayedChunkOffsetRef = useRef(0);
  const displayedPageRef = useRef(1);
  const hasFreshCatalogueData =
    Boolean(activeCatalogueData) &&
    (Boolean(expandedData) || !catalogueQuery.isPlaceholderData);
  if (hasFreshCatalogueData) {
    displayedChunkOffsetRef.current = catalogueRequestMeta.requestedChunkOffset;
    displayedPageRef.current = effectiveCataloguePage;
  }

  useEffect(() => {
    previousNormalizedQueryRef.current = normalizedQuery;
    setCataloguePage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (hasFreshCatalogueData && enabled) {
      setHasLoadedCatalogueOnce(true);
      setHasLoadedCatalogueGlobally(true);
    }
  }, [enabled, hasFreshCatalogueData]);

  useEffect(() => {
    const facets = facetsQuery.data?.facets ?? catalogueQuery.data?.facets;
    if (facets && enabled) {
      setLastCatalogueFacets(facets);
    }
  }, [catalogueQuery.data?.facets, enabled, facetsQuery.data?.facets]);

  const hasAnyCatalogueData =
    Boolean(activeCatalogueData) ||
    (isFallbackMode && fallbackGames.length > 0);
  const isCatalogueRefreshing =
    !isCurrentQuery || catalogueQuery.isFetching || isExpansionPending;
  // Só cobre a lista com skeleton quando não há absolutamente nada para
  // mostrar. Refetch com dado anterior na tela vira indicador sutil.
  const shouldShowCatalogueLoading =
    !isCurrentQuery ||
    (!hasAnyCatalogueData && !catalogueQuery.isError) ||
    isExpansionPending;

  const handleCatalogueFiltersChange = useCallback(
    (filters: CatalogueFilters) => {
      setCatalogueFilters(filters);
      setCataloguePage(1);
    },
    []
  );

  const handleCatalogueSortChange = useCallback((sort: CatalogueSort) => {
    setCatalogueSort(sort);
    setCataloguePage(1);
  }, []);

  const handleCataloguePageChange = useCallback((page: number) => {
    setCataloguePage(page);
  }, []);

  const handleCatalogueRetry = useCallback(() => {
    void Promise.all([
      catalogueQuery.refetch(),
      expandedCatalogueQuery.isError ? expandedCatalogueQuery.refetch() : Promise.resolve(),
      facetsQuery.refetch(),
    ]);
  }, [catalogueQuery, expandedCatalogueQuery, facetsQuery]);

  return {
    catalogueDatabase: resolvedCatalogueDatabase,
    catalogueFacets:
      facetsQuery.data?.facets ?? catalogueQuery.data?.facets ?? lastCatalogueFacets,
    isLoadingCatalogueFacets: facetsQuery.isFetching,
    isInitialCatalogueLoading: shouldShowCatalogueLoading && !hasLoadedCatalogueOnce,
    shouldShowCatalogueLoading,
    isCatalogueRefreshing,
    hasCatalogueError:
      isCurrentQuery &&
      catalogueQuery.isError &&
      fallbackGames.length === 0 &&
      (!shouldSearchSteam || steamSearchQuery.isError),
    hasCatalogueRefreshError:
      isCurrentQuery && catalogueQuery.isRefetchError && !isFallbackMode,
    hasCatalogueFacetsError: facetsQuery.isError && !facetsQuery.data && !lastCatalogueFacets,
    onCatalogueRetry: handleCatalogueRetry,
    shouldPulseCatalogueLoading:
      (isCatalogueRefreshing || !hasAnyCatalogueData) &&
      hasSelectedCatalogueFilters(catalogueFilters),
    cataloguePage: isFallbackMode ? 1 : effectiveCataloguePage,
    catalogueDisplayedPage: isFallbackMode ? 1 : displayedPageRef.current,
    catalogueChunkOffset: isFallbackMode ? 0 : displayedChunkOffsetRef.current,
    catalogueFilters,
    catalogueSort,
    handleCatalogueFiltersChange,
    handleCatalogueSortChange,
    handleCataloguePageChange,
  };
}
