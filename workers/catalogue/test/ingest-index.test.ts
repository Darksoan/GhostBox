import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { ingestSteamApp } from "../src/catalogue";

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
    const indexed = await db.prepare("SELECT app_id FROM games_search WHERE games_search MATCH ?")
      .bind("text:acao* AND genres:f616374696f6e")
      .all<{ app_id: string }>();
    const before = await db.prepare("SELECT value FROM catalogue_meta WHERE key = 'updatedAt'").first<string>("value");
    const second = await ingestSteamApp(db, "424242", "https://example.com", onChanged);
    const after = await db.prepare("SELECT value FROM catalogue_meta WHERE key = 'updatedAt'").first<string>("value");

    expect(first.ok).toBe(true);
    expect(indexed.results.map((row) => row.app_id)).toEqual(["424242"]);
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
});
