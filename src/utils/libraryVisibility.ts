import type { GhostBoxGame } from "../data";

export function mergeSteamOwnedLibraryGames(
  localGames: GhostBoxGame[],
  ownedGames: GhostBoxGame[],
) {
  const gamesByAppId = new Map<string, GhostBoxGame>();
  ownedGames.forEach((game) => gamesByAppId.set(game.appId || game.id, game));
  localGames.forEach((game) => gamesByAppId.set(game.appId || game.id, game));
  return [...gamesByAppId.values()];
}

function isSteamLibraryGame(game: GhostBoxGame) {
  // Scans antigos não persistiam a procedência dos manifestos Steam.
  return (
    !game.librarySource ||
    game.librarySource === "steam-installed" ||
    game.librarySource === "steam-owned"
  );
}

/**
 * Filtra a biblioteca exibida na aba Biblioteca conforme o toggle de
 * Conexões. Com o toggle ligado (padrão) a lista volta intacta; desligado,
 * apenas os jogos vindos da biblioteca Steam saem — jogos adicionados pelo
 * GhostBox (LuaTools/CDN, registrados, plugins curados) permanecem.
 */
export function filterSteamLibraryGames(
  games: GhostBoxGame[],
  showSteamLibraryGames: boolean,
) {
  if (showSteamLibraryGames) return games;
  return games.filter((game) => !isSteamLibraryGame(game));
}
