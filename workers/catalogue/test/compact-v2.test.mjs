import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { packScreenshots, unpackScreenshots } from "../src/screenshots";
import { searchCatalogue, searchIndexMatch, searchDocument } from "../src/catalogue";
import { parseSearch } from "../src/index";
import { sqlFor } from "../scripts/migrate-v2.mjs";

let runtime;
let db;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true, script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-19", d1Databases: ["DB"],
  });
  db = await runtime.getD1Database("DB");
  const schema = readFileSync(fileURLToPath(new URL("../schema-v2.sql", import.meta.url)), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
});

afterAll(async () => runtime?.dispose());

describe("compact D1 schema", () => {
  it("preserves all screenshot URLs without duplicating a Steam path per image", () => {
    const base = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1000/";
    const images = Array.from({ length: 14 }, (_, index) => `${base}ss_${index}.1920x1080.jpg?t=123456`);
    const packed = packScreenshots("1000", images);
    expect(packed.length).toBeLessThan(JSON.stringify(images).length / 2);
    expect(unpackScreenshots("1000", packed)).toEqual(images);
    expect(unpackScreenshots("1000", JSON.stringify(images))).toEqual(images);
    expect(unpackScreenshots("1000", packScreenshots("1000", [`${base}ss_a.jpg?t=1`, `${base}ss_b.jpg?t=2`]))).toEqual([
      `${base}ss_a.jpg?t=1`, `${base}ss_b.jpg?t=2`,
    ]);
    const nested = [`${base}nested/ss_a.jpg?t=1`];
    expect(unpackScreenshots("1000", packScreenshots("1000", nested))).toEqual(nested);
  });

  it("indexes text and filters without stored FTS content or full-scan fallback", async () => {
    const appId = "1000";
    const document = searchDocument(appId, "Ação Épica", ["Studio"], ["Publisher"], ["Action"], ["Co-op"], "2025");
    await db.prepare(`INSERT INTO games (
      app_id,name,release_year,release_sort,developers_json,publishers_json,categories_json,genres_json,screenshots_json,tags_json,updated_at,app_type
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(appId, "Ação Épica", "2025", 0, '["Studio"]', '["Publisher"]', "[]", '["Action"]', "[]", '["Co-op"]', 1, "game").run();
    await db.prepare("INSERT INTO games_search(rowid,text,genres,tags,developers,publishers,years) VALUES(?,?,?,?,?,?,?)")
      .bind(1000, document.text, document.genres, document.tags, document.developers, document.publishers, document.years).run();
    const sql = db.prepare("EXPLAIN QUERY PLAN SELECT games.app_id FROM games_search CROSS JOIN games ON games.app_id=CAST(games_search.rowid AS TEXT) WHERE games_search MATCH ?")
      .bind("text:acao*");
    const plan = await sql.all();
    expect(plan.results.some(({ detail }) => detail.includes("VIRTUAL TABLE INDEX"))).toBe(true);
    expect(plan.results.some(({ detail }) => detail.includes("SEARCH games USING COVERING INDEX"))).toBe(true);
    const request = parseSearch(new URL("https://example.com/catalogue/search?q=acao&genres=Action&limit=10&seed=0"));
    expect(searchIndexMatch(request)).toContain("genres:");
    const result = await searchCatalogue(db, request, 1, "https://example.com", undefined, null, "v2", true);
    expect(result.games).toMatchObject([{ appId, title: "Ação Épica" }]);
    expect(result.matched).toBe(1);
  });

  it("copies complete source rows and FTS documents into the compact schema", async () => {
    const row = {
      app_id: "2000", name: "An Action Game", release_date: "Jan 1, 2020", release_year: "2020",
      release_sort: 1, header_image: "", developers_json: '["Studio"]', publishers_json: "[]",
      categories_json: '["Single-player"]', genres_json: '["Action"]',
      screenshots_json: JSON.stringify(["https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2000/ss_1.jpg?t=123"]),
      tags_json: '["Action"]', updated_at: 1234, popularity_score: 0, popularity_rank: null,
      steam_review_count: 10, steam_positive_ratio: 0.7, metacritic_score: 0,
      recommendations: 0, steamspy_ccu: 0, steamspy_owners_max: 0,
    };
    const sql = sqlFor([row], row.app_id);
    for (const statement of sql.split(";").filter((part) => part.trim())) await db.prepare(statement).run();
    const stored = await db.prepare("SELECT screenshots_json,app_type FROM games WHERE app_id='2000'").first();
    expect(stored.app_type).toBe("unclassified");
    expect(unpackScreenshots("2000", stored.screenshots_json)).toEqual(JSON.parse(row.screenshots_json));
    expect((await db.prepare("SELECT rowid FROM games_search WHERE games_search MATCH 'text:action*' AND rowid=2000").all()).results).toHaveLength(1);
  });
});
