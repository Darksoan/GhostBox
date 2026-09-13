import { describe, expect, it } from "vitest";
import {
  applySteamAppTypes,
  extractSteamAppType,
  filterOutSteamDemos,
  filterVisibleSteamGames,
  isBlockedSteamDemo,
  normalizeSteamAppType,
  steamAppIdOf,
} from "../src/utils/steamAppType";
import type { GhostBoxGame } from "../src/data";

function game(appId: string, extra: Partial<GhostBoxGame> = {}) {
  return {
    appId,
    id: `steam-${appId}`,
    title: `Game ${appId}`,
    ...extra,
  } as GhostBoxGame;
}

describe("steam app type classification", () => {
  it("normalizes appdetails.data.type to lowercase", () => {
    expect(normalizeSteamAppType("Demo")).toBe("demo");
    expect(normalizeSteamAppType("  GAME  ")).toBe("game");
    expect(normalizeSteamAppType("")).toBe("");
    expect(normalizeSteamAppType(undefined)).toBe("");
    expect(normalizeSteamAppType("a b")).toBe("");
  });

  it("blocks only classified demos, never unclassified rows", () => {
    expect(isBlockedSteamDemo(game("1", { appType: "demo" }))).toBe(true);
    expect(isBlockedSteamDemo(game("2", { appType: "DEMO" }))).toBe(true);
    expect(isBlockedSteamDemo(game("3", { appType: "game" }))).toBe(false);
    expect(isBlockedSteamDemo(game("4", { appType: "dlc" }))).toBe(false);
    expect(isBlockedSteamDemo(game("5"))).toBe(false);
    expect(isBlockedSteamDemo(null)).toBe(false);
  });

  it("filters demos while preserving array identity when nothing is blocked", () => {
    const games = [game("1", { appType: "game" }), game("2")];
    expect(filterOutSteamDemos(games)).toBe(games);
    const withDemo = [...games, game("3", { appType: "demo" })];
    expect(filterOutSteamDemos(withDemo).map((entry) => entry.appId)).toEqual(["1", "2"]);
  });

  it("extracts appType from catalogue, proxy and appdetails shapes", () => {
    expect(extractSteamAppType({ appType: "Demo" })).toBe("demo");
    expect(extractSteamAppType({ app_type: "game" })).toBe("game");
    expect(extractSteamAppType({ type: "DLC" })).toBe("dlc");
    expect(extractSteamAppType({})).toBe("");
    expect(extractSteamAppType(null)).toBe("");
  });

  it("resolves steam app ids from appId or steam-* id", () => {
    expect(steamAppIdOf(game("123"))).toBe("123");
    expect(steamAppIdOf({ appId: "", id: "steam-456" } as GhostBoxGame)).toBe("456");
    expect(steamAppIdOf({ appId: "", id: "other" } as GhostBoxGame)).toBe("");
  });

  it("applies resolved types without touching unmatched games", () => {
    const games = [game("10"), game("20", { appType: "game" })];
    const next = applySteamAppTypes(games, { "10": "DEMO", "30": "game" });
    expect(next[0].appType).toBe("demo");
    expect(next[1]).toBe(games[1]);
    expect(applySteamAppTypes(games, {})).toBe(games);
  });

  it("hides unclassified numeric Steam apps in strict library visibility", () => {
    const games = [
      game("10", { appType: "game" }),
      game("20", { appType: "dlc" }),
      game("30", { appType: "demo" }),
      game("40"),
      { appId: "", id: "local", title: "Local" } as GhostBoxGame,
    ];
    expect(filterVisibleSteamGames(games).map((entry) => entry.appId)).toEqual([
      "10",
      "20",
      "",
    ]);
  });
});
