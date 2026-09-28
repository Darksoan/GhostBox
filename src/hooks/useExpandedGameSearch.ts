import type { GameDatabaseRequest } from "../data";
import type { AppearanceSettings } from "../context/settings";
import { useGamesQuery, useSteamStoreSearchQuery } from "../queries/games";
import {
  canSearchSteamStore,
  expandJoinedGameSearchQuery,
  normalizeGameSearchText,
} from "../utils/gameSearch";

export function useExpandedGameSearch(
  request: GameDatabaseRequest,
  enabled: boolean,
  steamLimit: number,
  language: AppearanceSettings["language"],
  options: { steamSupplement?: boolean } = {},
) {
  const catalogueQuery = useGamesQuery(request, { enabled });
  const query = normalizeGameSearchText(request.query ?? "");
  const primarySettled =
    !catalogueQuery.isFetching &&
    !catalogueQuery.isPlaceholderData &&
    (catalogueQuery.isFetched || catalogueQuery.isError);
  // No header o modo supplement consulta a loja em paralelo mesmo quando o
  // catálogo já tem resultados (ex: "hollow knight" retorna a base no D1 e
  // Silksong/soundtrack/DLC na loja). No catálogo mantém o fallback clássico
  // (só quando o primário falha ou volta vazio) para não poluir a grade.
  const shouldSearchSteam =
    enabled &&
    canSearchSteamStore(query) &&
    primarySettled &&
    (options.steamSupplement ||
      catalogueQuery.isError ||
      (catalogueQuery.data?.games.length ?? 0) === 0);
  const steamSearchQuery = useSteamStoreSearchQuery(
    query,
    steamLimit,
    language,
    { enabled: shouldSearchSteam },
  );
  const expandedQuery =
    shouldSearchSteam && !catalogueQuery.isError
      ? expandJoinedGameSearchQuery(
          query,
          (steamSearchQuery.data ?? []).map((game) => game.title),
        )
      : null;
  const expandedCatalogueQuery = useGamesQuery(
    { ...request, query: expandedQuery ?? query },
    { enabled: shouldSearchSteam && Boolean(expandedQuery) },
  );
  const expandedSettled =
    Boolean(expandedQuery) &&
    !expandedCatalogueQuery.isFetching &&
    !expandedCatalogueQuery.isPlaceholderData &&
    (expandedCatalogueQuery.isFetched || expandedCatalogueQuery.isError);
  const expandedData =
    expandedSettled && !expandedCatalogueQuery.isError
      ? expandedCatalogueQuery.data
      : undefined;

  return {
    catalogueQuery,
    expandedCatalogueQuery,
    steamSearchQuery,
    shouldSearchSteam,
    expandedQuery,
    expandedData,
    isExpansionPending:
      shouldSearchSteam &&
      (steamSearchQuery.isFetching ||
        (Boolean(expandedQuery) && !expandedSettled)),
  };
}
