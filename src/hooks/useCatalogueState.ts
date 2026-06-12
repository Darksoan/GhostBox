import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameDatabaseResult } from "../data";
import type { CatalogueFilters, CatalogueSort } from "../types";
import {
  catalogueChunkPageCount,
  catalogueChunkSize,
  emptyCatalogueFilters,
} from "../constants/catalogue";
import { hasSelectedCatalogueFilters } from "../utils/filters";
import {
  getCatalogueFiltersCacheKey,
  getGamesCacheKey,
  setHasLoadedCatalogueGlobally,
} from "../utils/gameCache";
import { useGamesQuery } from "../queries/games";

export function useCatalogueState(debouncedQuery: string, enabled: boolean) {
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueChunkOffset, setCatalogueChunkOffset] = useState(0);
  const [catalogueFilters, setCatalogueFilters] =
    useState<CatalogueFilters>(emptyCatalogueFilters);
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("popular");
  const [hasLoadedCatalogueOnce, setHasLoadedCatalogueOnce] = useState(false);
  const [lastCatalogueFacets, setLastCatalogueFacets] =
    useState<GameDatabaseResult["facets"]>();

  const catalogueFiltersCacheKey = getCatalogueFiltersCacheKey(catalogueFilters);

  const catalogueRequestMeta = useMemo(() => {
    const requestedChunkOffset =
      Math.floor((cataloguePage - 1) / catalogueChunkPageCount) *
      catalogueChunkSize;
    const requestedLimit = catalogueChunkSize;

    return {
      requestedChunkOffset,
      requestedLimit,
      request: {
        query: debouncedQuery,
        limit: requestedLimit,
        offset: requestedChunkOffset,
        filters: catalogueFilters,
        sort: catalogueSort,
        includeFacets: true,
      },
    };
  }, [
    catalogueFilters,
    cataloguePage,
    catalogueSort,
    debouncedQuery,
  ]);

  const catalogueQuery = useGamesQuery(catalogueRequestMeta.request, {
    enabled,
  });

  const shouldLoadCatalogueFacetsFallback =
    enabled && Boolean(catalogueQuery.data) && !catalogueQuery.data?.facets;

  const facetsQuery = useGamesQuery(
    {
      query: debouncedQuery,
      limit: 1,
      offset: 0,
      filters: catalogueFilters,
      sort: catalogueSort,
      includeFacets: true,
      facetsOnly: true,
    },
    { enabled: shouldLoadCatalogueFacetsFallback }
  );

  useEffect(() => {
    if (catalogueQuery.data && enabled) {
      setHasLoadedCatalogueOnce(true);
      setHasLoadedCatalogueGlobally(true);
      setCatalogueChunkOffset(catalogueRequestMeta.requestedChunkOffset);
    }
  }, [
    catalogueQuery.data,
    catalogueRequestMeta.requestedChunkOffset,
    enabled,
  ]);

  useEffect(() => {
    const facets = facetsQuery.data?.facets ?? catalogueQuery.data?.facets;
    if (facets && enabled) {
      setLastCatalogueFacets(facets);
    }
  }, [catalogueQuery.data?.facets, enabled, facetsQuery.data?.facets]);

  const requestedCatalogueCacheKey = getGamesCacheKey(
    debouncedQuery,
    catalogueRequestMeta.requestedLimit,
    catalogueRequestMeta.requestedChunkOffset,
    catalogueFilters,
    catalogueSort
  );

  const hasRequestedCatalogueData = Boolean(catalogueQuery.data);
  const isPageChunkLoading =
    catalogueQuery.isFetching &&
    catalogueChunkOffset !== catalogueRequestMeta.requestedChunkOffset;
  const shouldShowCatalogueLoading =
    !hasRequestedCatalogueData ||
    isPageChunkLoading ||
    !hasLoadedCatalogueOnce;

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

  return {
    catalogueDatabase: catalogueQuery.data ?? {
      games: [],
      total: 0,
      matched: 0,
      limited: false,
      source: "stub",
    },
    catalogueFacets:
      facetsQuery.data?.facets ?? catalogueQuery.data?.facets ?? lastCatalogueFacets,
    isLoadingCatalogueFacets: facetsQuery.isFetching,
    isInitialCatalogueLoading: shouldShowCatalogueLoading && !hasLoadedCatalogueOnce,
    shouldShowCatalogueLoading,
    shouldPulseCatalogueLoading:
      (isPageChunkLoading || !hasRequestedCatalogueData) &&
      hasSelectedCatalogueFilters(catalogueFilters),
    cataloguePage,
    catalogueChunkOffset,
    catalogueFilters,
    catalogueSort,
    catalogueFiltersCacheKey,
    requestedCatalogueCacheKey,
    handleCatalogueFiltersChange,
    handleCatalogueSortChange,
    handleCataloguePageChange,
  };
}
