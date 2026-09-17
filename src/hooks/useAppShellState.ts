import { useCallback, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { Page } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { useDebouncedValue } from "./useDebouncedValue";
import { useGamesQuery, useSteamStoreSearchQuery } from "../queries/games";
import { searchDebounceMs } from "../constants/catalogue";
import { useSettings } from "../context/settings";
import {
  mergeGameSearchResults,
  normalizeGameSearchText,
  searchKnownGames,
  shouldUseSteamSearchFallback,
} from "../utils/gameSearch";

const steamAppIdPattern = /^\d{2,10}$/;

export function normalizeHeaderSearchText(value: string) {
  return normalizeGameSearchText(value);
}

export function mergeHeaderSearchSuggestions(
  localGames: GhostBoxGame[],
  remoteGames: GhostBoxGame[],
  query: string,
  limit = 6,
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
  // No catálogo a busca do header filtra a página e o dropdown fica
  // desligado. Com um overlay (ex: GameModal) aberto sobre o catálogo, a
  // busca precisa voltar a sugerir e exibir o dropdown.
  const allowHeaderSearch =
    page !== "catalogue" || Boolean(options.allowHeaderSearchDropdown);

  const headerSearchQuery = useGamesQuery(
    { query: debouncedQuery, limit: 6, offset: 0 },
    { enabled: Boolean(debouncedQuery.trim()) && allowHeaderSearch }
  );

  const isCatalogueSearchPending =
    page === "catalogue" &&
    Boolean(query.trim()) &&
    query.trim() !== debouncedQuery.trim();

  const isCurrentDebouncedQuery = trimmedQuery === trimmedDebouncedQuery;
  const baseHeaderSearchSuggestions = useMemo(() => {
    if (
      !trimmedDebouncedQuery ||
      !isCurrentDebouncedQuery ||
      headerSearchQuery.isError ||
      headerSearchQuery.isPlaceholderData
    ) {
      return [];
    }
    return (headerSearchQuery.data?.games ?? []).slice(0, 6);
  }, [
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
    return searchKnownGames(options.localGames ?? [], trimmedQuery, 6);
  }, [allowHeaderSearch, options.localGames, trimmedQuery]);

  const shouldSearchSteam =
    allowHeaderSearch &&
    isCurrentDebouncedQuery &&
    shouldUseSteamSearchFallback({
      query: trimmedDebouncedQuery,
      localResultCount: localHeaderSearchSuggestions.length,
      remoteResultCount: baseHeaderSearchSuggestions.length,
      remoteSettled:
        headerSearchQuery.isFetched && !headerSearchQuery.isFetching,
      remoteFailed: headerSearchQuery.isError,
    });
  const steamSearchQuery = useSteamStoreSearchQuery(
    trimmedDebouncedQuery,
    6,
    appearance.language,
    { enabled: shouldSearchSteam },
  );

  const mergedBaseSuggestions = useMemo(() => {
    // Local já vem filtrado pela query imediata (sem debounce) para resposta
    // instantânea; remoto vem do debounce. Dedupe por appId/id, local primeiro.
    return mergeGameSearchResults(
      [
        localHeaderSearchSuggestions,
        baseHeaderSearchSuggestions,
        shouldSearchSteam ? (steamSearchQuery.data ?? []) : [],
      ],
      6,
    );
  }, [
    baseHeaderSearchSuggestions,
    localHeaderSearchSuggestions,
    shouldSearchSteam,
    steamSearchQuery.data,
  ]);

  const isSearchLoading =
    isCatalogueSearchPending ||
    (allowHeaderSearch &&
      localHeaderSearchSuggestions.length === 0 &&
      (headerSearchQuery.isFetching ||
        (shouldSearchSteam && steamSearchQuery.isFetching)));

  const steamSearchSettled =
    !shouldSearchSteam || steamSearchQuery.isFetched || steamSearchQuery.isError;

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
    mergedBaseSuggestions.length < 6;
  const appIdCandidate =
    shouldShowHeaderAppIdPrompt && steamAppIdPattern.test(trimmedQuery)
      ? trimmedQuery
      : null;
  const headerSearchSuggestions = mergedBaseSuggestions;

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
    isMainPage,
  };
}
