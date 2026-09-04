import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedValue, cacheKey, countCacheKey } from "../src/cache";
import { invalidateCatalogueMetaCache, searchCatalogue } from "../src/catalogue";
import worker, { parseSearch } from "../src/index";
import type { Env } from "../src/types";

const origin = "https://example.com";
const search = (query: string) => parseSearch(new URL(`${origin}/catalogue/search?${query}`));
const metadata = { total: 3, updatedAt: "revision-1", steamspySampledAt: "never" };

beforeEach(() => {
  invalidateCatalogueMetaCache();
  const entries = new Map<string, { response: Response; expiresAt: number }>();
  vi.stubGlobal("caches", { default: {
    match: vi.fn(async (key: string) => {
      const entry = entries.get(key);
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined;
    }),
    put: vi.fn(async (key: string, response: Response) => {
      const ttl = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1]);
      entries.set(key, { response: response.clone(), expiresAt: Date.now() + ttl * 1000 });
    }),
    delete: vi.fn(async (key: string) => entries.delete(key)),
  } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("D1 read cache", () => {
  it("shares concurrent loads, reuses cached results and refreshes after expiry", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ matched: 3 }));
    const key = cacheKey("count", "test", "revision-1");
    await Promise.all([cachedValue(key, 300, load), cachedValue(key, 300, load)]);
    expect(await cachedValue(key, 300, load)).toEqual({ matched: 3 });
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300_001);
    await cachedValue(key, 300, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache database errors", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("D1 unavailable")).mockResolvedValue({ matched: 2 });
    await expect(cachedValue("https://cache.invalid/error", 300, load)).rejects.toThrow("D1 unavailable");
    await expect(cachedValue("https://cache.invalid/error", 300, load)).resolves.toEqual({ matched: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares counts across pages, sort order and equivalent filters", () => {
    const first = search("tags=RPG&tags=Action&offset=0&limit=20&includeFacets=1");
    const next = search("tags=Action&tags=RPG&offset=200&limit=200&sort=recentlyAdded");
    expect(countCacheKey(first, "v1", origin)).toBe(countCacheKey(next, "v1", origin));
    expect(countCacheKey(first, "v1", origin)).not.toBe(countCacheKey(first, "v2", origin));
    expect(countCacheKey(first, "v1", origin)).not.toBe(countCacheKey(search("tags=Puzzle"), "v1", origin));
    expect(countCacheKey(first, "v1", origin)).not.toBe(countCacheKey(search("tags=RPG&tags=Action&sort=playingNow"), "v1", origin));
  });

  it("executes COUNT once across pages and again after a catalogue update", async () => {
    const count = vi.fn(async () => ({ matched: 3 }));
    const rows = vi.fn(async () => ({ results: [] }));
    const db = { prepare: vi.fn(() => ({ bind: () => ({ first: count, all: rows }) })) } as unknown as D1Database;
    for (const offset of [0, 20, 40]) {
      await searchCatalogue(db, search(`q=portal&offset=${offset}`), 3, origin, undefined, null, "v1");
    }
    expect(count).toHaveBeenCalledTimes(1);
    expect(rows).toHaveBeenCalledTimes(3);
    await searchCatalogue(db, search("q=portal"), 3, origin, undefined, null, "v2");
    expect(count).toHaveBeenCalledTimes(2);
  });

  it("serves metadata from edge cache without querying D1 on a cold isolate", async () => {
    await cachedValue(cacheKey("meta", origin, "v1"), 300, async () => metadata);
    const prepare = vi.fn(() => { throw new Error("D1 must not be queried"); });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const response = await worker.fetch(new Request(`${origin}/manifest`), { DB: { prepare } } as unknown as Env, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalGames: 3 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects unknown routes without querying D1", async () => {
    const prepare = vi.fn(() => { throw new Error("D1 must not be queried"); });
    const response = await worker.fetch(new Request(`${origin}/unknown`), { DB: { prepare } } as unknown as Env, {} as ExecutionContext);
    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });
});
