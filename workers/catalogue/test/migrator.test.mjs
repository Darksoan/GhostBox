import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { migratePage } from "../src/migrator";
import { unpackScreenshots } from "../src/screenshots";

let runtime;
let source;
let target;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true, script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-19", d1Databases: ["SOURCE_DB", "DB"],
  });
  source = await runtime.getD1Database("SOURCE_DB");
  target = await runtime.getD1Database("DB");
  await source.prepare(`CREATE TABLE games (
    app_id TEXT PRIMARY KEY, name TEXT, release_date TEXT, release_year TEXT, release_sort INTEGER, header_image TEXT,
    developers_json TEXT, publishers_json TEXT, categories_json TEXT, genres_json TEXT, screenshots_json TEXT, tags_json TEXT,
    updated_at INTEGER, popularity_score REAL, popularity_rank INTEGER, steam_review_count INTEGER,
    steam_positive_ratio REAL, metacritic_score INTEGER, recommendations INTEGER, steamspy_ccu INTEGER, steamspy_owners_max INTEGER
  )`).run();
  const schema = readFileSync(fileURLToPath(new URL("../schema-v2.sql", import.meta.url)), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) await target.prepare(statement).run();
  await source.batch(Array.from({ length: 27 }, (_, i) => {
    const id = String(1000 + i);
    return source.prepare("INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, `Ação ${id}`, "Jan 1, 2020", "2020", 0, "", '["Studio"]', "[]", "[]", '["Action"]',
        JSON.stringify([`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/ss_0.jpg?t=123`]),
        "[]", 1, 0, null, 0, 0, 0, 0, 0, 0);
  }));
}, 20_000);

afterAll(async () => runtime?.dispose());

describe("resumable bounded catalogue migration", () => {
  it("copies and checkpoints complete games with a measured write budget", async () => {
    const time = Date.parse("2026-09-26T01:00:00Z");
    expect(await migratePage(source, target, time)).toBe("progress");
    expect(await target.prepare("SELECT COUNT(*) AS count FROM games").first("count")).toBe(25);
    const first = await target.prepare("SELECT app_id,screenshots_json FROM games WHERE app_id='1000'").first();
    expect(unpackScreenshots(first.app_id, first.screenshots_json)).toEqual([
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1000/ss_0.jpg?t=123",
    ]);
    expect((await target.prepare("SELECT rowid FROM games_search WHERE games_search MATCH 'text:acao*' AND rowid=1000").all()).results).toHaveLength(1);
    expect(await migratePage(source, target, time)).toBe("progress");
    expect(await migratePage(source, target, time)).toBe("complete");
    expect(await target.prepare("SELECT COUNT(*) AS count FROM games_search").first("count")).toBe(27);
    const budget = JSON.parse(await target.prepare("SELECT value FROM catalogue_meta WHERE key='v2MigrationWriteBudget'").first("value"));
    expect(budget).toMatchObject({ day: "2026-09-26", writes: 440 });
    await target.prepare("UPDATE catalogue_meta SET value=? WHERE key='v2MigrationWriteBudget'")
      .bind(JSON.stringify({ day: "2026-09-26", writes: 60_000 })).run();
    expect(await migratePage(source, target, time)).toBe("budget");
  }, 20_000);
});
