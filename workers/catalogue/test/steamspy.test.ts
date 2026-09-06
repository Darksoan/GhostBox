import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLivePlayerCount,
  getSteamSpySnapshot,
  parseOwnersMax,
  refreshSteamSpySnapshot,
  STEAMSPY_MAX_PAGES,
  toSteamSpySamples,
  steamSpySnapshotSample,
  invalidateSteamSpySnapshotCache,
} from "../src/steamspy";
import worker from "../src/index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  invalidateSteamSpySnapshotCache();
});

describe("steamspy payload parsing", () => {
  it("takes the upper bound of the owners range", () => {
    expect(parseOwnersMax("10,000,000 .. 20,000,000")).toBe(20000000);
    expect(parseOwnersMax("0 .. 20,000")).toBe(20000);
    expect(parseOwnersMax("")).toBe(0);
    expect(parseOwnersMax(undefined)).toBe(0);
  });

  it("keeps entries that carry either sample", () => {
    const samples = toSteamSpySamples({
      "367520": { appid: 367520, ccu: 8421, owners: "10,000,000 .. 20,000,000" },
      "1145360": { appid: 1145360, ccu: 0, owners: "10,000,000 .. 20,000,000" },
    });
    expect(samples).toEqual([
      { appId: "367520", ccu: 8421, ownersMax: 20000000 },
      { appId: "1145360", ccu: 0, ownersMax: 20000000 },
    ]);
  });

  it("drops entries with no usable app id or no sample at all", () => {
    const samples = toSteamSpySamples({
      demo: { ccu: 10, owners: "0 .. 20,000" },
      "999": { appid: 999, ccu: 0, owners: "0 .. 0" },
    });
    expect(samples).toEqual([]);
  });

  it("survives a payload that is not an object", () => {
    expect(toSteamSpySamples(null)).toEqual([]);
    expect(toSteamSpySamples("nope")).toEqual([]);
  });
});

describe("steamspy ingestion", () => {
  function fakeKv(seed: Record<string, unknown> = {}) {
    const values = new Map(Object.entries(seed));
    return {
      values,
      async get(key: string, type?: "json") {
        const value = values.get(key);
        if (type === "json") {
          if (value === undefined) return null;
          if (typeof value !== "string") return value;
          return JSON.parse(value);
        }
        return typeof value === "string" ? value : value === undefined ? null : JSON.stringify(value);
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    } as unknown as KVNamespace & { values: Map<string, unknown> };
  }

  it("writes a page to KV without touching D1", async () => {
    const kv = fakeKv();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ "367520": { appid: 367520, ccu: 9, owners: "0 .. 20,000" } })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshSteamSpySnapshot(kv, Date.parse("2026-08-23T00:00:00.000Z"), 0);

    expect(result).toMatchObject({ page: 0, samples: 1, published: false });
    expect(kv.values.get("catalogue:steamspy:page:2026-08-23:0")).toContain("367520");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reads the active compact snapshot and overlays a sample", async () => {
    const snapshot = { sampledAt: "2026-08-23T00:40:00.000Z", samples: { "367520": [9, 20000] } };
    const kv = fakeKv({
      "catalogue:steamspy:active": "2026-08-23",
      "catalogue:steamspy:snapshot:2026-08-23": snapshot,
    });

    const loaded = await getSteamSpySnapshot(kv);
    expect(loaded?.sampledAt).toBe(snapshot.sampledAt);
    expect(steamSpySnapshotSample(loaded, "367520")).toEqual({ appId: "367520", ccu: 9, ownersMax: 20000 });
    expect(steamSpySnapshotSample(loaded, "1")).toBeNull();
  });

  it("publishes only after all twenty pages are present", async () => {
    const day = "2026-08-23";
    const pages = Object.fromEntries(Array.from({ length: STEAMSPY_MAX_PAGES }, (_, page) => [
      `catalogue:steamspy:page:${day}:${page}`,
      [{ appId: String(1000 + page), ccu: page + 1, ownersMax: 10 }],
    ]));
    const kv = fakeKv(pages);

    const result = await refreshSteamSpySnapshot(kv, Date.parse(`${day}T00:40:00.000Z`), STEAMSPY_MAX_PAGES);

    expect(result).toMatchObject({ page: STEAMSPY_MAX_PAGES, samples: STEAMSPY_MAX_PAGES, published: true });
    expect(kv.values.get("catalogue:steamspy:active")).toBe(day);
    expect(kv.values.get(`catalogue:steamspy:snapshot:${day}`)).toContain("1000");
  });

  it("keeps the previous snapshot when a collection is incomplete", async () => {
    const kv = fakeKv({ "catalogue:steamspy:active": "2026-08-22" });
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(refreshSteamSpySnapshot(kv, Date.parse("2026-08-23T00:40:00Z"))).rejects.toThrow("503");
    expect(kv.values.get("catalogue:steamspy:active")).toBe("2026-08-22");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a missing page before publishing and does not republish a complete snapshot", async () => {
    const day = "2026-08-23";
    const pages = Object.fromEntries(Array.from({ length: STEAMSPY_MAX_PAGES }, (_, page) => [
      `catalogue:steamspy:page:${day}:${page}`,
      [{ appId: String(1000 + page), ccu: 10, ownersMax: 20 }],
    ]));
    delete pages[`catalogue:steamspy:page:${day}:3`];
    const kv = fakeKv(pages);
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ "1003": { ccu: 10, owners: "0 .. 20" } })));
    vi.stubGlobal("fetch", fetchMock);
    await refreshSteamSpySnapshot(kv, Date.parse(`${day}T00:40:00Z`));
    expect(fetchMock.mock.calls[0][0]).toContain("page=3");
    const original = kv.values.get(`catalogue:steamspy:snapshot:${day}`);
    const put = vi.spyOn(kv, "put");
    await refreshSteamSpySnapshot(kv, Date.parse(`${day}T00:42:00Z`));
    expect(put).not.toHaveBeenCalled();
    expect(kv.values.get(`catalogue:steamspy:snapshot:${day}`)).toBe(original);
  });

  it("rejects empty upstream pages and leaves completed pages unchanged on retries", async () => {
    const kv = fakeKv();
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(refreshSteamSpySnapshot(kv, Date.parse("2026-08-23T00:00:00Z"))).rejects.toThrow("no valid samples");
    expect(kv.values.size).toBe(0);
    kv.values.set("catalogue:steamspy:page:2026-08-23:0", [{ appId: "1", ccu: 1, ownersMax: 2 }]);
    await refreshSteamSpySnapshot(kv, Date.parse("2026-08-23T00:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the last good snapshot during a KV outage, and cold isolates fall back to D1", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const kv = fakeKv({
      "catalogue:steamspy:active": "2026-08-23",
      "catalogue:steamspy:snapshot:2026-08-23": { sampledAt: "2026-08-23T00:40:00Z", samples: { "1": [9, 10] } },
    });
    const snapshot = await getSteamSpySnapshot(kv);
    vi.spyOn(kv, "get").mockRejectedValue(new Error("KV unavailable"));
    vi.advanceTimersByTime(11 * 60_000);
    expect(await getSteamSpySnapshot(kv)).toEqual(snapshot);
    invalidateSteamSpySnapshotCache();
    expect(await getSteamSpySnapshot(kv)).toBeNull();
  });

  it("reads the previous complete version while the new KV value has not propagated", async () => {
    const snapshot = { sampledAt: "2026-08-22T00:40:00Z", samples: { "1": [9, 10] } };
    const kv = fakeKv({
      "catalogue:steamspy:active": "2026-08-23",
      "catalogue:steamspy:previous": "2026-08-22",
      "catalogue:steamspy:snapshot:2026-08-22": snapshot,
    });
    expect(await getSteamSpySnapshot(kv)).toEqual(snapshot);
  });

  it("uses the scheduled timestamp for a delayed cron and never touches D1", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const kv = fakeKv();
    let dbTouched = false;
    const hostileDb = new Proxy(
      {},
      {
        get(_target, prop) {
          dbTouched = true;
          throw new Error(`D1 must not be used (saw ${String(prop)})`);
        },
      }
    ) as unknown as D1Database;
    const pending: Promise<unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ "1": { ccu: 1, owners: "0 .. 2" } })));
    vi.stubGlobal("fetch", fetchMock);
    await worker.scheduled(
      { scheduledTime: Date.parse("2026-08-23T00:04:00Z") } as ScheduledController,
      { DB: hostileDb, STEAMSPY_SNAPSHOT: kv },
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    expect(fetchMock.mock.calls[0][0]).toContain("page=2");
    expect(kv.values.has("catalogue:steamspy:page:2026-08-23:2")).toBe(true);
    expect(dbTouched).toBe(false);

    // Publication slot with all pages seeded must also stay KV-only.
    const day = "2026-08-23";
    for (let page = 0; page < STEAMSPY_MAX_PAGES; page += 1) {
      kv.values.set(`catalogue:steamspy:page:${day}:${page}`, [
        { appId: String(1000 + page), ccu: 10, ownersMax: 20 },
      ]);
    }
    const publishPending: Promise<unknown>[] = [];
    const publishFetch = vi.fn(async () => new Response(JSON.stringify({})),);
    vi.stubGlobal("fetch", publishFetch);
    await worker.scheduled(
      { scheduledTime: Date.parse(`${day}T00:40:00.000Z`) } as ScheduledController,
      { DB: hostileDb, STEAMSPY_SNAPSHOT: kv },
      { waitUntil: (promise: Promise<unknown>) => publishPending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(publishPending);
    expect(kv.values.get("catalogue:steamspy:active")).toBe(day);
    expect(dbTouched).toBe(false);

    await expect(worker.scheduled({} as ScheduledController, { DB: hostileDb }, {} as ExecutionContext))
      .rejects.toThrow("D1 refresh is disabled");
    expect(dbTouched).toBe(false);
  });
});

describe("live player count", () => {
  function stubFetch(body: unknown, status = 200) {
    const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  it("reads the count when Steam reports success", async () => {
    stubFetch({ response: { player_count: 12039, result: 1 } });
    await expect(fetchLivePlayerCount("2050650")).resolves.toBe(12039);
    vi.unstubAllGlobals();
  });

  it("falls back to null for an unknown app (result 42, not an HTTP error)", async () => {
    stubFetch({ response: { result: 42 } });
    await expect(fetchLivePlayerCount("1")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("swallows HTTP and network failures so the route keeps serving the D1 row", async () => {
    stubFetch({}, 503);
    await expect(fetchLivePlayerCount("2050650")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    await expect(fetchLivePlayerCount("2050650")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("never calls out for a non-numeric app id", async () => {
    const mock = stubFetch({ response: { player_count: 1, result: 1 } });
    await expect(fetchLivePlayerCount("steam-2050650")).resolves.toBeNull();
    expect(mock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
