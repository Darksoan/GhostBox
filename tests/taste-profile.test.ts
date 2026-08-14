import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { createSeedGame } from "../src/utils/gameSeed";
import {
  buildTasteProfile,
  getTopTasteTraits,
  scoreGameAgainstTaste,
  steamRecommendedTagNames,
} from "../src/utils/tasteProfile";

function game(
  appId: string,
  overrides: Partial<GhostBoxGame> = {}
): GhostBoxGame {
  return {
    ...createSeedGame({ appId, title: `Game ${appId}` }, Number(appId) || 0, ""),
    genres: ["Action"],
    ...overrides,
  };
}

describe("buildTasteProfile", () => {
  it("weights a heavily played game above a barely played one", () => {
    const profile = buildTasteProfile({
      libraryGames: [
        game("1", { genres: ["RPG"], playTimeInMilliseconds: 400 * 3_600_000 }),
        game("2", { genres: ["Racing"], playTimeInMilliseconds: 10 * 60_000 }),
      ],
    });

    expect(profile.traits.get("rpg")).toBeGreaterThan(
      profile.traits.get("racing") ?? 0
    );
    expect(getTopTasteTraits(profile, 1)).toEqual(["rpg"]);
  });

  it("counts favourites even with no playtime at all", () => {
    const profile = buildTasteProfile({
      favoriteGames: [game("3", { genres: ["Horror"], hours: 0 })],
    });

    expect(profile.traits.get("horror")).toBeGreaterThan(0);
    expect(profile.isEmpty).toBe(false);
  });

  it("falls back to the hours column when playTimeInMilliseconds is absent", () => {
    const withMs = buildTasteProfile({
      libraryGames: [game("4", { genres: ["Strategy"], playTimeInMilliseconds: 50 * 3_600_000 })],
    });
    const withHours = buildTasteProfile({
      libraryGames: [game("5", { genres: ["Strategy"], hours: 50 })],
    });

    expect(withHours.traits.get("strategy")).toBeCloseTo(
      withMs.traits.get("strategy") ?? 0,
      10
    );
  });

  it("treats a zero-playtime library game the same in weight and seed eligibility", () => {
    const profile = buildTasteProfile({
      libraryGames: [
        game("6", { genres: ["Puzzle"], playTimeInMilliseconds: 0, hours: 99 }),
      ],
    });

    // playTimeInMilliseconds: 0 is authoritative — the stale `hours` column
    // must not resurrect the game as the seed or inflate its weight.
    expect(profile.seedGame).toBeNull();
    expect(profile.traits.get("puzzle")).toBe(1);
  });

  it("normalizes Portuguese traits onto the shared vocabulary", () => {
    const profile = buildTasteProfile({
      libraryGames: [game("7", { genres: ["Ação"], tags: ["terror"] })],
    });

    expect([...profile.traits.keys()].sort()).toEqual(["action", "horror"]);
  });

  it("reports an empty profile for a brand-new user", () => {
    const profile = buildTasteProfile({});

    expect(profile.isEmpty).toBe(true);
    expect(profile.seedGame).toBeNull();
    expect(profile.traits.size).toBe(0);
  });

  it("picks the most-played game as the seed, breaking ties by last session", () => {
    const older = game("8", {
      playTimeInMilliseconds: 20 * 3_600_000,
      lastTimePlayed: "2026-01-01T00:00:00.000Z",
    });
    const newer = game("9", {
      playTimeInMilliseconds: 20 * 3_600_000,
      lastTimePlayed: "2026-08-01T00:00:00.000Z",
    });
    const mostPlayed = game("10", { playTimeInMilliseconds: 30 * 3_600_000 });

    expect(buildTasteProfile({ libraryGames: [older, newer] }).seedGame?.appId).toBe("9");
    expect(
      buildTasteProfile({ libraryGames: [older, newer, mostPlayed] }).seedGame?.appId
    ).toBe("10");
  });

  it("never seeds on a placeholder Steam title", () => {
    const profile = buildTasteProfile({
      libraryGames: [
        {
          ...game("11", { playTimeInMilliseconds: 100 * 3_600_000 }),
          title: "Steam 11",
        },
      ],
    });

    expect(profile.seedGame).toBeNull();
  });
});

describe("scoreGameAgainstTaste", () => {
  it("ranks a matching game above a better-reviewed mismatch", () => {
    const profile = buildTasteProfile({
      libraryGames: [game("1", { genres: ["Horror"], playTimeInMilliseconds: 100 * 3_600_000 })],
    });
    const match = game("20", {
      genres: ["Horror"],
      steamPositiveRatio: 0.7,
      steamReviewCount: 500,
    });
    const mismatch = game("21", {
      genres: ["Sports"],
      steamPositiveRatio: 0.98,
      steamReviewCount: 900_000,
    });

    expect(scoreGameAgainstTaste(match, profile)).toBeGreaterThan(
      scoreGameAgainstTaste(mismatch, profile)
    );
  });

  it("falls back to pure quality ranking for an empty profile", () => {
    const profile = buildTasteProfile({});
    const good = game("22", { steamPositiveRatio: 0.95, steamReviewCount: 100_000 });
    const weak = game("23", { steamPositiveRatio: 0.4, steamReviewCount: 100 });

    expect(scoreGameAgainstTaste(good, profile)).toBeGreaterThan(
      scoreGameAgainstTaste(weak, profile)
    );
  });
});

describe("steamRecommendedTagNames", () => {
  it("accepts every key spelling Steam returns and dedupes the result", () => {
    expect(
      steamRecommendedTagNames([
        { name: "Ação" },
        { tag_name: "action" },
        { tagName: "Horror" },
        { weight: 3 },
      ])
    ).toEqual(["Action", "Horror"]);
  });

  it("survives a missing payload", () => {
    expect(steamRecommendedTagNames()).toEqual([]);
    expect(steamRecommendedTagNames([])).toEqual([]);
  });
});
