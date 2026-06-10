import { useCallback, useMemo, useState } from "react";
import type { Page } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { useDebouncedValue } from "./useDebouncedValue";
import { useGamesQuery } from "../queries/games";
import { searchDebounceMs } from "../constants/catalogue";

export function useAppShellState(page: Page) {
  const [query, setQuery] = useState("");
  const [activeSettingsTabId, setActiveSettingsTabId] =
    useState<SettingsTabId>("general");
  const [activeProfileCollectionId, setActiveProfileCollectionId] =
    useState<string>();

  const debouncedQuery = useDebouncedValue(query, searchDebounceMs);

  const headerSearchQuery = useGamesQuery(
    { query: debouncedQuery, limit: 6, offset: 0 },
    { enabled: Boolean(debouncedQuery.trim()) && page !== "catalogue" }
  );

  const isSearchLoading =
    headerSearchQuery.isFetching && Boolean(debouncedQuery.trim());

  const headerSearchSuggestions = useMemo(
    () =>
      query.trim() && !isSearchLoading
        ? (headerSearchQuery.data?.games ?? []).slice(0, 6)
        : [],
    [headerSearchQuery.data?.games, isSearchLoading, query]
  );

  const handleQueryChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
  }, []);

  const clearQuery = useCallback(() => {
    setQuery("");
  }, []);

  const pageEnterKey =
    page === "favorites"
      ? `favorites-${activeProfileCollectionId ?? "default"}`
      : page;

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
    isSearchLoading,
    pageEnterKey,
    isMainPage,
  };
}
