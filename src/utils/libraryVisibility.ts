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
  // Um executável configurado pelo usuário é uma entrada gerenciada pelo
  // GhostBox, mesmo quando o catálogo original veio da Steam.

  // Marcadores LuaTools indicam procedência GhostBox mesmo após o scan
  // marcar como instalado — sem isso o toggle esconderia o jogo.
  if (
    (Array.isArray(game.luaToolsManifests) &&
      game.luaToolsManifests.length > 0) ||
    (Array.isArray(game.luaToolsManifestFiles) &&
      game.luaToolsManifestFiles.length > 0)
  ) {
    return false;
  }

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
