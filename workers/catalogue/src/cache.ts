import { rotates } from "./ranking";
import type { SearchRequest } from "./types";

export const CACHE_VERSION = "catalogue-v10-title-relevance";

export type CacheRoute = "facets" | "search" | "game" | "home" | "meta" | "count";

const pendingValues = new Map<string, Promise<unknown>>();

export async function cachedValue<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  if (typeof caches === "undefined") return load();
  const cache = (caches as CacheStorage & { default: Cache }).default;
  if (!cache) return load();
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    try { return await hit.json<T>(); } catch { /* Reload malformed cache entries. */ }
  }
  const pending = pendingValues.get(key);
  if (pending) return pending as Promise<T>;
  const promise = (async () => {
    const value = await load();
    await cache.put(key, new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    })).catch(() => undefined);
    return value;
  })();
  pendingValues.set(key, promise);
  try { return await promise; } finally { pendingValues.delete(key); }
}

export function countCacheKey(request: SearchRequest, updatedAt: string, origin: string): string {
  const normalized = {
    ...request,
    limit: 0,
    offset: 0,
    seed: 0,
    includeFacets: false,
    facetsOnly: false,
    sort: request.sort === "playingNow" ? "playingNow" as const : "popular" as const,
  };
  return cacheKey("count", canonicalSearchKey(normalized, updatedAt, origin), updatedAt);
}

export function searchTtl(request: SearchRequest): number {
  if (request.facetsOnly) return 24 * 60 * 60;
  if (request.sort === "recentlyAdded") return 5 * 60;
  // Player counts are semi-live (SteamSpy samples), not catalogue-static.
  if (request.sort === "playingNow") return 5 * 60;
  const filtered = request.q.length > 0 || Object.values(request.filters).some((v) => v.length > 0);
  return filtered ? 10 * 60 : 60 * 60;
}

export function canonicalSearchKey(request: SearchRequest, updatedAt: string, origin = ""): string {
  const params = new URLSearchParams({
    v: CACHE_VERSION,
    updatedAt,
    origin,
    q: request.q,
    limit: String(request.limit),
    offset: String(request.offset),
    sort: request.sort,
    includeFacets: request.includeFacets ? "1" : "0",
    facetsOnly: request.facetsOnly ? "1" : "0",
    seed: String(rotates(request) ? request.seed : 0),
  });
  for (const [name, values] of Object.entries(request.filters)) {
    for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b))) {
      params.append(name, value);
    }
  }
  return `https://catalogue-cache.invalid/search?${params.toString()}`;
}

export function cacheKey(route: Exclude<CacheRoute, "search">, id: string, updatedAt: string): string {
  const params = new URLSearchParams({ v: CACHE_VERSION, updatedAt, id });
  return `https://catalogue-cache.invalid/${route}?${params.toString()}`;
}

export function cacheControl(ttl: number): string {
  return `public, max-age=${Math.min(ttl, 300)}`;
}

export function cloudflareCacheControl(ttl: number): string {
  return `public, max-age=${ttl}, stale-while-revalidate=86400`;
}

export function imageCacheControl(options: { immutable?: boolean } = {}): string {
  if (options.immutable) return "public, max-age=31536000, immutable";
  return "public, max-age=86400, stale-while-revalidate=604800";
}

export function imageNegativeCacheControl(status: number): string {
  const ttl = status === 404 ? 1800 : 30;
  return `public, max-age=${ttl}, stale-while-revalidate=${ttl}`;
}
