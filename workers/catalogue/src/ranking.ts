import type { SearchRequest } from "./types";

// Bayesian-shrunk quality score. Keep this expression byte-identical to the
// generated column in migrations/0002_ranking_score.sql.
export const RANKING_SCORE_SQL = `(
  (0.72 * ((steam_positive_ratio * steam_review_count + 0.70 * 1500) / (steam_review_count + 1500))
   + 0.20 * (CAST(steam_review_count AS REAL) / (steam_review_count + 25000.0))
   + 0.08 * (CAST(metacritic_score AS REAL) / 100.0))
  * (0.25 + 0.75 * (CAST(steam_review_count + recommendations AS REAL) / (steam_review_count + recommendations + 500.0)))
)`;

export const RANKING_ORDER = `ranking_tier DESC,
CAST(app_id AS INTEGER) ASC`;

interface RankingInputs {
  steamReviewCount: number;
  steamPositiveRatio: number;
  metacriticScore: number;
  recommendations: number;
}

export function rankingScore({
  steamReviewCount,
  steamPositiveRatio,
  metacriticScore,
  recommendations,
}: RankingInputs): number {
  const bayes = (steamPositiveRatio * steamReviewCount + 0.7 * 1500) / (steamReviewCount + 1500);
  const volume = steamReviewCount / (steamReviewCount + 25000);
  const mc = metacriticScore / 100;
  const evidence = (steamReviewCount + recommendations) / (steamReviewCount + recommendations + 500);
  return (0.72 * bayes + 0.2 * volume + 0.08 * mc) * (0.25 + 0.75 * evidence);
}

export function rankingTier(inputs: RankingInputs): number {
  return Math.trunc(rankingScore(inputs) * 50);
}

export type RotationPeriod = "daily" | "weekly";

// Single switch for how often the catalogue reshuffles.
export const ROTATION_PERIOD: RotationPeriod = "daily";

// Must stay a multiple of the client chunk size (200) so an aligned page never
// straddles the pool boundary. 2000 = 10 chunks = 100 pages of rotation.
export const ROTATION_POOL_SIZE = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function rotationSeed(now: Date, period: RotationPeriod = ROTATION_PERIOD): number {
  if (period === "weekly") {
    // The epoch fell on a Thursday; +3 days shifts the bucket boundary to Monday
    // so a "week" matches what a user would call one.
    return Math.floor((Math.floor(now.getTime() / DAY_MS) + 3) / 7);
  }
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

// Position-independent jitter: derived from the app id alone, so ingesting a new
// game reshuffles nothing else. A stateful PRNG walked over the pool would shift
// every entry after the insertion point.
export function rotationJitter(appId: string, seed: number): number {
  const numeric = Number.parseInt(appId, 10) || 0;
  let hash = Math.imul((seed >>> 0) ^ numeric, 2654435761) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}

/**
 * Rotation applies only to the unfiltered-order case. A text query is ranked by
 * relevance and `recentlyAdded` by recency — reshuffling either would be wrong.
 * Pages that straddle the pool boundary opt out so a page can never mix
 * rotated and unrotated rows.
 */
export function rotates(request: SearchRequest): boolean {
  return !request.facetsOnly
    && request.q.length === 0
    && request.sort === "popular"
    && request.seed > 0
    && request.offset + request.limit <= ROTATION_POOL_SIZE;
}

export interface RotationEntry {
  appId: string;
  tier: number;
}

/**
 * Reorders a ranked pool within each `ranking_tier` bucket. Games of near-equal
 * quality trade places every period; a great game never crosses into a lower
 * tier, so the top of the catalogue stays good while staying fresh.
 */
export function rotatePool<T extends RotationEntry>(entries: readonly T[], seed: number): T[] {
  return [...entries].sort((left, right) => {
    if (left.tier !== right.tier) return right.tier - left.tier;
    const leftJitter = rotationJitter(left.appId, seed);
    const rightJitter = rotationJitter(right.appId, seed);
    if (leftJitter !== rightJitter) return leftJitter - rightJitter;
    return Number(left.appId) - Number(right.appId);
  });
}
