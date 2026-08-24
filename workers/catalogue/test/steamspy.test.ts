import { describe, expect, it, vi } from "vitest";
import {
  applySteamSpySamples,
  fetchLivePlayerCount,
  parseOwnersMax,
  refreshSteamSpySamples,
  STEAMSPY_MAX_PAGES,
  toSteamSpySamples,
} from "../src/steamspy";
import { cacheKey } from "../src/cache";

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

function fakeDb(cursor = "0") {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    statements,
    prepare(sql: string) {
      const statement = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          statements.push({ sql, args });
          return statement;
        },
        first: async () => (sql.includes("SELECT value") ? { value: cursor } : null),
        run: async () => ({ meta: { changes: 1 } }),
      };
      return statement;
    },
    batch: async (prepared: Array<{ args: unknown[] }>) =>
      prepared.map(() => ({ meta: { changes: 1 } })),
  };
  return db as unknown as D1Database & { statements: typeof statements };
}

describe("steamspy ingestion", () => {
  it("only updates existing rows — a sample never inserts a game", async () => {
    const db = fakeDb();
    await applySteamSpySamples(
      db,
      [{ appId: "367520", ccu: 8421, ownersMax: 20000000 }],
      Date.parse("2026-08-23T12:00:00.000Z"),
    );

    const writes = db.statements.filter((entry) => entry.sql.includes("games"));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("UPDATE games SET steamspy_ccu = ?, steamspy_owners_max = ?");
    expect(writes[0].sql).not.toContain("INSERT");
    expect(writes[0].args).toEqual([8421, 20000000, "367520"]);
  });

  it("records the sample timestamp so the game route's cache key moves", async () => {
    const db = fakeDb();
    await applySteamSpySamples(
      db,
      [{ appId: "367520", ccu: 1, ownersMax: 0 }],
      Date.parse("2026-08-23T12:00:00.000Z"),
    );

    const metaWrite = db.statements.find((entry) => entry.args[0] === "steamspySampledAt");
    expect(metaWrite?.args[1]).toBe("2026-08-23T12:00:00.000Z");

    // Sem o timestamp na chave, a rota de detalhe serviria o `playingNow` de
    // ontem: o `updatedAt` do catálogo não se move quando só o CCU muda.
    expect(cacheKey("game", "origin:367520", "2026-01-01:never")).not.toBe(
      cacheKey("game", "origin:367520", "2026-01-01:2026-08-23T12:00:00.000Z"),
    );
  });

  it("advances the page cursor and wraps at the last page", async () => {
    const fetchMock = vi.fn(
      async (url: string) => new Response(JSON.stringify({ url }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const db = fakeDb(String(STEAMSPY_MAX_PAGES - 1));
    const result = await refreshSteamSpySamples(db, Date.parse("2026-08-23T12:00:00.000Z"));

    expect(result.page).toBe(STEAMSPY_MAX_PAGES - 1);
    expect(fetchMock.mock.calls[0][0]).toContain(`page=${STEAMSPY_MAX_PAGES - 1}`);
    const cursorWrite = db.statements.find(
      (entry) => entry.sql.startsWith("INSERT") && entry.args[0] === "steamspyPage",
    );
    expect(cursorWrite?.args[1]).toBe("0");

    vi.unstubAllGlobals();
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
