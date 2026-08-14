import { describe, expect, it } from "vitest";
import {
  homeRotationCycleEnd,
  homeRotationCycleStart,
  homeRotationSeed,
  pickRotationWindow,
  rotationHash,
} from "../src/utils/homeRotation";
// Cross-project import on purpose: this is the contract between the client
// seed and the worker's `rotatePool`. Nothing type-checks it (the root
// tsconfig only includes `src/`), so this suite is the only thing that catches
// the two implementations drifting apart.
import { rotationSeed } from "../workers/catalogue/src/ranking";

describe("homeRotationSeed", () => {
  it("matches the catalogue worker's weekly seed", () => {
    const dates = [
      new Date("2026-08-14T20:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-06-30T23:59:59Z"),
    ];

    dates.forEach((date) => {
      expect(homeRotationSeed(date)).toBe(rotationSeed(date, "weekly"));
    });
  });

  it("stays stable across a whole week and flips at the Monday boundary", () => {
    const monday = new Date("2026-08-10T00:00:00Z");
    const sunday = new Date("2026-08-16T23:59:59Z");
    const nextMonday = new Date("2026-08-17T00:00:00Z");

    expect(homeRotationSeed(sunday)).toBe(homeRotationSeed(monday));
    expect(homeRotationSeed(nextMonday)).toBe(homeRotationSeed(monday) + 1);
  });

  it("round-trips through the cycle start", () => {
    const now = new Date("2026-08-14T20:00:00Z");
    const start = homeRotationCycleStart(now);

    expect(start.getUTCDay()).toBe(1);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(homeRotationSeed(start)).toBe(homeRotationSeed(now));
    expect(homeRotationCycleEnd(now).getTime() - start.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000
    );
    // The instant before the cycle end still belongs to the same cycle.
    expect(
      homeRotationSeed(new Date(homeRotationCycleEnd(now).getTime() - 1))
    ).toBe(homeRotationSeed(now));
  });
});

describe("pickRotationWindow", () => {
  const pool = Array.from({ length: 50 }, (_, index) => index);

  it("is deterministic for the same seed and salt", () => {
    const first = pickRotationWindow(pool, { seed: 2900, count: 8, salt: "trending" });
    const second = pickRotationWindow(pool, { seed: 2900, count: 8, salt: "trending" });

    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
  });

  it("never repeats an entry inside one window", () => {
    for (let seed = 2900; seed < 2960; seed += 1) {
      const window = pickRotationWindow(pool, { seed, count: 12, salt: "top-rated" });
      expect(new Set(window).size).toBe(window.length);
    }
  });

  it("wraps around the end of the pool instead of returning a short window", () => {
    // A salt/seed pair whose offset lands near the tail still fills the window.
    const offsets = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const window = pickRotationWindow(pool, { seed, count: 8, salt: "wrap" });
      expect(window).toHaveLength(8);
      offsets.add(window[0]);
    }

    // Many distinct starting points — a fixed offset would collapse this to one.
    expect(offsets.size).toBeGreaterThan(10);
  });

  it("returns the whole pool when it is not bigger than the window", () => {
    expect(pickRotationWindow([1, 2, 3], { seed: 7, count: 8, salt: "small" })).toEqual([
      1, 2, 3,
    ]);
    expect(pickRotationWindow([], { seed: 7, count: 8, salt: "empty" })).toEqual([]);
    expect(pickRotationWindow(pool, { seed: 7, count: 0, salt: "none" })).toEqual([]);
  });

  it("gives different shelves different slices of the same pool", () => {
    const seed = homeRotationSeed(new Date("2026-08-14T20:00:00Z"));
    const recommended = pickRotationWindow(pool, { seed, count: 8, salt: "recommended" });
    const topRated = pickRotationWindow(pool, { seed, count: 8, salt: "top-rated" });

    expect(recommended).not.toEqual(topRated);
  });
});

describe("rotationHash", () => {
  it("spreads consecutive seeds instead of clustering them", () => {
    // A weak mix (e.g. dropping the avalanche shifts) would map neighbouring
    // week seeds onto neighbouring offsets, so a rail would creep one game per
    // week instead of jumping. Sample the offsets a 200-item pool would use.
    const offsets = Array.from({ length: 40 }, (_, index) =>
      rotationHash(2900 + index, "recommended") % 200
    );

    expect(new Set(offsets).size).toBeGreaterThan(30);

    const consecutiveNeighbours = offsets.filter(
      (offset, index) => index > 0 && Math.abs(offset - offsets[index - 1]) <= 2
    );
    expect(consecutiveNeighbours.length).toBeLessThan(4);
  });

  it("changes when either the seed or the salt changes", () => {
    expect(rotationHash(2900, "a")).not.toBe(rotationHash(2901, "a"));
    expect(rotationHash(2900, "a")).not.toBe(rotationHash(2900, "b"));
  });
});
