import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { runSearchIndexBackfill } from "../src/search-index";

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
    app_id TEXT PRIMARY KEY, name TEXT, release_year TEXT,
    developers_json TEXT, publishers_json TEXT, categories_json TEXT, genres_json TEXT, tags_json TEXT,
    app_type TEXT DEFAULT 'game'
  )`).run();
  await db.prepare("CREATE TABLE catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await db.prepare(`CREATE VIRTUAL TABLE games_search USING fts5(
    app_id UNINDEXED, text, genres, tags, developers, publishers, years,
    tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
  )`).run();
  await db.batch(Array.from({ length: 80 }, (_, index) => {
    const appId = String(index + 1);
    return db.prepare("INSERT INTO games (app_id, name, release_year, developers_json, publishers_json, categories_json, genres_json, tags_json, app_type) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(appId, `Jogo ${appId}`, "2026", '["Estúdio"]', '["Editora"]', '["Single-player"]', '["Ação"]', '["Co-op","C++"]', 'game');
  }));
}, 20_000);

afterAll(async () => runtime?.dispose());

describe("automatic search-index backfill", () => {
  it("resumes, validates and activates without a manual command", async () => {
    const timestamp = Date.parse("2026-09-07T01:00:00Z");
    expect((await runSearchIndexBackfill(db, timestamp)).status).toBe("progress");
    expect((await runSearchIndexBackfill(db, timestamp)).status).toBe("progress");
    expect((await runSearchIndexBackfill(db, timestamp)).status).toBe("complete");
    const activated = await runSearchIndexBackfill(db, timestamp);
    expect(activated).toMatchObject({ status: "activated", indexed: 80 });
    expect(await db.prepare("SELECT value FROM catalogue_meta WHERE key='searchIndexVersion'").first<string>("value")).toBe("1");
    expect(await db.prepare("SELECT COUNT(*) AS total FROM games_search WHERE games_search MATCH 'tags:f632b2b'").first<number>("total")).toBe(80);
  });
});
