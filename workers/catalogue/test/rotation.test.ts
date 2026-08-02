import { describe, expect, it } from "vitest";
import {
  ROTATION_POOL_SIZE,
  rotatePool,
  rotates,
  rotationJitter,
  rotationSeed,
  type RotationEntry,
} from "../src/ranking";
import { parseSearch } from "../src/index";
import { canonicalSearchKey } from "../src/cache";
import { rotatedRowsSql } from "../src/catalogue";

function pool(size: number, tierOf: (index: number) => number): RotationEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    appId: String(1000 + index),
    tier: tierOf(index),
  }));
}

// Ten tiers of ten games each, already in ranked order.
const rankedPool = pool(100, (index) => 49 - Math.floor(index / 10));

describe("rotationSeed", () => {
  it("derives a stable YYYYMMDD seed from the UTC date", () => {
    expect(rotationSeed(new Date("2026-08-01T00:00:00Z"))).toBe(20260801);
    expect(rotationSeed(new Date("2026-08-01T23:59:59Z"))).toBe(20260801);
    expect(rotationSeed(new Date("2026-08-02T00:00:00Z"))).toBe(20260802);
  });

  it("holds the seed steady across a week when the period is weekly", () => {
    const monday = rotationSeed(new Date("2026-08-03T00:00:00Z"), "weekly");
    const saturday = rotationSeed(new Date("2026-08-08T00:00:00Z"), "weekly");
    const nextWeek = rotationSeed(new Date("2026-08-13T00:00:00Z"), "weekly");
    expect(saturday).toBe(monday);
    expect(nextWeek).not.toBe(monday);
  });
});

describe("rotationJitter", () => {
  it("is deterministic for the same app and seed", () => {
    expect(rotationJitter("413150", 20260801)).toBe(rotationJitter("413150", 20260801));
  });

  it("changes when either the app or the seed changes", () => {
    expect(rotationJitter("413150", 20260801)).not.toBe(rotationJitter("413150", 20260802));
    expect(rotationJitter("413150", 20260801)).not.toBe(rotationJitter("620", 20260801));
  });
});

describe("rotatePool", () => {
  it("returns the same order for the same seed", () => {
    expect(rotatePool(rankedPool, 20260801)).toEqual(rotatePool(rankedPool, 20260801));
  });

  it("returns a different order on the next period", () => {
    const today = rotatePool(rankedPool, 20260801).map((entry) => entry.appId);
    const tomorrow = rotatePool(rankedPool, 20260802).map((entry) => entry.appId);
    expect(tomorrow).not.toEqual(today);
  });

  it("preserves the exact set of games", () => {
    const rotated = rotatePool(rankedPool, 20260801);
    expect(rotated).toHaveLength(rankedPool.length);
    expect([...rotated].map((entry) => entry.appId).sort()).toEqual(
      [...rankedPool].map((entry) => entry.appId).sort()
    );
  });

  it("never moves a game across a tier boundary", () => {
    const rotated = rotatePool(rankedPool, 20260801);
    const tiers = rotated.map((entry) => entry.tier);
    expect(tiers).toEqual([...tiers].sort((left, right) => right - left));
    for (let index = 0; index < rotated.length; index += 1) {
      expect(rotated[index].tier).toBe(rankedPool[index].tier);
    }
  });

  it("actually reorders games inside a tier", () => {
    const rotated = rotatePool(rankedPool, 20260801).map((entry) => entry.appId);
    const ranked = rankedPool.map((entry) => entry.appId);
    expect(rotated).not.toEqual(ranked);
  });

  it("keeps a single-game tier pinned regardless of seed", () => {
    const singles = pool(5, (index) => 49 - index);
    for (const seed of [20260801, 20260802, 20261231]) {
      expect(rotatePool(singles, seed)).toEqual(singles);
    }
  });

  it("is stable for existing games when a new game is ingested", () => {
    const before = rotatePool(rankedPool, 20260801).map((entry) => entry.appId);
    const withNewGame = rotatePool([...rankedPool, { appId: "9999", tier: 40 }], 20260801);
    const after = withNewGame.map((entry) => entry.appId).filter((appId) => appId !== "9999");
    expect(after).toEqual(before);
  });
});

describe("rotates", () => {
  const search = (query: string) => parseSearch(new URL(`https://example.com/catalogue/search${query}`));

  it("rotates the plain popular listing", () => {
    expect(rotates(search("?limit=200&offset=0&seed=20260801"))).toBe(true);
  });

  it("does not rotate text searches or recentlyAdded", () => {
    expect(rotates(search("?q=portal&seed=20260801"))).toBe(false);
    expect(rotates(search("?sort=recentlyAdded&seed=20260801"))).toBe(false);
  });

  it("does not rotate facet-only requests", () => {
    expect(rotates(search("?facetsOnly=1&seed=20260801"))).toBe(false);
  });

  it("stops rotating past the pool and on pages that would straddle it", () => {
    expect(rotates(search(`?limit=200&offset=${ROTATION_POOL_SIZE - 200}&seed=20260801`))).toBe(true);
    expect(rotates(search(`?limit=200&offset=${ROTATION_POOL_SIZE - 100}&seed=20260801`))).toBe(false);
    expect(rotates(search(`?limit=200&offset=${ROTATION_POOL_SIZE}&seed=20260801`))).toBe(false);
  });

  it("still rotates filtered listings", () => {
    expect(rotates(search("?genres=Indie&limit=200&offset=0&seed=20260801"))).toBe(true);
  });
});

describe("rotatedRowsSql", () => {
  const page = (size: number) => Array.from({ length: size }, (_, index) => String(1000 + index));

  it("inlines ids instead of binding them", () => {
    // D1 caps a statement at 100 bind variables; a catalogue page holds 200
    // rows, so binding the ids fails with SQLITE_ERROR on the very first page.
    const sql = rotatedRowsSql(page(200));
    expect(sql).not.toContain("?");
    expect(sql).toContain("'1000'");
    expect(sql).toContain("'1199'");
  });

  it("quotes ids so the TEXT app_id column compares without affinity games", () => {
    expect(rotatedRowsSql(["1000"])).toContain("IN ('1000')");
  });

  it("drops anything that is not a plain app id", () => {
    const sql = rotatedRowsSql(["1000", "1'); DROP TABLE games;--", "abc", "12345678901"]);
    expect(sql).toBe(rotatedRowsSql(["1000"]));
  });

  it("returns null when nothing survives, rather than emitting IN ()", () => {
    expect(rotatedRowsSql([])).toBeNull();
    expect(rotatedRowsSql(["not-an-id"])).toBeNull();
  });
});

describe("rotation cache keys", () => {
  const search = (query: string) => parseSearch(new URL(`https://example.com/catalogue/search${query}`));

  it("separates one period from the next", () => {
    const today = canonicalSearchKey(search("?limit=200&seed=20260801"), "2026-01-01");
    const tomorrow = canonicalSearchKey(search("?limit=200&seed=20260802"), "2026-01-01");
    expect(today).not.toBe(tomorrow);
  });

  it("ignores the seed where rotation does not apply", () => {
    const first = canonicalSearchKey(search("?q=portal&seed=20260801"), "2026-01-01");
    const second = canonicalSearchKey(search("?q=portal&seed=20260802"), "2026-01-01");
    expect(first).toBe(second);
  });

  it("separates match=any from match=all", () => {
    const all = canonicalSearchKey(search("?genres=RPG&limit=20"), "2026-01-01");
    const any = canonicalSearchKey(search("?genres=RPG&limit=20&match=any"), "2026-01-01");
    expect(all).not.toBe(any);
  });
});
