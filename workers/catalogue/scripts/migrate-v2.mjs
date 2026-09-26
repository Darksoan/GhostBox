import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packScreenshots } from "../src/screenshots.ts";
import { documentFor } from "./backfill-search-index.mjs";

// Explicitly never uses the DB binding: the source must remain untouched.
const SOURCE = "piratebox-games";
const TARGET = "piratebox-games-v2";
const BATCH_SIZE = 25;
const DAILY_WRITE_CEILING = 60_000; // Free account limit is 100k across all D1s.
const BATCH_WRITE_RESERVE = 220; // FTS shadow-table writes exceed one row per game.
const STORAGE_STOP_BYTES = 375_000_000;
const STORAGE_ACCEPT_BYTES = 300_000_000;
const CURSOR_KEY = "v2MigrationCursor";
const BUDGET_KEY = "v2MigrationWriteBudget";
const cli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const fields = [
  "app_id", "name", "release_date", "release_year", "release_sort", "header_image",
  "developers_json", "publishers_json", "categories_json", "genres_json", "screenshots_json", "tags_json",
  "updated_at", "popularity_score", "popularity_rank", "steam_review_count", "steam_positive_ratio",
  "metacritic_score", "recommendations", "steamspy_ccu", "steamspy_owners_max", "app_type",
];

function quote(value) {
  return value == null ? "NULL" : typeof value === "number" && Number.isFinite(value)
    ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
}

function wrangler(args) {
  const output = execFileSync(process.execPath, [cli, "d1", ...args], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const start = output.indexOf("[");
  if (start < 0) throw new Error(`Wrangler did not return query results: ${output.slice(0, 500)}`);
  const results = JSON.parse(output.slice(start));
  if (!Array.isArray(results) || results.length === 0 || results.some((entry) => !entry.success)) {
    throw new Error(`D1 command failed: ${output.slice(0, 500)}`);
  }
  return results;
}

function query(db, sql) {
  return wrangler(["execute", db, "--remote", "--json", "--command", sql])[0].results;
}

function batch(db, sql) {
  const directory = mkdtempSync(join(tmpdir(), "ghostbox-v2-"));
  try {
    const path = join(directory, "page.sql");
    writeFileSync(path, sql, "utf8");
    return wrangler(["execute", db, "--remote", "--json", "--file", path]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function info(db) {
  return JSON.parse(execFileSync(process.execPath, [cli, "d1", "info", db, "--json"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
}

function assertTarget() {
  const columns = query(TARGET, "SELECT name FROM pragma_table_info('games')").map((row) => row.name);
  if (!fields.every((field) => columns.includes(field)) || columns.includes("search_text")) {
    throw new Error("Target must first be initialized with schema-v2.sql; never apply this to the old DB.");
  }
  const fts = query(TARGET, "SELECT sql FROM sqlite_master WHERE name='games_search'")[0]?.sql ?? "";
  if (!fts.includes("contentless_delete=1") || !fts.includes("content=''")) throw new Error("Unexpected target FTS schema");
}

function sourceRows(cursor) {
  return query(SOURCE, `SELECT ${fields.filter((field) => field !== "app_type").join(",")} FROM games WHERE app_id>${quote(cursor)} ORDER BY app_id LIMIT ${BATCH_SIZE}`);
}

export function sqlFor(rows, cursor, budget) {
  const games = rows.map((row) => {
    if (!/^\d{1,10}$/.test(row.app_id)) throw new Error(`Invalid app ID: ${row.app_id}`);
    const values = { ...row, screenshots_json: packScreenshots(row.app_id, JSON.parse(row.screenshots_json || "[]")), app_type: "unclassified" };
    return `(${fields.map((field) => quote(values[field])).join(",")})`;
  });
  const documents = rows.map((row) => {
    const document = documentFor(row);
    return `(${Number(row.app_id)},${document.map(quote).join(",")})`;
  });
  return `INSERT INTO games (${fields.join(",")}) VALUES ${games.join(",")} ON CONFLICT(app_id) DO NOTHING;\n`
    + `INSERT OR REPLACE INTO games_search (rowid,text,genres,tags,developers,publishers,years) VALUES ${documents.join(",")};\n`
    + `INSERT INTO catalogue_meta (key,value) VALUES ('${CURSOR_KEY}',${quote(cursor)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`
    + (budget ? `\nINSERT INTO catalogue_meta (key,value) VALUES ('${BUDGET_KEY}',${quote(JSON.stringify(budget))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;` : "");
}

function inspect() {
  const sample = sourceRows("");
  const sourceBytes = sample.reduce((sum, row) => sum + row.screenshots_json.length, 0);
  const packedBytes = sample.reduce((sum, row) => sum + packScreenshots(row.app_id, JSON.parse(row.screenshots_json || "[]")).length, 0);
  console.log(JSON.stringify({ sample: sample.length, screenshotSourceBytes: sourceBytes, screenshotPackedBytes: packedBytes, reduction: sourceBytes ? 1 - packedBytes / sourceBytes : 0 }));
}

function copy(maxBatches) {
  assertTarget();
  const target = info(TARGET);
  if (Number(target.database_size) > STORAGE_STOP_BYTES) throw new Error("Target exceeds 375 MB; stop before D1's 500 MB hard limit.");
  if (!Number.isFinite(Number(target.rows_written_24h)) || Number(target.rows_written_24h) >= DAILY_WRITE_CEILING) {
    throw new Error("D1 writes exceed migration reserve; resume after the rolling 24-hour window clears.");
  }
  let cursor = query(TARGET, `SELECT value FROM catalogue_meta WHERE key='${CURSOR_KEY}'`)[0]?.value ?? "";
  const day = new Date().toISOString().slice(0, 10);
  const previous = JSON.parse(query(TARGET, `SELECT value FROM catalogue_meta WHERE key='${BUDGET_KEY}'`)[0]?.value ?? "null");
  let budgetWrites = previous?.day === day ? Number(previous.writes) : 0;
  let writes = 0;
  for (let page = 0; page < maxBatches; page++) {
    if (budgetWrites + BATCH_WRITE_RESERVE > DAILY_WRITE_CEILING ||
      Number(target.rows_written_24h) + writes + BATCH_WRITE_RESERVE + 5000 > 90_000) break;
    const rows = sourceRows(cursor);
    if (!rows.length) {
      console.log(JSON.stringify({ complete: true, cursor, next: "--finalize" }));
      return;
    }
    const next = rows.at(-1).app_id;
    budgetWrites += BATCH_WRITE_RESERVE;
    const results = batch(TARGET, sqlFor(rows, next, { day, writes: budgetWrites }));
    const measured = results.reduce((sum, result) => sum + Number(result.meta?.rows_written ?? 0), 0);
    writes += measured;
    cursor = next;
    if (measured > BATCH_WRITE_RESERVE) throw new Error(`Batch consumed ${measured} writes; ${BATCH_WRITE_RESERVE} reserved. Stop until budget is recalibrated.`);
    console.log(JSON.stringify({ cursor, copied: rows.length, measuredWrites: writes, reservedWritesToday: budgetWrites }));
  }
  console.log(JSON.stringify({ cursor, measuredWrites: writes, next: "resume when storage/write headroom is available" }));
}

function finalize() {
  assertTarget();
  const source = query(SOURCE, "SELECT COUNT(*) AS total FROM games")[0].total;
  const target = query(TARGET, "SELECT (SELECT COUNT(*) FROM games) AS games,(SELECT COUNT(*) FROM games_search) AS indexed")[0];
  if (source !== target.games || source !== target.indexed) throw new Error(`Coverage mismatch: source=${source}, target=${JSON.stringify(target)}`);
  const missing = query(TARGET, "SELECT app_id FROM games WHERE NOT EXISTS (SELECT 1 FROM games_search WHERE rowid=CAST(games.app_id AS INTEGER)) LIMIT 1");
  const extra = query(TARGET, "SELECT rowid FROM games_search WHERE NOT EXISTS (SELECT 1 FROM games WHERE games.app_id=CAST(games_search.rowid AS TEXT)) LIMIT 1");
  if (missing.length || extra.length) throw new Error(`FTS coverage mismatch: ${JSON.stringify({ missing, extra })}`);
  const samples = query(TARGET, "SELECT app_id FROM games ORDER BY app_id LIMIT 12");
  for (const { app_id } of samples) {
    const match = query(TARGET, `SELECT rowid FROM games_search WHERE games_search MATCH ${quote(`text:${app_id}`)} AND rowid=${Number(app_id)}`);
    if (match.length !== 1) throw new Error(`FTS document mismatch for ${app_id}`);
  }
  const size = Number(info(TARGET).database_size);
  if (!Number.isFinite(size) || size > STORAGE_ACCEPT_BYTES) {
    throw new Error(`Target ${size} bytes exceeds the 300 MB release budget; do not activate or switch bindings.`);
  }
  const sourceMeta = new Map(query(SOURCE, "SELECT key,value FROM catalogue_meta WHERE key IN ('facets','steamspySampledAt')").map((row) => [row.key, row.value]));
  const now = new Date().toISOString();
  const meta = [["totalGames", String(target.games)], ["storedGames", String(target.games)], ["updatedAt", now], ["facetsUpdatedAt", now], ["searchIndexVersion", "2"], ...sourceMeta];
  batch(TARGET, meta.map(([key, value]) => `INSERT INTO catalogue_meta(key,value) VALUES(${quote(key)},${quote(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`).join("\n"));
  console.log(JSON.stringify({ activated: true, size, total: target.games }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--finalize")) finalize();
  else if (process.argv.includes("--apply")) {
    const at = process.argv.indexOf("--max-batches");
    const batches = at < 0 ? 20 : Number(process.argv[at + 1]);
    if (!Number.isInteger(batches) || batches < 1 || batches > 100) throw new Error("--max-batches must be 1..100");
    copy(batches);
  } else inspect();
}
