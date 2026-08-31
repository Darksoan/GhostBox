import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { filterSteamLibraryGames } from "../src/utils/libraryVisibility";

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
    // Scan da Steam: instalado via appmanifest (sem fonte), stub possuído e
    // fallback de plugin sem entrada no registry.
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
