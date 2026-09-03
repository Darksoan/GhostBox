import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { getGame, searchCatalogue } from "../src/catalogue";
import { parseSearch } from "../src/index";
import type { SteamSpySnapshot } from "../src/steamspy";

const snapshot: SteamSpySnapshot = {
  sampledAt: "2026-09-03T00:40:00Z",
  samples: { "2": [50, 200], "10": [50, 100], "3": [30, 300], "4": [0, 400], "999": [999, 999] },
};
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
    app_id TEXT PRIMARY KEY, name TEXT, search_text TEXT,
    release_date TEXT DEFAULT '', release_year TEXT DEFAULT '2020', header_image TEXT DEFAULT '',
    developers_json TEXT DEFAULT '[]', publishers_json TEXT DEFAULT '[]', categories_json TEXT DEFAULT '[]',
    genres_json TEXT DEFAULT '["Action"]', screenshots_json TEXT DEFAULT '[]', tags_json TEXT DEFAULT '[]',
    updated_at INTEGER DEFAULT 0, popularity_score REAL DEFAULT 0, popularity_rank INTEGER,
    steam_review_count INTEGER DEFAULT 0, steam_positive_ratio REAL DEFAULT 0,
    metacritic_score INTEGER DEFAULT 0, recommendations INTEGER DEFAULT 0,
    ranking_score REAL DEFAULT 0, ranking_tier INTEGER DEFAULT 0,
    steamspy_ccu INTEGER DEFAULT 0, steamspy_owners_max INTEGER DEFAULT 7
  )`).run();
  const seeds = [
    ["2", "Portal", "portal", '["Puzzle","Co-op"]', 1],
    ["10", "Portal 2", "portal 2", '["Puzzle"]', 0],
    ["3", "Half-Life", "half life", '["Puzzle","Co-op"]', 900],
    ["4", "Portal Zero", "portal zero", '["Puzzle"]', 800],
  ];
  await db.batch(seeds.map((row) => db.prepare(
    "INSERT INTO games (app_id, name, search_text, categories_json, steamspy_ccu) VALUES (?, ?, ?, ?, ?)",
  ).bind(...row)));
}, 20_000);

afterAll(async () => { await runtime?.dispose(); });

function search(query: string, source: SteamSpySnapshot | null = snapshot) {
  return searchCatalogue(db, parseSearch(new URL(`https://example.com/catalogue/search?${query}`)), 4, "https://example.com", undefined, source);
}

describe("snapshot queries in local D1", () => {
  it("looks games up by primary key for a full 20,000-sample snapshot", async () => {
    const large: SteamSpySnapshot = {
      sampledAt: snapshot.sampledAt,
      samples: { ...Object.fromEntries(Array.from({ length: 19_995 }, (_, index) => [String(100_000 + index), [1, 2] as [number, number]])), ...snapshot.samples },
    };
    const statements: string[] = [];
    const traced = { prepare(sql: string) { statements.push(sql); return db.prepare(sql); } } as D1Database;
    const result = await searchCatalogue(traced, parseSearch(new URL("https://example.com/catalogue/search?sort=playingNow&limit=200")), 4, "https://example.com", undefined, large);
    expect(result.matched).toBe(3);
    const pageSql = statements.find((sql) => sql.includes("LIMIT ? OFFSET ?"))!;
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${pageSql}`).bind(JSON.stringify(large.samples), 201, 0).all<{ detail: string }>();
    expect(plan.results.some((row) => /SEARCH games .*app_id=/.test(row.detail))).toBe(true);
    expect(plan.results.some((row) => /^SCAN games/.test(row.detail))).toBe(false);
  });

  it("uses current CCU, excludes missing/zero games, and paginates numeric ties correctly", async () => {
    const first = await search("sort=playingNow&limit=1");
    expect(first.matched).toBe(3);
    expect(first.games.map((game) => game.appId)).toEqual(["2"]);
    const second = await search("sort=playingNow&limit=1&offset=1");
    expect(second.games.map((game) => game.appId)).toEqual(["10"]);
    expect(second.games[0].playingNow).toBe(50);
    const last = await search("sort=playingNow&limit=1&offset=2");
    expect(last.games.map((game) => game.appId)).toEqual(["3"]);
    expect(last.limited).toBe(false);
  });

  it("applies all filters before pagination and uses categories when tags are empty", async () => {
    const result = await search("sort=playingNow&genres=Action&tags=Puzzle&tags=Co-op&years=2020&offset=1&limit=1");
    expect(result.matched).toBe(2);
    expect(result.games.map((game) => game.appId)).toEqual(["3"]);
  });

  it("preserves text relevance and returns no rows beyond the filtered result", async () => {
    const result = await search("sort=playingNow&q=Portal&limit=200");
    expect(result.matched).toBe(2);
    expect(result.games.map((game) => game.appId)).toEqual(["2", "10"]);
    const empty = await search("sort=playingNow&q=Portal&offset=2");
    expect(empty.games).toEqual([]);
    expect(empty.matched).toBe(2);
  });

  it("overlays statistics on other sorts and details, with a read-only D1 fallback", async () => {
    const normal = await search("sort=recentlyAdded&limit=200");
    expect(normal.games.find((game) => game.appId === "3")?.playingNow).toBe(30);
    expect((await getGame(db, "2", "https://example.com", snapshot))?.ownersEstimate).toBe(200);
    expect((await getGame(db, "2", "https://example.com", null))?.ownersEstimate).toBe(7);
    const fallback = await search("sort=playingNow&limit=1", null);
    expect(fallback.games[0].appId).toBe("3");
    expect(fallback.games[0].playingNow).toBe(900);
    const unchanged = await db.prepare("SELECT steamspy_ccu FROM games WHERE app_id = '10'").first<number>("steamspy_ccu");
    expect(unchanged).toBe(0);
  });
});
