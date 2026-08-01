import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  getProfileAchievementTotal,
  getProfileUnlockedAchievementCount,
} from "../src/utils/profileAchievements";
import { sortOverviewGames } from "../src/utils/overviewSort";

type GameOverrides = {
  title?: string;
  unlocked?: number;
  total?: number;
  achievementList?: Array<{ unlocked: boolean }>;
  playTimeInMilliseconds?: number;
  lastTimePlayed?: string;
};

function makeGame(appId: string, overrides: GameOverrides = {}): GhostBoxGame {
  return {
    appId,
    id: `steam-${appId}`,
    title: overrides.title ?? `Game ${appId}`,
    achievements: {
      unlocked: overrides.unlocked ?? 0,
      total: overrides.total ?? 0,
      progress: 0,
    },
    achievementList: overrides.achievementList ?? [],
    playTimeInMilliseconds: overrides.playTimeInMilliseconds ?? 0,
    lastTimePlayed: overrides.lastTimePlayed,
  } as unknown as GhostBoxGame;
}

const titlesOf = (games: GhostBoxGame[]) => games.map((game) => game.title);

describe("profile achievement counters", () => {
  it("counts explicit unlocks from the list", () => {
    const game = makeGame("1", {
      achievementList: [{ unlocked: true }, { unlocked: false }, { unlocked: true }],
    });

    expect(getProfileUnlockedAchievementCount(game)).toBe(2);
  });

  it("falls back to the summary when it reports more unlocks than the list", () => {
    const game = makeGame("1", {
      unlocked: 7,
      achievementList: [{ unlocked: true }],
    });

    expect(getProfileUnlockedAchievementCount(game)).toBe(7);
  });

  it("takes the total from whichever source is richest", () => {
    expect(
      getProfileAchievementTotal(
        makeGame("1", { total: 3, achievementList: [{ unlocked: true }] }),
      ),
    ).toBe(3);

    expect(
      getProfileAchievementTotal(
        makeGame("2", {
          total: 1,
          achievementList: [{ unlocked: true }, { unlocked: false }],
        }),
      ),
    ).toBe(2);

    // Unlocked count can exceed both when only the summary knows about them.
    expect(getProfileAchievementTotal(makeGame("3", { unlocked: 9 }))).toBe(9);
  });
});

describe("sortOverviewGames", () => {
  it("orders by last played, then playtime", () => {
    const games = [
      makeGame("1", { title: "Older", lastTimePlayed: "2024-01-01T00:00:00Z" }),
      makeGame("2", { title: "Newer", lastTimePlayed: "2024-06-01T00:00:00Z" }),
      makeGame("3", { title: "Never", playTimeInMilliseconds: 5000 }),
      makeGame("4", { title: "NeverButLonger", playTimeInMilliseconds: 9000 }),
    ];

    expect(titlesOf(sortOverviewGames(games, "recent", "en"))).toEqual([
      "Newer",
      "Older",
      "NeverButLonger",
      "Never",
    ]);
  });

  it("orders by unlocked count, then total, then title", () => {
    const games = [
      makeGame("1", { title: "Bravo", unlocked: 2, total: 10 }),
      makeGame("2", { title: "Alpha", unlocked: 2, total: 10 }),
      makeGame("3", { title: "Charlie", unlocked: 5, total: 10 }),
      makeGame("4", { title: "Delta", unlocked: 2, total: 20 }),
    ];

    expect(titlesOf(sortOverviewGames(games, "achievements", "en"))).toEqual([
      "Charlie",
      "Delta",
      "Alpha",
      "Bravo",
    ]);
  });

  it("keeps only fully completed games under the perfect sort", () => {
    const games = [
      makeGame("1", { title: "Perfect", unlocked: 4, total: 4 }),
      makeGame("2", { title: "Partial", unlocked: 3, total: 4 }),
      makeGame("3", { title: "NoAchievements" }),
    ];

    expect(titlesOf(sortOverviewGames(games, "perfect", "en"))).toEqual(["Perfect"]);
  });

  it("does not mutate the input array", () => {
    const games = [
      makeGame("1", { title: "Zulu", unlocked: 1 }),
      makeGame("2", { title: "Alpha", unlocked: 9 }),
    ];
    const original = titlesOf(games);

    sortOverviewGames(games, "achievements", "en");

    expect(titlesOf(games)).toEqual(original);
  });
});
