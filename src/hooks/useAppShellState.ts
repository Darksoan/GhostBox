import { useCallback, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import type { Page } from "../types";
import type { SettingsTabId } from "../features/settings/settingsTabsShared";
import { useDebouncedValue } from "./useDebouncedValue";
import { useGameStoreDetailsQuery, useGamesQuery } from "../queries/games";
import { searchDebounceMs } from "../constants/catalogue";

const steamAppIdPattern = /^\d{2,10}$/;

export function normalizeHeaderSearchText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function gameMatchesHeaderQuery(game: GhostBoxGame, normalizedQuery: string) {
  if (!normalizedQuery) return false;
  const title = normalizeHeaderSearchText(game.title ?? "");
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const compactTitle = title.replace(/\s+/g, "");
    const allInTitle = tokens.every(
      (token) => title.includes(token) || compactTitle.includes(token.replace(/\s+/g, "")),
    );
    if (allInTitle) return true;
  } else if (title.includes(normalizedQuery)) {
    return true;
  }
  const digits = normalizedQuery.replace(/\D/g, "");
  if (digits) {
    const appId = game.appId?.trim() ?? "";
    if (appId && appId.includes(digits)) return true;
    const id = game.id?.trim().toLowerCase() ?? "";
    if (id && id.includes(digits)) return true;
  }
  const id = game.id?.trim().toLowerCase() ?? "";
  if (id && id.includes(normalizedQuery)) return true;
  return false;
}

export function mergeHeaderSearchSuggestions(
  localGames: GhostBoxGame[],
  remoteGames: GhostBoxGame[],
  query: string,
  limit = 6,
) {
  const normalizedQuery = normalizeHeaderSearchText(query);
  if (!normalizedQuery) return [];
  const seen = new Set<string>();
  const merged: GhostBoxGame[] = [];
  const push = (game: GhostBoxGame) => {
    const key = game.appId?.trim() || game.id?.trim() || game.title?.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (merged.length < limit) merged.push(game);
  };
  for (const game of localGames) {
    if (gameMatchesHeaderQuery(game, normalizedQuery)) push(game);
    if (merged.length >= limit) break;
  }
  for (const game of remoteGames) {
    push(game);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function useAppShellState(
  page: Page,
  options: { localGames?: GhostBoxGame[] } = {},
) {
  const [query, setQuery] = useState("");
  const [activeSettingsTabId, setActiveSettingsTabId] =
    useState<SettingsTabId>("general");
  const [activeProfileCollectionId, setActiveProfileCollectionId] =
    useState<string>();
  // Estado próprio da biblioteca. O perfil e a biblioteca falam vocabulários
  // diferentes — o perfil entende "overview"/"library"/"achievements" e ids de
  // coleção, a biblioteca entende null/"favorites" e ids —, então dividir o
  // mesmo estado fazia um normalizar o valor do outro.
  const [activeLibraryCollectionId, setActiveLibraryCollectionId] = useState<
    string | null
  >(null);
  // A aba de coleção (page "favorites") também precisa do estado próprio: o
  // perfil normaliza qualquer id fora de "overview"/"library"/"achievements" e
  // das coleções do usuário, então "favorites" era zerado no mesmo tick e a
  // sidebar perdia o destaque.
  const [activeFavoritesCollectionId, setActiveFavoritesCollectionId] =
    useState<string>("favorites");

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
      trimmedDebouncedQuery && !isSearchLoading
        ? (headerSearchQuery.data?.games ?? []).slice(0, 6)
        : [],
    [headerSearchQuery.data?.games, isSearchLoading, trimmedDebouncedQuery]
  );

  // Busca local é síncrona e imediata: mostra a biblioteca mesmo quando o
  // catálogo remoto falha ou ainda não indexou o jogo (ex: FragPunk aberto
  // no modal mas ausente do /catalogue/search).
  const localHeaderSearchSuggestions = useMemo(() => {
    if (page === "catalogue" || !trimmedQuery) return [];
    const normalized = normalizeHeaderSearchText(trimmedQuery);
    if (!normalized) return [];
    const localGames = options.localGames ?? [];
    const matched: GhostBoxGame[] = [];
    const seen = new Set<string>();
    for (const game of localGames) {
      if (!gameMatchesHeaderQuery(game, normalized)) continue;
      const key = game.appId?.trim() || game.id?.trim() || game.title?.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      matched.push(game);
      if (matched.length >= 6) break;
    }
    return matched;
  }, [options.localGames, page, trimmedQuery]);

  const mergedBaseSuggestions = useMemo(() => {
    // Local já vem filtrado pela query imediata (sem debounce) para resposta
    // instantânea; remoto vem do debounce. Dedupe por appId/id, local primeiro.
    const seen = new Set<string>();
    const merged: GhostBoxGame[] = [];
    for (const game of [
      ...localHeaderSearchSuggestions,
      ...baseHeaderSearchSuggestions,
    ]) {
      const key = game.appId?.trim() || game.id?.trim() || game.title?.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(game);
      if (merged.length >= 6) break;
    }
    return merged;
  }, [baseHeaderSearchSuggestions, localHeaderSearchSuggestions]);

  const hasNoHeaderSearchResults =
    page !== "catalogue" &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    mergedBaseSuggestions.length === 0;
  const shouldShowHeaderAppIdPrompt =
    page !== "catalogue" &&
    Boolean(trimmedQuery) &&
    trimmedQuery === trimmedDebouncedQuery &&
    !isSearchLoading &&
    headerSearchQuery.isFetched &&
    mergedBaseSuggestions.length < 6;
  const appIdCandidate =
    shouldShowHeaderAppIdPrompt && steamAppIdPattern.test(trimmedQuery)
      ? trimmedQuery
      : null;
  const appIdLookupQuery = useGameStoreDetailsQuery(appIdCandidate ?? "", {
    enabled: Boolean(appIdCandidate),
  });

  const headerSearchSuggestions = useMemo(() => {
    const suggestions = [...mergedBaseSuggestions];
    const appIdGame = appIdLookupQuery.data;
    if (appIdGame && !suggestions.some((game) => game.appId === appIdGame.appId)) {
      suggestions.push(appIdGame);
    }
    return suggestions.slice(0, 6);
  }, [appIdLookupQuery.data, mergedBaseSuggestions]);

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
