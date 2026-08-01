import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameDatabaseResult } from "../data";
import type { CatalogueFilters } from "../types";
import {
  catalogueChunkPageCount,
  catalogueChunkSize,
  emptyCatalogueFilters,
  emptyGameDatabase,
} from "../constants/catalogue";
import { hasSelectedCatalogueFilters } from "../utils/filters";
import { setHasLoadedCatalogueGlobally } from "../utils/gameCache";
import { useGamesQuery } from "../queries/games";

function normalizeCatalogueQuery(query: string) {
  return query.trim().toLowerCase();
}

export function useCatalogueState(debouncedQuery: string, enabled: boolean) {
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueFilters, setCatalogueFilters] =
    useState<CatalogueFilters>(emptyCatalogueFilters);
  const catalogueSort = "popular" as const;
  const [hasLoadedCatalogueOnce, setHasLoadedCatalogueOnce] = useState(false);
  const [lastCatalogueFacets, setLastCatalogueFacets] =
    useState<GameDatabaseResult["facets"]>();
  const normalizedQuery = normalizeCatalogueQuery(debouncedQuery);
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
      },
    };
  }, [catalogueFilters, effectiveCataloguePage, normalizedQuery]);

  const catalogueQuery = useGamesQuery(catalogueRequestMeta.request, {
    enabled,
  });

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
    Boolean(catalogueQuery.data) && !catalogueQuery.isPlaceholderData;
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

  const hasAnyCatalogueData = Boolean(catalogueQuery.data);
  const isCatalogueRefreshing = catalogueQuery.isFetching;
  // Só cobre a lista com skeleton quando não há absolutamente nada para
  // mostrar. Refetch com dado anterior na tela vira indicador sutil.
  const shouldShowCatalogueLoading = !hasAnyCatalogueData && !catalogueQuery.isError;

  const handleCatalogueFiltersChange = useCallback(
    (filters: CatalogueFilters) => {
      setCatalogueFilters(filters);
      setCataloguePage(1);
    },
    []
  );

  const handleCataloguePageChange = useCallback((page: number) => {
    setCataloguePage(page);
  }, []);

  const handleCatalogueRetry = useCallback(() => {
    void catalogueQuery.refetch();
  }, [catalogueQuery]);

  return {
    catalogueDatabase: catalogueQuery.data ?? emptyGameDatabase,
    catalogueFacets:
      facetsQuery.data?.facets ?? catalogueQuery.data?.facets ?? lastCatalogueFacets,
    isLoadingCatalogueFacets: facetsQuery.isFetching,
    isInitialCatalogueLoading: shouldShowCatalogueLoading && !hasLoadedCatalogueOnce,
    shouldShowCatalogueLoading,
    isCatalogueRefreshing,
    hasCatalogueError: catalogueQuery.isError && !hasAnyCatalogueData,
    onCatalogueRetry: handleCatalogueRetry,
    shouldPulseCatalogueLoading:
      (isCatalogueRefreshing || !hasAnyCatalogueData) &&
      hasSelectedCatalogueFilters(catalogueFilters),
    cataloguePage: effectiveCataloguePage,
    catalogueDisplayedPage: displayedPageRef.current,
    catalogueChunkOffset: displayedChunkOffsetRef.current,
    catalogueFilters,
    catalogueSort,
    handleCatalogueFiltersChange,
    handleCataloguePageChange,
  };
}
