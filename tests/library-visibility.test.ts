import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  filterSteamLibraryGames,
  mergeSteamOwnedLibraryGames,
} from "../src/utils/libraryVisibility";

function game(
  librarySource: GhostBoxGame["librarySource"],
  id: string,
  extra: Partial<GhostBoxGame> = {},
): GhostBoxGame {
  return {
    appId: id,
    id,
    librarySource,
    title: id,
    subtitle: "",
    status: "installed",
    hours: 0,
    ...extra,
  } as GhostBoxGame;
}

describe("filterSteamLibraryGames", () => {
  const games = [
    // Scan atual, scan antigo sem fonte e stub possuído da conta Steam.
    game(undefined, "570", { subtitle: "Instalado via Steam" }),
    game("steam-owned", "440"),
    game("steam-installed", "620"),
    // Adicionados pelo GhostBox: ficam com o toggle desligado.
    game("ghostbox", "1001", { subtitle: "Adicionado pelo GhostBox" }),
    game("registered", "730"),
    game("plugin", "1250"),
  ];

  it("com o toggle ligado devolve a biblioteca intacta", () => {
    expect(filterSteamLibraryGames(games, true)).toEqual(games);
    expect(filterSteamLibraryGames(games, true)).toBe(games);
  });

  it("com o toggle desligado esconde só os jogos vindos da Steam", () => {
    expect(filterSteamLibraryGames(games, false).map((g) => g.id)).toEqual([
      "1001",
      "730",
      "1250",
    ]);
  });

});

describe("mergeSteamOwnedLibraryGames", () => {
  it("inclui jogos possuídos que não estão instalados", () => {
    const localGames = [game("steam-installed", "620")];
    const ownedGames = [
      game("steam-owned", "620"),
      game("steam-owned", "570", { status: "discover" }),
    ];

    expect(
      mergeSteamOwnedLibraryGames(localGames, ownedGames).map((g) => g.id),
    ).toEqual(["620", "570"]);
  });

  it("mantém entrada local quando jogo possuído também está instalado", () => {
    const installed = game("steam-installed", "620", {
      installPath: "C:\\Steam\\Portal 2",
    });
    const owned = game("steam-owned", "620", { status: "discover" });

    expect(mergeSteamOwnedLibraryGames([installed], [owned])).toEqual([
      installed,
    ]);
  });
});
