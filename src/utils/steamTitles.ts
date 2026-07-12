import type { GhostBoxGame } from "../data";

export function isSteamTitlePlaceholder(title: string | undefined, appId?: string) {
  const trimmed = title?.trim() ?? "";
  const normalizedTitle = trimmed.replace(/[\s_-]+/g, "").toLowerCase();
  const normalizedAppId = appId?.trim().toLowerCase() ?? "";

  if (!normalizedTitle) return true;
  if (normalizedAppId && normalizedTitle === normalizedAppId) return true;
  if (!normalizedAppId) return /^steam(?:app|appid)?\d+$/i.test(normalizedTitle);

  return (
    normalizedTitle === `steam${normalizedAppId}` ||
    normalizedTitle === `steamapp${normalizedAppId}` ||
    normalizedTitle === `steamappid${normalizedAppId}`
  );
}

export function resolveSteamGameTitle(game: GhostBoxGame, knownGames: GhostBoxGame[]) {
  if (!isSteamTitlePlaceholder(game.title, game.appId)) return game.title;

  const knownTitle = knownGames.find(
    (knownGame) =>
      knownGame.appId === game.appId &&
      !isSteamTitlePlaceholder(knownGame.title, knownGame.appId)
  )?.title;

  return knownTitle ?? game.title;
}

export function normalizeSteamGameTitle(game: GhostBoxGame, knownGames: GhostBoxGame[]) {
  const title = resolveSteamGameTitle(game, knownGames);
  return title === game.title ? game : { ...game, title };
}

export function normalizeSteamGameTitles(games: GhostBoxGame[], knownGames: GhostBoxGame[]) {
  return games.map((game) => normalizeSteamGameTitle(game, knownGames));
}
