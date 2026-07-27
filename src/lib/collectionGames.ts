import type { GhostBoxGame } from "../data";
import type { UserCollection } from "../types";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";

function gameLookupKeys(game: GhostBoxGame) {
  const keys = new Set<string>();
  const id = game.id?.trim();
  const appId = game.appId?.trim();

  if (id) keys.add(id);
  if (appId) {
    keys.add(appId);
    if (/^\d+$/.test(appId)) keys.add(`steam-${appId}`);
  }

  const steamId = id?.match(/^steam-(\d+)$/i)?.[1];
  if (steamId) keys.add(steamId);

  return keys;
}

function shouldPreferGame(current: GhostBoxGame | undefined, next: GhostBoxGame) {
  if (!current) return true;

  const currentPlaceholder = isSteamTitlePlaceholder(current.title, current.appId);
  const nextPlaceholder = isSteamTitlePlaceholder(next.title, next.appId);
  if (currentPlaceholder !== nextPlaceholder) return currentPlaceholder;

  const currentAssetCount = [current.cover, current.coverUrl, current.hero, current.heroUrl, current.logo]
    .filter(Boolean).length;
  const nextAssetCount = [next.cover, next.coverUrl, next.hero, next.heroUrl, next.logo]
    .filter(Boolean).length;

  return nextAssetCount > currentAssetCount;
}

export function rehydrateUserCollectionGames(
  collections: UserCollection[],
  knownGames: GhostBoxGame[],
): UserCollection[] {
  const gameByKey = new Map<string, GhostBoxGame>();

  for (const game of knownGames) {
    for (const key of gameLookupKeys(game)) {
      if (shouldPreferGame(gameByKey.get(key), game)) {
        gameByKey.set(key, game);
      }
    }
  }

  return collections.map((collection) => ({
    ...collection,
    games: collection.gameIds.flatMap((gameId) => {
      const game = gameByKey.get(gameId.trim());
      return game ? [game] : [];
    }),
  }));
}

export function haveCollectionGamesChanged(
  previous: UserCollection[],
  next: UserCollection[],
) {
  return next.some((collection, collectionIndex) => {
    const previousGames = previous[collectionIndex]?.games ?? [];
    const nextGames = collection.games ?? [];
    if (previousGames.length !== nextGames.length) return true;

    return nextGames.some((game, gameIndex) => {
      const previousGame = previousGames[gameIndex];
      return (
        previousGame?.id !== game.id ||
        previousGame?.appId !== game.appId ||
        previousGame?.title !== game.title ||
        previousGame?.cover !== game.cover ||
        previousGame?.coverUrl !== game.coverUrl ||
        previousGame?.hero !== game.hero ||
        previousGame?.heroUrl !== game.heroUrl ||
        previousGame?.logo !== game.logo
      );
    });
  });
}
