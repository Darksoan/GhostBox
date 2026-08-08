import { describe, expect, it } from "vitest";
import { createSeedGame } from "../src/utils/gameSeed";
import {
  createWishlistCycle,
  getWishlistCycleIndex,
  getWishlistCycleStart,
  isStoredWishlistCycleFresh,
  pickWishlistCycleGames,
  wishlistCycleAlgorithmVersion,
} from "../src/utils/wishlistCycle";
import type { StoredSteamWishlistCycle } from "../src/utils/storage";

function game(appId: string, tags: string[] = ["Action"]) {
  return {
    ...createSeedGame({ appId, title: `Game ${appId}` }, Number(appId) || 0, ""),
    tags,
  };
}

function stored(overrides: Partial<StoredSteamWishlistCycle> = {}): StoredSteamWishlistCycle {
  return {
    steamId: "steam-user",
    algorithmVersion: wishlistCycleAlgorithmVersion,
    cycleStart: "2026-08-03T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
    gameIds: ["1", "2", "3", "4"],
    history: [["1", "2", "3", "4"]],
    ...overrides,
  };
}

describe("wishlist cycle", () => {
  it("anchors every day to same local Monday and rolls next week", () => {
    const monday = new Date(2026, 7, 3, 14);
    expect(getWishlistCycleStart(monday).getTime()).toBe(new Date(2026, 7, 3).getTime());
    expect(getWishlistCycleStart(new Date(2026, 7, 9, 23)).getTime()).toBe(
      new Date(2026, 7, 3).getTime()
    );
    expect(getWishlistCycleStart(new Date(2026, 7, 10, 1)).getTime()).toBe(
      new Date(2026, 7, 10).getTime()
    );
  });

  it("advances source rotation for consecutive weeks", () => {
    const first = getWishlistCycleIndex(new Date(2026, 7, 3));
    expect(getWishlistCycleIndex(new Date(2026, 7, 10))).toBe(first + 1);
    expect(first % 7).not.toBe((first + 1) % 7);
  });

  it("rejects stale, mismatched, incomplete, or expired cycles", () => {
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    expect(isStoredWishlistCycleFresh(stored(), "steam-user", 4, now)).toBe(true);
    expect(isStoredWishlistCycleFresh(stored({ algorithmVersion: "old" }), "steam-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored(), "other-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored({ gameIds: ["1"] }), "steam-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored({ expiresAt: "2026-08-03T23:00:00.000Z" }), "steam-user", 4, now)).toBe(false);
  });

  it("selects four unique candidates outside exclusions and history", () => {
    const candidates = Array.from({ length: 10 }, (_, index) => game(String(index + 1)));
    const selected = pickWishlistCycleGames(candidates, {
      gameCount: 4,
      excludedAppIds: new Set(["1", "2", "3", "4", "5"]),
    });
    expect(selected).toHaveLength(4);
    expect(new Set(selected.map((item) => item.appId)).size).toBe(4);
    expect(selected.every((item) => Number(item.appId) > 5)).toBe(true);
  });

  it("prepends new cycle to history and limits history size", () => {
    const previous = stored({ history: [["old-1"], ["old-2"], ["old-3"], ["old-4"]] });
    const cycle = createWishlistCycle({
      steamId: "steam-user",
      selectedGames: [game("10"), game("11"), game("12"), game("13")],
      storedCycle: previous,
      cycleStart: new Date(2026, 7, 10, 14),
      refreshMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(cycle.history).toEqual([["10", "11", "12", "13"], ["old-1"], ["old-2"], ["old-3"]]);
  });

  it("replaces only current week when regenerating same cycle", () => {
    const cycleStart = new Date(2026, 7, 3);
    const previous = stored({
      cycleStart: cycleStart.toISOString(),
      history: [["current"], ["old-1"], ["old-2"], ["old-3"]],
    });
    const cycle = createWishlistCycle({
      steamId: "steam-user",
      selectedGames: [game("20"), game("21"), game("22"), game("23")],
      storedCycle: previous,
      cycleStart,
      refreshMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(cycle.history).toEqual([
      ["20", "21", "22", "23"],
      ["old-1"],
      ["old-2"],
      ["old-3"],
    ]);
  });
});
