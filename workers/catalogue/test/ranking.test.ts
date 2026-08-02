import { describe, expect, it } from "vitest";
import { rankingScore, rankingTier } from "../src/ranking";

const stardewValley = {
  steamReviewCount: 886195,
  steamPositiveRatio: 0.9844,
  metacriticScore: 89,
  recommendations: 821472,
};
const indie2k = { steamReviewCount: 2000, steamPositiveRatio: 0.9, metacriticScore: 0, recommendations: 1500 };
const blockbuster = { steamReviewCount: 300000, steamPositiveRatio: 0.65, metacriticScore: 70, recommendations: 250000 };
const tiny12 = { steamReviewCount: 12, steamPositiveRatio: 1, metacriticScore: 0, recommendations: 10 };
const metacriticOnly = { steamReviewCount: 0, steamPositiveRatio: 0, metacriticScore: 95, recommendations: 0 };
const mixed50k = { steamReviewCount: 50000, steamPositiveRatio: 0.3, metacriticScore: 0, recommendations: 40000 };

describe("rankingScore", () => {
  it("ranks a well-reviewed, high-volume game above everything else", () => {
    expect(rankingScore(stardewValley)).toBeGreaterThan(rankingScore(blockbuster));
    expect(rankingScore(blockbuster)).toBeGreaterThan(rankingScore(indie2k));
    expect(rankingScore(indie2k)).toBeGreaterThan(rankingScore(mixed50k));
    expect(rankingScore(mixed50k)).toBeGreaterThan(rankingScore(tiny12));
  });

  it("shrinks small-sample perfect ratios instead of letting them dominate", () => {
    expect(rankingScore(tiny12)).toBeLessThan(0.2);
    expect(rankingScore(tiny12)).toBeLessThan(rankingScore(indie2k));
  });

  it("never lets a bare metacritic score alone reach the top", () => {
    expect(rankingScore(metacriticOnly)).toBeLessThan(0.2);
    expect(rankingScore(metacriticOnly)).toBeLessThan(rankingScore(mixed50k));
  });

  it("does not let high volume alone beat a well-reviewed lower-volume game", () => {
    expect(rankingScore(mixed50k)).toBeLessThan(rankingScore(indie2k));
  });

  it("stays within a 0..1 range for realistic inputs", () => {
    for (const inputs of [stardewValley, indie2k, blockbuster, tiny12, metacriticOnly, mixed50k]) {
      const score = rankingScore(inputs);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("rankingTier", () => {
  it("buckets scores into coarse integer tiers", () => {
    expect(rankingTier(stardewValley)).toBe(Math.trunc(rankingScore(stardewValley) * 50));
    expect(Number.isInteger(rankingTier(stardewValley))).toBe(true);
  });

  it("keeps the tier ordering consistent with the underlying score ordering", () => {
    const ranked = [stardewValley, blockbuster, indie2k, mixed50k, tiny12].map(rankingTier);
    const sorted = [...ranked].sort((a, b) => b - a);
    expect(ranked).toEqual(sorted);
  });
});
