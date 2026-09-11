import { describe, expect, it } from "vitest";
import type { GhostBoxGame, SteamAchievement } from "../src/data";
import { applyAchievementDetailsToGames } from "../src/utils/steamAchievementMerge";

function achievement(
  name: string,
  extra: Partial<SteamAchievement> = {},
): SteamAchievement {
  return {
    name,
    title: name,
    description: "",
    icon: "",
    iconGray: "",
    ...extra,
  };
}

function game(
  id: string,
  extra: Partial<GhostBoxGame> = {},
): GhostBoxGame {
  return {
    appId: id,
    id,
    title: id,
    subtitle: "",
    status: "installed",
    hours: 0,
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    ...extra,
  } as GhostBoxGame;
}

describe("applyAchievementDetailsToGames", () => {
  it("une lista do schema com resumo da conta sem perder desbloqueios", () => {
    const games = [
      game("620", {
        achievements: { unlocked: 3, total: 10, progress: 30 },
        achievementList: [
          achievement("win_1", { unlocked: true, unlockedAt: "2026-01-01T00:00:00.000Z" }),
          achievement("win_2", { unlocked: true, unlockedAt: "2026-01-02T00:00:00.000Z" }),
          achievement("win_3", { unlocked: true, unlockedAt: "2026-01-03T00:00:00.000Z" }),
        ],
      }),
    ];
    const details = {
      appId: "620",
      id: "620",
      achievements: { unlocked: 0, total: 10, progress: 0 },
      achievementList: Array.from({ length: 10 }, (_, index) =>
        achievement(`win_${index + 1}`),
      ),
    };

    const next = applyAchievementDetailsToGames(games, details);
    expect(next).not.toBe(games);
    expect(next[0].achievementList).toHaveLength(10);
    expect(next[0].achievements).toMatchObject({ unlocked: 3, total: 10 });
  });

  it("casa por id quando o appId diverge (steam- prefixado)", () => {
    const games = [game("730", { appId: "730", id: "steam-730" })];
    const details = {
      appId: "730",
      id: "steam-730",
      achievements: { unlocked: 1, total: 2, progress: 50 },
      achievementList: [
        achievement("a", { unlocked: true, unlockedAt: "2026-01-01T00:00:00.000Z" }),
        achievement("b"),
      ],
    };

    const next = applyAchievementDetailsToGames(games, details);
    expect(next[0].achievements).toMatchObject({ unlocked: 1, total: 2 });
  });

  it("devolve a mesma referência quando nada casa", () => {
    const games = [game("620")];
    const details = {
      appId: "570",
      id: "570",
      achievements: { unlocked: 5, total: 5, progress: 100 },
      achievementList: [achievement("a", { unlocked: true })],
    };

    expect(applyAchievementDetailsToGames(games, details)).toBe(games);
  });

  it("ignora detalhes vazios e ids em branco", () => {
    const games = [game("620")];
    expect(
      applyAchievementDetailsToGames(games, {
        appId: "620",
        id: "620",
        achievements: { unlocked: 0, total: 0, progress: 0 },
        achievementList: [],
      }),
    ).toBe(games);
    expect(
      applyAchievementDetailsToGames(games, {
        appId: "",
        id: "",
        achievements: { unlocked: 1, total: 1, progress: 100 },
        achievementList: [achievement("a", { unlocked: true })],
      }),
    ).toBe(games);
  });
});
