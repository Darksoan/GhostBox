import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { isRecognizedSteamProfileGame } from "../src/utils/profileAchievements";

function makeGame(overrides: Partial<GhostBoxGame> = {}): GhostBoxGame {
  return {
    appId: "440",
    id: "steam-440",
    title: "Team Fortress 2",
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    playTimeInMilliseconds: 0,
    ...overrides,
  } as unknown as GhostBoxGame;
}

describe("isRecognizedSteamProfileGame", () => {
  it("requires playtime and an unlocked achievement while Steam metrics are shown", () => {
    expect(isRecognizedSteamProfileGame(makeGame(), 0)).toBe(false);
    expect(isRecognizedSteamProfileGame(makeGame(), 60_000)).toBe(false);
    expect(
      isRecognizedSteamProfileGame(
        makeGame({ achievements: { unlocked: 1, total: 3, progress: 33 } }),
        60_000,
      ),
    ).toBe(true);
  });

  it("keeps GhostBox-owned games without Steam signals when metrics are hidden", () => {
    expect(
      isRecognizedSteamProfileGame(makeGame(), 0, { requireSteamSignals: false }),
    ).toBe(true);
  });

  it("still drops software-like entries when metrics are hidden", () => {
    const software = makeGame({ genres: ["Utilities"] } as Partial<GhostBoxGame>);
    expect(
      isRecognizedSteamProfileGame(software, 0, { requireSteamSignals: false }),
    ).toBe(false);
  });
});
