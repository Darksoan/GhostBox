import type { GhostBoxGame } from "../data";

type CollectionWithGames = {
  games: GhostBoxGame[];
};

type RankedGame = {
  game: GhostBoxGame;
  score: number;
  normalizedTitle: string;
  sourceIndex: number;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/['’‘`´]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function getTitleMatchScore(normalizedTitle: string, normalizedQuery: string): number | null {
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 100 + normalizedTitle.length - normalizedQuery.length;
  }

  const words = normalizedTitle.split(" ");
  const exactWordIndex = words.findIndex((word) => word === normalizedQuery);
  if (exactWordIndex >= 0) return 200 + exactWordIndex;

  const wordPrefixIndex = words.findIndex((word) => word.startsWith(normalizedQuery));
  if (wordPrefixIndex >= 0) return 250 + wordPrefixIndex;

  const substringIndex = normalizedTitle.indexOf(normalizedQuery);
  if (substringIndex >= 0) return 300 + substringIndex;

  const queryWords = normalizedQuery.split(" ");
  const wordPositions = queryWords.map((word) => normalizedTitle.indexOf(word));
  if (queryWords.length > 1 && wordPositions.every((position) => position >= 0)) {
    return 400 + wordPositions.reduce((total, position) => total + position, 0);
  }

  const compactTitle = normalizedTitle.replace(/\s/gu, "");
  const compactQuery = normalizedQuery.replace(/\s/gu, "");
  const compactIndex = compactTitle.indexOf(compactQuery);
  return compactIndex >= 0 ? 500 + compactIndex : null;
}

export function searchCollectionGames<T extends CollectionWithGames>(
  collections: T[],
  query: string,
): GhostBoxGame[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const uniqueGames = new Map<string, GhostBoxGame>();
  collections.forEach((collection) => {
    collection.games.forEach((game) => {
      const key = game.appId || game.id;
      if (!uniqueGames.has(key)) uniqueGames.set(key, game);
    });
  });

  const rankedGames: RankedGame[] = [];
  let sourceIndex = 0;
  uniqueGames.forEach((game) => {
    const normalizedTitle = normalizeSearchText(game.title);
    const score = getTitleMatchScore(normalizedTitle, normalizedQuery);
    if (score != null) rankedGames.push({ game, score, normalizedTitle, sourceIndex });
    sourceIndex += 1;
  });

  return rankedGames
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.normalizedTitle.length - right.normalizedTitle.length ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ game }) => game);
}
