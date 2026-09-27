import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  buildKnownGameIndex,
  expandJoinedGameSearchQuery,
  normalizeGameSearchText,
  searchKnownGames,
  shouldUseSteamSearchFallback,
} from "../src/utils/gameSearch";

function game(appId: string, title: string, extra: Partial<GhostBoxGame> = {}) {
  return {
    appId,
    id: `steam-${appId}`,
    title,
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    tags: [],
    genres: [],
    screenshots: [],
    ...extra,
  } as GhostBoxGame;
}

describe("shared local game search", () => {
  it("normalizes accents, punctuation, apostrophes and whitespace", () => {
    expect(normalizeGameSearchText("  Tom Clancy’s: AÇÃO  ")).toBe(
      "tom clancys acao",
    );
  });

  it("recovers two or more word boundaries from Steam titles", () => {
    expect(
      expandJoinedGameSearchQuery("darksouls", [
        "DARK SOULS™ III",
        "DARK SOULS™: REMASTERED",
      ]),
    ).toBe("dark souls");
    expect(
      expandJoinedGameSearchQuery("thewitcher3", [
        "The Witcher 3: Wild Hunt",
      ]),
    ).toBe("the witcher 3");
  });

  it("does not invent a split for a spaced or unrelated query", () => {
    expect(expandJoinedGameSearchQuery("dark souls", ["Dark Souls III"])).toBeNull();
    expect(expandJoinedGameSearchQuery("darksouls", ["Darkest Dungeon"])).toBeNull();
    expect(expandJoinedGameSearchQuery("fragpunk", ["FragPunk"])).toBeNull();
  });

  it("finds Steam-owned and collection-only games", () => {
    const known = buildKnownGameIndex([
      [game("2943650", "FragPunk", { librarySource: "steam-owned" })],
      [game("322330", "Don't Starve Together")],
    ]);
    expect(searchKnownGames(known, "fragpunk")[0]?.appId).toBe("2943650");
    expect(searchKnownGames(known, "dont starve")[0]?.appId).toBe("322330");
  });

  it("ranks exact, title prefix, word and substring in that order", () => {
    const results = searchKnownGames(
      [
        game("1", "Super FragPunk Arena"),
        game("2", "FragPunk Deluxe"),
        game("3", "The FragPunk"),
        game("4", "FragPunk"),
      ],
      "FragPunk",
    );
    expect(results.map(({ appId }) => appId)).toEqual(["4", "2", "3", "1"]);
  });

  it("deduplicates by AppID and preserves the most complete record", () => {
    const sparse = game("10", "Steam App 10");
    const complete = game("10", "Counter-Strike", {
      databaseAddedAt: 1,
      shortDescription: "Complete",
    });
    expect(buildKnownGameIndex([[sparse], [complete]])).toEqual([complete]);
  });

  it("uses Steam only after local and D1 miss, and never with filters", () => {
    const base = {
      query: "FragPunk",
      localResultCount: 0,
      remoteResultCount: 0,
      remoteSettled: true,
      remoteFailed: false,
    };
    expect(shouldUseSteamSearchFallback(base)).toBe(true);
    expect(
      shouldUseSteamSearchFallback({ ...base, localResultCount: 1 }),
    ).toBe(false);
    expect(
      shouldUseSteamSearchFallback({ ...base, remoteResultCount: 1 }),
    ).toBe(false);
    expect(
      shouldUseSteamSearchFallback({ ...base, remoteSettled: false }),
    ).toBe(false);
    expect(
      shouldUseSteamSearchFallback({ ...base, hasActiveFilters: true }),
    ).toBe(false);
    expect(
      shouldUseSteamSearchFallback({
        ...base,
        remoteSettled: false,
        remoteFailed: true,
      }),
    ).toBe(true);
  });
});
