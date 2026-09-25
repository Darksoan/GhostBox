import type { GhostBoxGame } from "../data";
import type { UserCollection } from "../types";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";
import { createProfileHistoryFallbackGame } from "./profileHistoryGames";

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

/** Keep cloud collection IDs visible even when game details fail to load at sign-in. */
export async function resolveCloudCollectionGames(
  gameIds: string[],
  knownGames: GhostBoxGame[],
  loadGame: (gameId: string) => Promise<GhostBoxGame | null>,
) {
  const knownByKey = new Map<string, GhostBoxGame>();
  for (const game of knownGames) {
    for (const key of gameLookupKeys(game)) {
      if (shouldPreferGame(knownByKey.get(key), game)) knownByKey.set(key, game);
    }
  }

  const gamesById = new Map<string, GhostBoxGame>();
  const missingIds: string[] = [];
  for (const gameId of gameIds) {
    const known = knownByKey.get(gameId);
    if (known) gamesById.set(gameId, known);
    else missingIds.push(gameId);
  }

  for (let index = 0; index < missingIds.length; index += 8) {
    const batch = missingIds.slice(index, index + 8);
    const loaded = await Promise.all(batch.map((id) => loadGame(id).catch(() => null)));
    loaded.forEach((game, offset) => {
      const requestedId = batch[offset];
      if (game) {
        gamesById.set(requestedId, game);
        return;
      }

      const steamAppId = requestedId.match(/^(?:steam-)?(\d+)$/i)?.[1];
      const fallback = createProfileHistoryFallbackGame(
        steamAppId ?? requestedId,
        steamAppId ? `Steam App ${steamAppId}` : requestedId,
      );
      gamesById.set(requestedId, steamAppId ? fallback : { ...fallback, id: requestedId });
    });
  }

  return {
    gamesById,
    games: Array.from(new Map([...knownGames, ...gamesById.values()].map((game) => [game.id, game])).values()),
  };
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

  return collections.map((collection) => {
    // Opção A: a coleção exibe o jogo mesmo quando ele não está na biblioteca
    // (catálogo, busca, histórico). Sem este fallback, um gameId sem match em
    // `knownGames` era descartado de `games` e o jogo "sumia" da sidebar e da
    // aba da coleção após reload ou após o efeito de reidratação.
    const storedGamesByKey = new Map<string, GhostBoxGame>();
    for (const game of collection.games ?? []) {
      for (const key of gameLookupKeys(game)) {
        if (!storedGamesByKey.has(key)) {
          storedGamesByKey.set(key, game);
        }
      }
    }

    return {
      ...collection,
      games: collection.gameIds.flatMap((gameId) => {
        const key = gameId.trim();
        const game = gameByKey.get(key) ?? storedGamesByKey.get(key);
        return game ? [game] : [];
      }),
    };
  });
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
