import { rotates } from "./ranking";
import type { SearchRequest } from "./types";

export const CACHE_VERSION = "catalogue-v4-ranking-score";

export type CacheRoute = "facets" | "search" | "game" | "home";

export function searchTtl(request: SearchRequest): number {
  if (request.facetsOnly) return 24 * 60 * 60;
  if (request.sort === "recentlyAdded") return 5 * 60;
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
    match: request.match,
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
