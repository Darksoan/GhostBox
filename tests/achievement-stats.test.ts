import { describe, expect, it } from "vitest";
import type { GhostBoxGame, SteamAchievement } from "../src/data";
import {
  getAchievementTotal,
  getRicherAchievementGame,
  getUnlockedAchievementCount,
  isAchievementUnlocked,
} from "../src/utils/achievementStats";

function makeAchievement(overrides: Partial<SteamAchievement> = {}): SteamAchievement {
  return {
    name: overrides.name ?? "ach",
    title: overrides.title ?? "Achievement",
    description: overrides.description ?? "",
    icon: overrides.icon ?? "icon",
    iconGray: overrides.iconGray ?? "icon-gray",
    ...overrides,
  };
}

function makeGame(
  overrides: {
    appId?: string;
    title?: string;
    unlocked?: number;
    total?: number;
    achievementList?: SteamAchievement[];
  } = {},
): GhostBoxGame {
  return {
    appId: overrides.appId ?? "10",
    id: `steam-${overrides.appId ?? "10"}`,
    title: overrides.title ?? "Half-Life",
    achievements: {
      unlocked: overrides.unlocked ?? 0,
      total: overrides.total ?? 0,
      progress: 0,
    },
    achievementList: overrides.achievementList ?? [],
  } as unknown as GhostBoxGame;
}

describe("isAchievementUnlocked", () => {
  it("accepts an explicit unlocked flag", () => {
    expect(isAchievementUnlocked(makeAchievement({ unlocked: true }))).toBe(true);
  });

  // The lenient rule: a persisted unlock timestamp is proof of an unlock even when
  // the boolean was never written (older cache entries and backup payloads do this).
  it("accepts an unlock timestamp without the flag", () => {
    expect(
      isAchievementUnlocked(makeAchievement({ unlockedAt: "2024-01-01T00:00:00Z" })),
    ).toBe(true);
  });

  it("rejects an achievement with neither", () => {
    expect(isAchievementUnlocked(makeAchievement())).toBe(false);
    expect(isAchievementUnlocked(makeAchievement({ unlocked: false }))).toBe(false);
  });

  it("ignores an empty timestamp", () => {
    expect(isAchievementUnlocked(makeAchievement({ unlockedAt: "" }))).toBe(false);
  });
});

describe("getUnlockedAchievementCount", () => {
  it("counts unlocked entries in the list", () => {
    const game = makeGame({
      achievementList: [
        makeAchievement({ name: "a", unlocked: true }),
        makeAchievement({ name: "b" }),
        makeAchievement({ name: "c", unlockedAt: "2024-01-01T00:00:00Z" }),
      ],
    });

    expect(getUnlockedAchievementCount(game)).toBe(2);
  });

  it("falls back to the summary when it knows about more unlocks", () => {
    const game = makeGame({
      unlocked: 7,
      achievementList: [makeAchievement({ unlocked: true })],
    });

    expect(getUnlockedAchievementCount(game)).toBe(7);
  });

  it("handles a missing list", () => {
    expect(getUnlockedAchievementCount(makeGame({ unlocked: 3 }))).toBe(3);
  });
});

describe("getAchievementTotal", () => {
  it("takes the largest of list length, summary total and unlocked count", () => {
    expect(
      getAchievementTotal(
        makeGame({ total: 3, achievementList: [makeAchievement({ unlocked: true })] }),
      ),
    ).toBe(3);

    expect(
      getAchievementTotal(
        makeGame({
          total: 1,
          achievementList: [makeAchievement({ name: "a" }), makeAchievement({ name: "b" })],
        }),
      ),
    ).toBe(2);

    // Only the summary knows these unlocks, so they set the floor for the total.
    expect(getAchievementTotal(makeGame({ unlocked: 9 }))).toBe(9);
  });
});

describe("getRicherAchievementGame", () => {
  it("returns the incoming game when there is no current one", () => {
    const incoming = makeGame({ title: "Incoming" });
    expect(getRicherAchievementGame(undefined, incoming)).toBe(incoming);
  });

  it("prefers the higher total, then the higher unlocked count", () => {
    const poor = makeGame({ title: "Poor", total: 5, unlocked: 1 });
    const rich = makeGame({ title: "Rich", total: 20, unlocked: 1 });
    expect(getRicherAchievementGame(poor, rich).title).toBe("Rich");
    expect(getRicherAchievementGame(rich, poor).title).toBe("Rich");

    const fewUnlocks = makeGame({ title: "Few", total: 10, unlocked: 2 });
    const manyUnlocks = makeGame({ title: "Many", total: 10, unlocked: 8 });
    expect(getRicherAchievementGame(fewUnlocks, manyUnlocks).title).toBe("Many");
    expect(getRicherAchievementGame(manyUnlocks, fewUnlocks).title).toBe("Many");
  });

  it("breaks a full tie on the longer achievement list, favouring incoming", () => {
    const current = makeGame({ title: "Current" });
    const incoming = makeGame({ title: "Incoming" });
    expect(getRicherAchievementGame(current, incoming).title).toBe("Incoming");
  });

  // Without the flag the caller gets the winning object itself, not a copy. The card
  // merge in gameCardData relies on that identity.
  it("returns the winner by reference when title preference is off", () => {
    const current = makeGame({ title: "Current", total: 1 });
    const incoming = makeGame({ title: "Incoming", total: 9 });
    expect(getRicherAchievementGame(current, incoming)).toBe(incoming);
  });

  it("keeps a real title when the richer game only has a placeholder", () => {
    const named = makeGame({ appId: "10", title: "Half-Life", total: 1 });
    const placeholder = makeGame({ appId: "10", title: "STEAM APP 10", total: 9 });

    const merged = getRicherAchievementGame(named, placeholder, {
      preferNonPlaceholderTitle: true,
    });

    expect(merged.title).toBe("Half-Life");
    // Achievement data still comes from the richer side.
    expect(merged.achievements.total).toBe(9);
  });

  it("leaves the title alone when the richer game already has a real one", () => {
    const placeholder = makeGame({ appId: "10", title: "STEAM APP 10", total: 1 });
    const named = makeGame({ appId: "10", title: "Half-Life", total: 9 });

    expect(
      getRicherAchievementGame(placeholder, named, { preferNonPlaceholderTitle: true }).title,
    ).toBe("Half-Life");
  });
});
