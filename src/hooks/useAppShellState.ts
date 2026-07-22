import { useCallback, useMemo, useState } from "react";
import type { Page } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { useDebouncedValue } from "./useDebouncedValue";
import { useGameStoreDetailsQuery, useGamesQuery } from "../queries/games";
import { searchDebounceMs } from "../constants/catalogue";

const steamAppIdPattern = /^\d{2,10}$/;

export function useAppShellState(page: Page) {
  const [query, setQuery] = useState("");
  const [activeSettingsTabId, setActiveSettingsTabId] =
    useState<SettingsTabId>("general");
  const [activeProfileCollectionId, setActiveProfileCollectionId] =
    useState<string>();

  const debouncedQuery = useDebouncedValue(query, searchDebounceMs);
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();

  const headerSearchQuery = useGamesQuery(
    { query: debouncedQuery, limit: 6, offset: 0 },
    { enabled: Boolean(debouncedQuery.trim()) && page !== "catalogue" }
  );

  const isCatalogueSearchPending =
    page === "catalogue" &&
    Boolean(query.trim()) &&
    query.trim() !== debouncedQuery.trim();

  const isSearchLoading =
    isCatalogueSearchPending ||
    (headerSearchQuery.isFetching && Boolean(debouncedQuery.trim()));

  const baseHeaderSearchSuggestions = useMemo(
    () =>
      query.trim() && !isSearchLoading
        ? (headerSearchQuery.data?.games ?? []).slice(0, 6)
        : [],
    [headerSearchQuery.data?.games, isSearchLoading, query]
  );

  const hasNoHeaderSearchResults =
    page !== "catalogue" &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    baseHeaderSearchSuggestions.length === 0;
  const shouldShowHeaderAppIdPrompt =
    page !== "catalogue" &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    baseHeaderSearchSuggestions.length < 6;
  const appIdCandidate =
    shouldShowHeaderAppIdPrompt && steamAppIdPattern.test(trimmedQuery)
      ? trimmedQuery
      : null;
  const appIdLookupQuery = useGameStoreDetailsQuery(appIdCandidate ?? "", {
    enabled: Boolean(appIdCandidate),
  });

  const headerSearchSuggestions = useMemo(() => {
    const suggestions = [...baseHeaderSearchSuggestions];
    const appIdGame = appIdLookupQuery.data;
    if (appIdGame && !suggestions.some((game) => game.appId === appIdGame.appId)) {
      suggestions.push(appIdGame);
    }
    return suggestions.slice(0, 6);
  }, [appIdLookupQuery.data, baseHeaderSearchSuggestions]);

  const handleQueryChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
  }, []);

  const clearQuery = useCallback(() => {
    setQuery("");
  }, []);

  const isMainPage =
    page === "home" ||
    page === "catalogue" ||
    page === "favorites" ||
    page === "library";

  return {
    query,
    debouncedQuery,
    setQuery,
    handleQueryChange,
    clearQuery,
    activeSettingsTabId,
    setActiveSettingsTabId,
    activeProfileCollectionId,
    setActiveProfileCollectionId,
    headerSearchSuggestions,
    hasNoHeaderSearchResults,
    shouldShowHeaderAppIdPrompt,
    appIdCandidate,
    isSearchLoading,
    isMainPage,
  };
}
