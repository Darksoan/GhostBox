import { describe, expect, it } from "vitest";
import { catalogueRotationSeed } from "../src/utils/rotation";
import { normalizeGameRequest } from "../src/queries/games";

describe("catalogueRotationSeed", () => {
  it("produces a YYYYMMDD seed from the UTC date", () => {
    expect(catalogueRotationSeed(new Date("2026-08-01T00:00:00Z"))).toBe(20260801);
    expect(catalogueRotationSeed(new Date("2026-12-31T23:59:59Z"))).toBe(20261231);
  });

  it("holds steady across a day and rolls over at UTC midnight", () => {
    expect(catalogueRotationSeed(new Date("2026-08-01T23:59:59Z"))).toBe(
      catalogueRotationSeed(new Date("2026-08-01T00:00:00Z"))
    );
    expect(catalogueRotationSeed(new Date("2026-08-02T00:00:00Z"))).not.toBe(
      catalogueRotationSeed(new Date("2026-08-01T00:00:00Z"))
    );
  });
});

describe("game request normalization", () => {
  it("keeps the seed in the query key so a new period refetches", () => {
    const today = normalizeGameRequest({ limit: 200, seed: 20260801 });
    const tomorrow = normalizeGameRequest({ limit: 200, seed: 20260802 });
    expect(today.seed).toBe(20260801);
    expect(today).not.toEqual(tomorrow);
  });

  it("defaults to a rotation-disabled seed when none is given", () => {
    expect(normalizeGameRequest({}).seed).toBe(0);
  });
});
