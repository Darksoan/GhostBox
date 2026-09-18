import type { GhostBoxGame } from "../data";

export type LibrarySourceFilter = "all" | "steam" | "ghostbox";

const librarySourceFilters: readonly LibrarySourceFilter[] = [
  "all",
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

function hasLuaToolsMarkers(game: GhostBoxGame): boolean {
  return (
    (Array.isArray(game.luaToolsManifests) &&
      game.luaToolsManifests.length > 0) ||
    (Array.isArray(game.luaToolsManifestFiles) &&
      game.luaToolsManifestFiles.length > 0)
  );
}

/**
 * Steam = procedência da biblioteca Steam. Mesma regra do toggle de Conexões
 * (`isSteamLibraryGame` em libraryVisibility.ts): scan atual, scan antigo sem
 * fonte persistida e stub possuído da conta. Marcadores LuaTools excluem —
 * a procedência GhostBox sobrevive ao scan instalado.
 */
export function isSteamSourceGame(game: GhostBoxGame): boolean {
  if (hasLuaToolsMarkers(game)) return false;

  return (
    !game.librarySource ||
    game.librarySource === "steam-installed" ||
    game.librarySource === "steam-owned"
  );
}

/**
 * Ghostbox = gerenciado pelo launcher: fonte `ghostbox` (LuaTools/CDN),
 * `registered` (Steam registrado pelo launcher) ou `plugin` (stplug-in).
 */
export function isGhostboxSourceGame(game: GhostBoxGame): boolean {
  if (hasLuaToolsMarkers(game)) return true;
  return (
    game.librarySource === "ghostbox" ||
    game.librarySource === "registered" ||
    game.librarySource === "plugin"
  );
}

export function gameMatchesLibrarySourceFilter(
  game: GhostBoxGame,
  filter: LibrarySourceFilter,
): boolean {
  switch (filter) {
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
