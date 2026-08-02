/**
 * Rotation seed for the catalogue listing.
 *
 * Mirrors `rotationSeed` in workers/catalogue/src/ranking.ts and
 * `rotation_seed` in src-tauri/src/catalogue_cache.rs. The client sends the
 * seed explicitly so the Rust disk cache — which keeps entries usable for a
 * week — rolls its key over with the period instead of pinning a stale order.
 */
export function catalogueRotationSeed(now: Date = new Date()): number {
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}
