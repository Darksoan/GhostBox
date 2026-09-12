import type { GhostBoxGame } from "../data";

const combiningMarksPattern = /[\u0300-\u036f]/g;
const apostrophePattern = /['’‘`´]/g;
const punctuationPattern = /[^\p{L}\p{N}]+/gu;

export function normalizeGameSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(combiningMarksPattern, "")
    .toLocaleLowerCase()
    .replace(apostrophePattern, "")
    .replace(punctuationPattern, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isValidSteamAppId(value: string) {
  return /^\d{1,10}$/.test(value.trim());
}

export function canSearchSteamStore(value: string) {
  const trimmed = value.trim();
  return isValidSteamAppId(trimmed) || normalizeGameSearchText(trimmed).length >= 3;
}

export function shouldUseSteamSearchFallback(options: {
  query: string;
  localResultCount: number;
  remoteResultCount: number;
  remoteSettled: boolean;
  remoteFailed: boolean;
  hasActiveFilters?: boolean;
}) {
  return (
    !options.hasActiveFilters &&
    canSearchSteamStore(options.query) &&
    options.localResultCount === 0 &&
    (options.remoteFailed ||
      (options.remoteSettled && options.remoteResultCount === 0))
  );
}

function gameKey(game: GhostBoxGame) {
  const appId = game.appId?.trim();
  if (appId) return `app:${appId}`;
  const id = game.id?.trim();
  if (id) return `id:${id.toLocaleLowerCase()}`;
  return `title:${normalizeGameSearchText(game.title ?? "")}`;
}

function completenessScore(game: GhostBoxGame) {
  let score = 0;
  const title = game.title?.trim() ?? "";
  if (title && !/^Steam App \d+$/i.test(title)) score += 8;
  if (game.databaseAddedAt) score += 8;
  if (game.shortDescription || game.aboutTheGame) score += 4;
  if (game.cover || game.coverUrl) score += 2;
  if (game.hero || game.heroUrl) score += 2;
  score += Math.min(game.tags?.length ?? 0, 4);
  score += Math.min(game.genres?.length ?? 0, 4);
  score += Math.min(game.screenshots?.length ?? 0, 4);
  score += Math.min(game.achievementList?.length ?? 0, 4);
  return score;
}

/** Deduplica por AppID e mantém o registro com mais metadados úteis. */
export function buildKnownGameIndex(sources: readonly (readonly GhostBoxGame[])[]) {
  const indexed = new Map<string, { game: GhostBoxGame; score: number; order: number }>();
  let order = 0;
  for (const source of sources) {
    for (const game of source) {
      const key = gameKey(game);
      if (key.endsWith(":")) continue;
      const score = completenessScore(game);
      const current = indexed.get(key);
      if (!current || score > current.score) {
        indexed.set(key, { game, score, order: current?.order ?? order });
      }
      order += 1;
    }
  }
  return [...indexed.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ game }) => game);
}

function searchRank(game: GhostBoxGame, normalizedQuery: string) {
  const title = normalizeGameSearchText(game.title ?? "");
  if (title === normalizedQuery) return 0;
  if (title.startsWith(normalizedQuery)) return 1;
  if (title.split(" ").includes(normalizedQuery)) return 2;
  if (
    title.includes(normalizedQuery) ||
    normalizedQuery.split(" ").every((token) => title.includes(token))
  ) {
    return 3;
  }
  const appId = game.appId?.trim() ?? "";
  const id = normalizeGameSearchText(game.id ?? "");
  if (appId.includes(normalizedQuery) || id.includes(normalizedQuery)) return 4;
  return null;
}

export function searchKnownGames(
  games: readonly GhostBoxGame[],
  query: string,
  limit = 20,
) {
  const normalizedQuery = normalizeGameSearchText(query);
  if (!normalizedQuery || limit <= 0) return [];

  return buildKnownGameIndex([games])
    .map((game, order) => ({
      game,
      order,
      rank: searchRank(game, normalizedQuery),
      title: normalizeGameSearchText(game.title ?? ""),
    }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.title.length - right.title.length ||
        left.title.localeCompare(right.title) ||
        left.order - right.order,
    )
    .slice(0, limit)
    .map(({ game }) => game);
}

export function mergeGameSearchResults(
  sources: readonly (readonly GhostBoxGame[])[],
  limit: number,
) {
  return buildKnownGameIndex(sources).slice(0, Math.max(0, limit));
}
