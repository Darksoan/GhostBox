import { useCallback, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { Page } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { useDebouncedValue } from "./useDebouncedValue";
import { useExpandedGameSearch } from "./useExpandedGameSearch";
import { searchDebounceMs } from "../constants/catalogue";
import { useSettings } from "../context/settings";
import {
  mergeGameSearchResults,
  normalizeGameSearchText,
  searchKnownGames,
} from "../utils/gameSearch";

const steamAppIdPattern = /^\d{2,10}$/;

export function normalizeHeaderSearchText(value: string) {
  return normalizeGameSearchText(value);
}

export function mergeHeaderSearchSuggestions(
  localGames: GhostBoxGame[],
  remoteGames: GhostBoxGame[],
  query: string,
  limit = 8,
) {
  return mergeGameSearchResults(
    [searchKnownGames(localGames, query, limit), remoteGames],
    limit,
  );
}

export function useAppShellState(
  page: Page,
  options: {
    localGames?: GhostBoxGame[];
    allowHeaderSearchDropdown?: boolean;
    settingsLibraryView?: "overview" | "hidden-games";
  } = {},
) {
  const { appearance } = useSettings();
  const [query, setQuery] = useState("");
  const [activeSettingsTabId, setActiveSettingsTabId] =
    useState<SettingsTabId>("general");
  const [activeProfileCollectionId, setActiveProfileCollectionId] =
    useState<string>();
  // Estado próprio da biblioteca. O perfil e a biblioteca falam vocabulários
  // diferentes — o perfil entende "overview"/"achievements" e ids de
  // coleção, a biblioteca entende null/"favorites" e ids —, então dividir o
  // mesmo estado fazia um normalizar o valor do outro.
  const [activeLibraryCollectionId, setActiveLibraryCollectionId] = useState<
    string | null
  >(null);
  // A aba de coleção (page "favorites") também precisa do estado próprio: o
  // perfil normaliza qualquer id fora de "overview"/"achievements" e
  // das coleções do usuário, então "favorites" era zerado no mesmo tick e a
  // sidebar perdia o destaque.
  const [activeFavoritesCollectionId, setActiveFavoritesCollectionId] =
    useState<string>("favorites");

  const debouncedQuery = useDebouncedValue(query, searchDebounceMs);
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();
  const isCurrentDebouncedQuery = trimmedQuery === trimmedDebouncedQuery;
  // No catálogo a busca do header filtra a página e o dropdown fica
  // desligado. Com um overlay (ex: GameModal) aberto sobre o catálogo, a
  // busca precisa voltar a sugerir e exibir o dropdown. Na subaba de jogos
  // ocultos de Ajustes, a mesma query filtra só a lista local.
  const isHiddenProfileGamesSearch =
    page === "settings" &&
    activeSettingsTabId === "library" &&
    options.settingsLibraryView === "hidden-games" &&
    !options.allowHeaderSearchDropdown;
  const allowHeaderSearch =
    !isHiddenProfileGamesSearch &&
    (page !== "catalogue" || Boolean(options.allowHeaderSearchDropdown));

  const {
    catalogueQuery: headerSearchQuery,
    steamSearchQuery,
    shouldSearchSteam,
    expandedData,
    isExpansionPending,
  } = useExpandedGameSearch(
    { query: debouncedQuery, limit: 8, offset: 0 },
    Boolean(debouncedQuery.trim()) &&
      allowHeaderSearch &&
      isCurrentDebouncedQuery,
    8,
    appearance.language,
    { steamSupplement: true },
  );

  const isCatalogueSearchPending =
    page === "catalogue" &&
    Boolean(query.trim()) &&
    query.trim() !== debouncedQuery.trim();

  const baseHeaderSearchSuggestions = useMemo(() => {
    if (
      !trimmedDebouncedQuery ||
      !isCurrentDebouncedQuery ||
      headerSearchQuery.isError ||
      headerSearchQuery.isPlaceholderData
    ) {
      return [];
    }
    return (expandedData?.games ?? headerSearchQuery.data?.games ?? []).slice(0, 8);
  }, [
    expandedData?.games,
    headerSearchQuery.data?.games,
    headerSearchQuery.isError,
    headerSearchQuery.isPlaceholderData,
    isCurrentDebouncedQuery,
    trimmedDebouncedQuery,
  ]);

  // Busca local é síncrona e imediata: mostra a biblioteca mesmo quando o
  // catálogo remoto falha ou ainda não indexou o jogo (ex: FragPunk aberto
  // no modal mas ausente do /catalogue/search).
  const localHeaderSearchSuggestions = useMemo(() => {
    if (!allowHeaderSearch || !trimmedQuery) return [];
    return searchKnownGames(options.localGames ?? [], trimmedQuery, 8);
  }, [allowHeaderSearch, options.localGames, trimmedQuery]);

  const mergedBaseSuggestions = useMemo(() => {
    // Local já vem filtrado pela query imediata (sem debounce) para resposta
    // instantânea; remoto vem do debounce. Steam complementa em paralelo
    // mesmo quando o catálogo já tem resultados (família/DLC/soundtrack).
    // Dedupe por appId/id, local primeiro.
    const catalogueIds = new Set(
      baseHeaderSearchSuggestions.map((game) => game.appId ?? game.id),
    );
    const steamOnlyGames =
      shouldSearchSteam && isCurrentDebouncedQuery && !isExpansionPending
        ? (steamSearchQuery.data ?? []).filter(
            (game) => !catalogueIds.has(game.appId ?? game.id),
          )
        : [];
    return mergeGameSearchResults(
      [
        localHeaderSearchSuggestions,
        baseHeaderSearchSuggestions,
        steamOnlyGames,
      ],
      8,
    );
  }, [
    baseHeaderSearchSuggestions,
    isCurrentDebouncedQuery,
    isExpansionPending,
    localHeaderSearchSuggestions,
    shouldSearchSteam,
    steamSearchQuery.data,
  ]);

  const isSearchLoading =
    isCatalogueSearchPending ||
    (allowHeaderSearch &&
      localHeaderSearchSuggestions.length === 0 &&
      (headerSearchQuery.isFetching ||
        isExpansionPending));

  const steamSearchSettled =
    !shouldSearchSteam ||
    (!isExpansionPending &&
      (steamSearchQuery.isFetched || steamSearchQuery.isError));

  const hasNoHeaderSearchResults =
    allowHeaderSearch &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    steamSearchSettled &&
    mergedBaseSuggestions.length === 0;
  const shouldShowHeaderAppIdPrompt =
    allowHeaderSearch &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    steamSearchSettled &&
    mergedBaseSuggestions.length < 8;
  const appIdCandidate =
    shouldShowHeaderAppIdPrompt && steamAppIdPattern.test(trimmedQuery)
      ? trimmedQuery
      : null;
  const headerSearchSuggestions = allowHeaderSearch ? mergedBaseSuggestions : [];

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
    activeLibraryCollectionId,
    setActiveLibraryCollectionId,
    activeFavoritesCollectionId,
    setActiveFavoritesCollectionId,
    headerSearchSuggestions,
    hasNoHeaderSearchResults,
    shouldShowHeaderAppIdPrompt,
    appIdCandidate,
    isSearchLoading,
    isHiddenProfileGamesSearch,
    isMainPage,
  };
}
