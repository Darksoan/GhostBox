import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  filterByLibrarySource,
  gameMatchesLibrarySourceFilter,
  isGhostboxSourceGame,
  isLibrarySourceFilter,
  isLocallyInstalledGame,
  isSteamSourceGame,
} from "../src/utils/librarySourceFilter";

function game(
  id: string,
  extra: Partial<GhostBoxGame> = {},
): GhostBoxGame {
  return {
    appId: id,
    id,
    title: id,
    subtitle: "",
    status: "discover",
    hours: 0,
    ...extra,
  } as GhostBoxGame;
}

describe("isLocallyInstalledGame", () => {
  it("aceita status installed e steam-installed, rejeita resto", () => {
    expect(
      isLocallyInstalledGame(game("1", { status: "installed" })),
    ).toBe(true);
    expect(
      isLocallyInstalledGame(game("2", { librarySource: "steam-installed" })),
    ).toBe(true);
    expect(
      isLocallyInstalledGame(game("3", { librarySource: "ghostbox" })),
    ).toBe(false);
    expect(
      isLocallyInstalledGame(
        game("4", { librarySource: "plugin", status: "discover" }),
      ),
    ).toBe(false);
    expect(
      isLocallyInstalledGame(
        game("5", { librarySource: "registered", status: "discover" }),
      ),
    ).toBe(false);
  });
});

describe("isSteamSourceGame", () => {
  it("aceita scan atual, legado sem fonte e possuído; rejeita GhostBox", () => {
    expect(isSteamSourceGame(game("570"))).toBe(true);
    expect(
      isSteamSourceGame(game("620", { librarySource: "steam-installed" })),
    ).toBe(true);
    expect(
      isSteamSourceGame(game("440", { librarySource: "steam-owned" })),
    ).toBe(true);
    expect(
      isSteamSourceGame(game("1001", { librarySource: "ghostbox" })),
    ).toBe(false);
    expect(
      isSteamSourceGame(game("730", { librarySource: "registered" })),
    ).toBe(false);
    expect(
      isSteamSourceGame(game("1250", { librarySource: "plugin" })),
    ).toBe(false);
  });
});

describe("isGhostboxSourceGame", () => {
  it("aceita ghostbox puro e exe custom com outra fonte", () => {
    expect(
      isGhostboxSourceGame(game("1001", { librarySource: "ghostbox" })),
    ).toBe(true);
    expect(
      isGhostboxSourceGame(
        game("620", {
          librarySource: "steam-installed",
          customExePath: "C:\\Jogos\\game.exe",
        }),
      ),
    ).toBe(true);
    expect(
      isGhostboxSourceGame(
        game("730", {
          librarySource: "registered",
          customExePath: "C:\\Jogos\\game.exe",
        }),
      ),
    ).toBe(true);
  });

  it("rejeita steam puro, plugin/registered sem exe e exe vazio", () => {
    expect(
      isGhostboxSourceGame(game("620", { librarySource: "steam-installed" })),
    ).toBe(false);
    expect(
      isGhostboxSourceGame(game("1250", { librarySource: "plugin" })),
    ).toBe(false);
    expect(
      isGhostboxSourceGame(game("730", { librarySource: "registered" })),
    ).toBe(false);
    expect(
      isGhostboxSourceGame(
        game("1", { librarySource: "ghostbox", customExePath: "   " }),
      ),
    ).toBe(true);
    expect(
      isGhostboxSourceGame(
        game("2", { librarySource: "steam-owned", customExePath: "  " }),
      ),
    ).toBe(false);
  });
});

describe("filterByLibrarySource", () => {
  const games = [
    game("620", { librarySource: "steam-installed", status: "installed" }),
    game("440", { librarySource: "steam-owned", status: "discover" }),
    game("570", { status: "discover" }),
    game("1001", { librarySource: "ghostbox", status: "discover" }),
    game("1002", {
      librarySource: "ghostbox",
      status: "installed",
      customExePath: "C:\\GhostBox\\game.exe",
    }),
    game("730", { librarySource: "registered", status: "discover" }),
    game("1250", { librarySource: "plugin", status: "discover" }),
    game("99", {
      librarySource: "steam-owned",
      status: "discover",
      customExePath: "C:\\Custom\\game.exe",
    }),
  ];

  it("all devolve a lista intacta", () => {
    expect(filterByLibrarySource(games, "all")).toBe(games);
  });

  it("installed lista só arquivos locais", () => {
    expect(filterByLibrarySource(games, "installed").map((g) => g.id)).toEqual([
      "620",
      "1002",
    ]);
  });

  it("steam lista scan atual, legado e possuídos", () => {
    expect(filterByLibrarySource(games, "steam").map((g) => g.id)).toEqual([
      "620",
      "440",
      "570",
      "99",
    ]);
  });

  it("ghostbox lista ghostbox puro mais exe custom de outra fonte", () => {
    expect(filterByLibrarySource(games, "ghostbox").map((g) => g.id)).toEqual([
      "1001",
      "1002",
      "99",
    ]);
  });

  it("plugin/registered sem exe aparecem só em todos", () => {
    for (const filter of ["installed", "steam", "ghostbox"] as const) {
      const ids = filterByLibrarySource(games, filter).map((g) => g.id);
      expect(ids).not.toContain("730");
      expect(ids).not.toContain("1250");
    }
    expect(
      filterByLibrarySource(games, "all").map((g) => g.id),
    ).toEqual(expect.arrayContaining(["730", "1250"]));
  });
});

describe("gameMatchesLibrarySourceFilter + isLibrarySourceFilter", () => {
  it("match individual bate com filtro em lote", () => {
    const installed = game("1", { status: "installed" });
    expect(gameMatchesLibrarySourceFilter(installed, "installed")).toBe(true);
    expect(gameMatchesLibrarySourceFilter(installed, "ghostbox")).toBe(false);
    expect(gameMatchesLibrarySourceFilter(installed, "all")).toBe(true);
  });

  it("guarda valida valores persistidos", () => {
    expect(isLibrarySourceFilter("all")).toBe(true);
    expect(isLibrarySourceFilter("installed")).toBe(true);
    expect(isLibrarySourceFilter("steam")).toBe(true);
    expect(isLibrarySourceFilter("ghostbox")).toBe(true);
    expect(isLibrarySourceFilter("title")).toBe(false);
    expect(isLibrarySourceFilter(null)).toBe(false);
    expect(isLibrarySourceFilter(undefined)).toBe(false);
  });
});
