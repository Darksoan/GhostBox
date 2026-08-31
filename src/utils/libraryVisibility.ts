import type { GhostBoxGame } from "../data";

/** Procedências que marcam jogo adicionado/gerenciado pelo GhostBox
 * (registry `ghostbox-library.json`). O scan da Steam não marca os jogos
 * que só existem nele — ausência de fonte é o sinal de "veio da Steam". */
const GHOSTBOX_LIBRARY_SOURCES: ReadonlySet<string> = new Set([
  "ghostbox",
  "plugin",
  "registered",
]);

function isSteamLibraryGame(game: GhostBoxGame) {
  return (
    !game.librarySource || !GHOSTBOX_LIBRARY_SOURCES.has(game.librarySource)
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
