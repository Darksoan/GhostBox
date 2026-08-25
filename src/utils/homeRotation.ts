/**
 * Weekly rotation for the Home shelves.
 *
 * The seed mirrors `rotationSeed(now, "weekly")` em
 * `workers/catalogue/src/ranking.ts` byte for byte: the worker only ever uses
 * the number the client sends, so the *cadence* is a client decision. Sending a
 * weekly seed makes `rotatePool` reshuffle each ranking tier once a week, and
 * makes the Rust disk cache (`src-tauri/src/catalogue_cache.rs`) roll its key
 * over on the same boundary instead of pinning a stale order.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// The epoch fell on a Thursday; +3 days shifts the bucket boundary to Monday
// so a "week" matches what a user would call one. Same constant as the worker.
const EPOCH_MONDAY_OFFSET_DAYS = 3;

/** Week index since the epoch, Monday-aligned. Stable for 7 days, always > 0. */
export function homeRotationSeed(now: Date = new Date()): number {
  return Math.floor(
    (Math.floor(now.getTime() / DAY_MS) + EPOCH_MONDAY_OFFSET_DAYS) / 7
  );
}

/** UTC Monday 00:00 that opens the current rotation cycle. */
export function homeRotationCycleStart(now: Date = new Date()): Date {
  const seed = homeRotationSeed(now);
  return new Date((seed * 7 - EPOCH_MONDAY_OFFSET_DAYS) * DAY_MS);
}

/** Milliseconds until the next cycle opens — used as a cache expiry. */
export function homeRotationCycleEnd(now: Date = new Date()): Date {
  return new Date(homeRotationCycleStart(now).getTime() + WEEK_MS);
}

/**
 * Position-independent integer mix. Same avalanche as `rotationJitter` in the
 * catalogue worker, but keyed by an arbitrary string so each shelf can derive
 * its own offset from the shared weekly seed — without a salt, two shelves
 * reading overlapping pools would show the same slice every week.
 */
export function rotationHash(seed: number, salt: string): number {
  let hash = (seed >>> 0) ^ 2166136261;
  for (let index = 0; index < salt.length; index += 1) {
    hash = Math.imul(hash ^ salt.charCodeAt(index), 16777619) >>> 0;
  }
  hash = Math.imul(hash, 2654435761) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}

type RotationWindowOptions = {
  seed: number;
  count: number;
  salt: string;
};

/**
 * Deterministic slice of `pool`, wrapping around the end. A pool of 200 with a
 * window of 8 gives 200 distinct starting points, so the shelf can run for
 * years before repeating an arrangement — and re-renders inside the same week
 * always produce the identical list.
 */
export function pickRotationWindow<T>(
  pool: readonly T[],
  { seed, count, salt }: RotationWindowOptions
): T[] {
  if (pool.length === 0 || count <= 0) return [];
  if (pool.length <= count) return [...pool];

  const offset = rotationHash(seed, salt) % pool.length;
  return Array.from({ length: count }, (_, index) => pool[(offset + index) % pool.length]);
}

/**
 * Deterministic Fisher–Yates shuffle keyed by the weekly seed + salt.
 *
 * Where `pickRotationWindow` keeps the pool's relative order (a contiguous
 * slice), this permutes it — the "Most played" rail wants a random handful of
 * the ranking, not the top-N in descending order. Same contract as the window:
 * stable inside the week, a different arrangement every Monday.
 *
 * The LCG state starts from the shelf's hash; the multiplier/addend are the
 * classic Numerical Recipes pair, so the same seed+salt always yields the same
 * permutation while neighbours in state still jump around.
 */
export function shuffledRotation<T>(
  pool: readonly T[],
  { seed, salt }: { seed: number; salt: string }
): T[] {
  const result = [...pool];
  if (result.length < 2) return result;

  let state = rotationHash(seed, salt) >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
