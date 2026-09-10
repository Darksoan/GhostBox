import type { GhostBoxGame } from "../data";

type CollectionWithGames = {
  games: GhostBoxGame[];
};

export function filterCollectionsByGameTitle<T extends CollectionWithGames>(
  collections: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return collections;

  return collections.filter((collection) =>
    collection.games.some((game) => game.title.toLocaleLowerCase().includes(normalizedQuery)),
  );
}
