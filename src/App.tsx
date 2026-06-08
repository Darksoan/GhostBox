import { useMemo, useState } from "react";
import type { PirateGame } from "./data";
import type { CatalogueFilters, CatalogueSort } from "./types";
import {
  cataloguePageSize,
  emptyCatalogueFilters,
  searchDebounceMs,
} from "./constants/catalogue";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useGamesQuery } from "./queries/games";
import { CataloguePage } from "./pages/CataloguePage";
import "./app.scss";

function noopGame(_game: PirateGame) {
  return undefined;
}

function App() {
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueFilters, setCatalogueFilters] =
    useState<CatalogueFilters>(emptyCatalogueFilters);
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("popular");
  const debouncedQuery = useDebouncedValue("", searchDebounceMs);

  const catalogueRequest = useMemo(
    () => ({
      query: debouncedQuery,
      limit: cataloguePageSize,
      offset: (cataloguePage - 1) * cataloguePageSize,
      filters: catalogueFilters,
      sort: catalogueSort,
    }),
    [cataloguePage, debouncedQuery, catalogueFilters, catalogueSort]
  );

  const catalogueQuery = useGamesQuery(catalogueRequest);
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
    { enabled: catalogueQuery.isSuccess && !catalogueQuery.isFetching }
  );

  const emptySet = useMemo(() => new Set<string>(), []);
  const database = catalogueQuery.data;
  const facets = facetsQuery.data?.facets ?? database?.facets;
  const loading =
    catalogueQuery.isLoading ||
    (catalogueQuery.isFetching && !catalogueQuery.data);
  const filtersLoading = facetsQuery.isLoading || facetsQuery.isFetching;

  return (
    <div className="app-shell">
      <main className="content">
        <CataloguePage
          games={database?.games ?? []}
          facets={facets}
          filtersLoading={filtersLoading && !facets}
          loading={loading}
          query={debouncedQuery}
          page={cataloguePage}
          chunkOffset={0}
          matched={database?.matched ?? 0}
          filters={catalogueFilters}
          sort={catalogueSort}
          animateFilterPlaceholders={false}
          onFiltersChange={setCatalogueFilters}
          onSortChange={setCatalogueSort}
          onPageChange={setCataloguePage}
          onOpenGame={noopGame}
          favoriteGameIds={emptySet}
          addedGameAppIds={emptySet}
          libraryGameAppIds={emptySet}
          playableGameAppIds={emptySet}
          addingGameId={null}
          launchingGameId={null}
          removingGameId={null}
          onToggleFavorite={noopGame}
          onAddGame={noopGame}
          onPlayGame={noopGame}
          onRemoveGame={noopGame}
          userCollections={[]}
          onAddGameToCollection={noopGame}
          onRemoveGameFromCollection={noopGame}
          pulseLoading={false}
        />
      </main>
    </div>
  );
}

export default App;
