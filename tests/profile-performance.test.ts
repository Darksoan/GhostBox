import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import type { SteamAccountStats } from "../src/types";
import {
  buildSteamAchievementIndex,
  mergeSteamAchievementsIntoGame,
} from "../src/utils/steamAchievementMerge";

function makeGame(appId: string): GhostBoxGame {
  return {
    appId,
    id: `steam-${appId}`,
    title: `Game ${appId}`,
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
  } as unknown as GhostBoxGame;
}

function makeStats(): SteamAccountStats {
  return {
    steamId: "steam-id",
    gamesCount: 1,
    totalPlaytimeMinutes: 10,
    unlockedAchievements: 1,
    totalAchievements: 2,
    perfectGames: 0,
    averageProgress: 50,
    scannedGames: 1,
    pendingGames: 0,
    failedGames: 0,
    fetchedAt: 1,
    private: false,
    hasApiKey: true,
    scanInProgress: false,
    recentAchievements: [],
    achievements: [
      {
        appId: "10",
        gameTitle: "Game 10",
        achievements: [
          {
            name: "first",
            title: "First",
            description: "First achievement",
            icon: "icon",
            iconGray: "icon-gray",
            unlocked: true,
            unlockedAt: 1,
          },
        ],
      },
    ],
  };
}

describe("Steam achievement index", () => {
  it("indexes each summary once and reuses the index for game merges", () => {
    const stats = makeStats();
    const index = buildSteamAchievementIndex(stats);

    expect(index.get("10")).toHaveLength(1);
    expect(buildSteamAchievementIndex(stats)).toBe(index);
    expect(mergeSteamAchievementsIntoGame(makeGame("10"), stats, index).achievements)
      .toEqual({ unlocked: 1, total: 1, progress: 100 });
  });
});
