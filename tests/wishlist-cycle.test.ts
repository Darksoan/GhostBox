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
    expiresAt: "2026-08-04T00:00:00.000Z",
    gameIds: ["1", "2", "3", "4"],
    history: [["1", "2", "3", "4"]],
    ...overrides,
  };
}

describe("wishlist cycle", () => {
  it("anchors the cycle to the local start of the day", () => {
    expect(getWishlistCycleStart(new Date(2026, 7, 3, 14)).getTime()).toBe(
      new Date(2026, 7, 3).getTime()
    );
    expect(getWishlistCycleStart(new Date(2026, 7, 3, 23, 59)).getTime()).toBe(
      new Date(2026, 7, 3).getTime()
    );
    expect(getWishlistCycleStart(new Date(2026, 7, 4, 0, 1)).getTime()).toBe(
      new Date(2026, 7, 4).getTime()
    );
  });

  it("advances source rotation once per day", () => {
    const first = getWishlistCycleIndex(new Date(2026, 7, 3));
    expect(getWishlistCycleIndex(new Date(2026, 7, 3, 22))).toBe(first);
    expect(getWishlistCycleIndex(new Date(2026, 7, 4))).toBe(first + 1);
    expect(getWishlistCycleIndex(new Date(2026, 7, 10))).toBe(first + 7);
  });

  it("expires the cycle at the next local midnight", () => {
    const cycle = createWishlistCycle({
      steamId: "steam-user",
      selectedGames: [game("10"), game("11"), game("12"), game("13")],
      storedCycle: null,
      cycleStart: new Date(2026, 7, 3, 18),
    });
    expect(cycle.cycleStart).toBe(new Date(2026, 7, 3).toISOString());
    expect(cycle.expiresAt).toBe(new Date(2026, 7, 4).toISOString());
  });

  it("rejects stale, mismatched, incomplete, or expired cycles", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    expect(isStoredWishlistCycleFresh(stored(), "steam-user", 4, now)).toBe(true);
    expect(isStoredWishlistCycleFresh(stored({ algorithmVersion: "old" }), "steam-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored(), "other-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored({ gameIds: ["1"] }), "steam-user", 4, now)).toBe(false);
    expect(isStoredWishlistCycleFresh(stored({ expiresAt: "2026-08-03T11:00:00.000Z" }), "steam-user", 4, now)).toBe(false);
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

  it("prepends new cycle to history and keeps a week of past days", () => {
    const previous = stored({
      history: [["old-1"], ["old-2"], ["old-3"], ["old-4"], ["old-5"], ["old-6"], ["old-7"]],
    });
    const cycle = createWishlistCycle({
      steamId: "steam-user",
      selectedGames: [game("10"), game("11"), game("12"), game("13")],
      storedCycle: previous,
      cycleStart: new Date(2026, 7, 10, 14),
    });
    expect(cycle.history).toEqual([
      ["10", "11", "12", "13"],
      ["old-1"],
      ["old-2"],
      ["old-3"],
      ["old-4"],
      ["old-5"],
      ["old-6"],
    ]);
  });

  it("replaces only the current day when regenerating same cycle", () => {
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
    });
    expect(cycle.history).toEqual([
      ["20", "21", "22", "23"],
      ["old-1"],
      ["old-2"],
      ["old-3"],
    ]);
  });
});
