import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { ingestSteamApp, reserveDailyIngest } from "../src/catalogue";

let runtime: Miniflare;
let db: D1Database;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-19",
    d1Databases: ["DB"],
  });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  await db.prepare(`CREATE TABLE games (
    app_id TEXT PRIMARY KEY, name TEXT, search_text TEXT, release_date TEXT, release_year TEXT, release_sort INTEGER,
    header_image TEXT, developers_json TEXT, publishers_json TEXT, categories_json TEXT, genres_json TEXT,
    screenshots_json TEXT, tags_json TEXT, genres_text TEXT, tags_text TEXT, updated_at INTEGER,
    popularity_score REAL DEFAULT 0, popularity_rank INTEGER, steam_review_count INTEGER DEFAULT 0,
    steam_positive_ratio REAL DEFAULT 0, metacritic_score INTEGER DEFAULT 0, recommendations INTEGER DEFAULT 0,
    ranking_score REAL DEFAULT 0, ranking_tier INTEGER DEFAULT 0, steamspy_ccu INTEGER DEFAULT 0,
    steamspy_owners_max INTEGER DEFAULT 0, app_type TEXT
  )`).run();
  await db.prepare("CREATE TABLE catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare(`CREATE VIRTUAL TABLE games_search USING fts5(
    app_id UNINDEXED, text, genres, tags, developers, publishers, years,
    tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
  )`).run();
}, 20_000);

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await runtime?.dispose(); });

describe("catalogue ingestion", () => {
  it("indexes a new game once and leaves repeated ingest read-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "424242": {
        success: true,
        data: {
          name: "Ação Épica",
          release_date: { date: "Jan 1, 2020" },
          developers: ["Studio"],
          publishers: ["Publisher"],
          genres: [{ description: "Action" }],
          categories: [{ description: "Single-player" }],
          recommendations: { total: 12 },
          type: "game",
        },
      },
    })));
    vi.stubGlobal("fetch", fetchMock);

    const onChanged = vi.fn(async () => undefined);
    const first = await ingestSteamApp(db, "424242", "https://example.com", onChanged);
    const indexed = await db.prepare("SELECT rowid FROM games_search WHERE games_search MATCH ?")
      .bind("text:acao* AND genres:f616374696f6e")
      .all<{ rowid: number }>();
    const before = await db.prepare("SELECT value FROM catalogue_meta WHERE key = 'updatedAt'").first<string>("value");
    const second = await ingestSteamApp(db, "424242", "https://example.com", onChanged);
    const after = await db.prepare("SELECT value FROM catalogue_meta WHERE key = 'updatedAt'").first<string>("value");

    expect(first.ok).toBe(true);
    expect(indexed.results.map((row) => row.rowid)).toEqual([424242]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(true);
    expect(second.game?.appId).toBe("424242");
    expect(after).toBe(before);
  });

  it("rejects demos without persisting rows and keeps DLC ingestible", async () => {
    const demoFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "777001": { success: true, data: { name: "Demo Game", type: "demo" } },
    })));
    vi.stubGlobal("fetch", demoFetch);
    const demo = await ingestSteamApp(db, "777001", "https://example.com");
    expect(demo.ok).toBe(false);
    expect(demo).toMatchObject({ error: "steam_app_is_demo" });
    const missing = await db.prepare("SELECT app_id FROM games WHERE app_id = '777001'").first();
    expect(missing).toBeNull();

    const dlcFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "777002": { success: true, data: { name: "Extra DLC", type: "dlc" } },
    })));
    vi.stubGlobal("fetch", dlcFetch);
    const dlc = await ingestSteamApp(db, "777002", "https://example.com");
    expect(dlc.ok).toBe(true);
    expect(dlc.game?.appType).toBe("dlc");
    await db.prepare("DELETE FROM games WHERE app_id IN ('777001', '777002')").run();
    await db.prepare("DELETE FROM games_search WHERE app_id IN ('777001', '777002')").run();
  });

  it("caps new games by total capacity and daily write reservations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "777003": { success: true, data: { name: "New Game", type: "game" } },
    })));
    vi.stubGlobal("fetch", fetchMock);
    await db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('totalGames','115000') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    await db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('storedGames','115000') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    expect(await ingestSteamApp(db, "777003", "https://example.com")).toMatchObject({ ok: false, error: "catalogue_capacity_reached" });
    expect(fetchMock).not.toHaveBeenCalled();
    await db.prepare("UPDATE catalogue_meta SET value='0' WHERE key='totalGames'").run();
    await db.prepare("UPDATE catalogue_meta SET value='0' WHERE key='storedGames'").run();
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare("INSERT INTO catalogue_meta(key,value) VALUES(?, '25') ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`ingestCount:${day}`).run();
    expect(await ingestSteamApp(db, "777003", "https://example.com")).toMatchObject({ ok: false, error: "catalogue_daily_ingest_limit" });
    expect(await db.prepare("SELECT app_id FROM games WHERE app_id='777003'").first()).toBeNull();
    await db.prepare("DELETE FROM catalogue_meta WHERE key IN ('totalGames','storedGames', ?)").bind(`ingestCount:${day}`).run();
  });

  it("keeps storage count while removing a newly classified demo from visible totals", async () => {
    await db.prepare("INSERT INTO games(app_id,name,app_type,updated_at) VALUES('777004','Legacy Demo','unclassified',1)").run();
    await db.batch([
      db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('totalGames','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
      db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('storedGames','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      "777004": { success: true, data: { name: "Legacy Demo", type: "demo" } },
    }))));
    const result = await ingestSteamApp(db, "777004", "https://example.com");
    expect(result).toMatchObject({ ok: false, error: "steam_app_is_demo" });
    expect(await db.prepare("SELECT value FROM catalogue_meta WHERE key='totalGames'").first("value")).toBe("0");
    expect(await db.prepare("SELECT value FROM catalogue_meta WHERE key='storedGames'").first("value")).toBe("1");
    await db.prepare("DELETE FROM games WHERE app_id='777004'").run();
    await db.prepare("DELETE FROM catalogue_meta WHERE key IN ('totalGames','storedGames')").run();
  });

  it("stops writes before the physical database reaches the Free-tier limit", async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ all: async () => ({ meta: { size_after: 400_000_000 }, results: [] }) }) }));
    expect(await reserveDailyIngest({ prepare } as unknown as D1Database)).toBe("capacity");
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
