import type { GhostBoxGame } from "../data";

export type LibrarySourceFilter = "all" | "installed" | "steam" | "ghostbox";

const librarySourceFilters: readonly LibrarySourceFilter[] = [
  "all",
  "installed",
  "steam",
  "ghostbox",
];

export function isLibrarySourceFilter(
  value: unknown,
): value is LibrarySourceFilter {
  return (
    typeof value === "string" &&
    (librarySourceFilters as readonly string[]).includes(value)
  );
}

/**
 * Instalados = arquivos locais no disco. Regra restrita confirmada pelo
 * usuário: só `status === "installed"` ou `librarySource === "steam-installed"`.
 * Plugin/registered/exe custom/download concluído ficam de fora — são
 * "jogáveis", não necessariamente instalados.
 */
export function isLocallyInstalledGame(game: GhostBoxGame): boolean {
  return (
    game.status === "installed" || game.librarySource === "steam-installed"
  );
}

/**
 * Steam = procedência da biblioteca Steam. Mesma regra do toggle de Conexões
 * (`isSteamLibraryGame` em libraryVisibility.ts): scan atual, scan antigo sem
 * fonte persistida e stub possuído da conta.
 */
export function isSteamSourceGame(game: GhostBoxGame): boolean {

  return (
    !game.librarySource ||
    game.librarySource === "steam-installed" ||
    game.librarySource === "steam-owned"
  );
}

/**
 * Ghostbox = adicionado pelo GhostBox (`librarySource === "ghostbox"`) ou
 * jogo com executável personalizado configurado — mesmo que a fonte seja
 * outra. Plugin/registered puros ficam de fora e aparecem só em Todos.
 */
export function isGhostboxSourceGame(game: GhostBoxGame): boolean {
  if (game.librarySource === "ghostbox") return true;
  return false;
}

export function gameMatchesLibrarySourceFilter(
  game: GhostBoxGame,
  filter: LibrarySourceFilter,
): boolean {
  switch (filter) {
    case "installed":
      return isLocallyInstalledGame(game);
    case "steam":
      return isSteamSourceGame(game);
    case "ghostbox":
      return isGhostboxSourceGame(game);
    case "all":
    default:
      return true;
  }
}

export function filterByLibrarySource(
  games: GhostBoxGame[],
  filter: LibrarySourceFilter,
): GhostBoxGame[] {
  if (filter === "all") return games;
  return games.filter((game) => gameMatchesLibrarySourceFilter(game, filter));
}
