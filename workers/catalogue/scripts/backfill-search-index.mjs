import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DAILY_WRITE_BUDGET = 80_000;
const BATCH_SIZE = 100;
const BATCH_RESERVE = 10_000;
const STATE_KEY = "searchIndexBackfillState";
const FORMAT = 2;
let measuredReads = 0;
let measuredWrites = 0;
const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

function token(value) {
  const normalized = String(value).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  return normalized ? `f${Buffer.from(normalized).toString("hex")}` : "";
}

function tokens(values) {
  return [...new Set(values.map(token).filter(Boolean))].join(" ");
}

function parseOutput(output) {
  const start = output.indexOf("[");
  if (start === -1) throw new Error(`Wrangler did not return JSON: ${output}`);
  return JSON.parse(output.slice(start));
}

function execute(sql, file = false) {
  const directory = file ? mkdtempSync(join(tmpdir(), "ghostbox-fts-")) : null;
  try {
    const path = directory ? join(directory, "batch.sql") : null;
    if (path) writeFileSync(path, sql, "utf8");
    const output = execFileSync(process.execPath, [wranglerCli, "d1", "execute", "DB", "--remote", "--json", path ? "--file" : "--command", path ?? sql], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const result = parseOutput(output);
    if (!result.length || result.some((item) => item.success !== true)) throw new Error("D1 batch failed; reserved budget retained.");
    for (const item of result) {
      measuredReads += Number(item.meta?.rows_read ?? 0);
      measuredWrites += Number(item.meta?.rows_written ?? 0);
    }
    return result;
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

function query(sql) {
  return execute(sql)[0]?.results ?? [];
}

function written(result) {
  return result.reduce((total, item) => {
    if (!Number.isFinite(item.meta?.rows_written)) throw new Error("Missing D1 rows_written; reserved budget retained.");
    return total + item.meta.rows_written;
  }, 0);
}

export function documentFor(row) {
  const developers = textArray(row.developers_json);
  const publishers = textArray(row.publishers_json);
  const genres = textArray(row.genres_json);
  const categories = textArray(row.categories_json);
  const tags = textArray(row.tags_json);
  const effectiveTags = (tags.length ? tags : categories).slice(0, 12);
  return [
    normalize([row.app_id, row.name, ...developers, ...publishers, ...genres, ...categories].join(" ")),
    tokens(genres),
    tokens(effectiveTags),
    tokens(developers),
    tokens(publishers),
    tokens(row.release_year ? [row.release_year] : []),
  ];
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function reserveBatch(state, day, now = Date.now()) {
  if (state.leaseUntil > now) return null;
  const writes = state.day === day ? state.writes : 0;
  if (!Number.isFinite(writes) || writes + BATCH_RESERVE > DAILY_WRITE_BUDGET) return null;
  return { ...state, day, writes: writes + BATCH_RESERVE, leaseUntil: now + 10 * 60_000 };
}

function activateIndex() {
  const state = JSON.parse(query(`SELECT value FROM catalogue_meta WHERE key = ${quote(STATE_KEY)}`)[0]?.value ?? "null");
  if (!state?.complete || state.format !== FORMAT || state.leaseUntil > Date.now()) throw new Error("Backfill incomplete or still running.");
  const counts = query("SELECT (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM games_search) AS indexed")[0];
  const missing = query("SELECT games.app_id FROM games WHERE NOT EXISTS (SELECT 1 FROM games_search WHERE rowid = CAST(games.app_id AS INTEGER)) LIMIT 1");
  const extra = query("SELECT app_id FROM games_search WHERE NOT EXISTS (SELECT 1 FROM games WHERE games.app_id = games_search.app_id) LIMIT 1");
  if (counts.games !== counts.indexed || missing.length || extra.length) throw new Error(`Index coverage mismatch: ${JSON.stringify(counts)}`);
  const samples = query("SELECT app_id,name,release_year,developers_json,publishers_json,categories_json,genres_json,tags_json FROM games ORDER BY app_id LIMIT 12");
  for (const row of samples) {
    const indexed = query(`SELECT text,genres,tags,developers,publishers,years FROM games_search WHERE rowid=${Number(row.app_id)}`)[0];
    if (JSON.stringify(Object.values(indexed)) !== JSON.stringify(documentFor(row))) throw new Error(`Index sample mismatch: ${row.app_id}`);
  }
  execute("INSERT INTO catalogue_meta (key, value) VALUES ('searchIndexVersion', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  console.log(JSON.stringify({ activated: true, ...counts }));
}

function main() {
  if (process.argv.includes("--activate")) return activateIndex();
  const statusOnly = process.argv.includes("--status");
  const usage = statusOnly ? null : JSON.parse(execFileSync(process.execPath, [wranglerCli, "d1", "info", "DB", "--json"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
  const hasHeadroom = () => usage && Number.isFinite(usage.rows_written_24h) && Number.isFinite(usage.rows_read_24h)
    && usage.rows_written_24h + measuredWrites + BATCH_RESERVE <= 90_000
    && usage.rows_read_24h + measuredReads + 1000 <= 4_000_000;
  if (!statusOnly && !hasHeadroom()) {
    console.log(JSON.stringify({ paused: "D1 usage headroom (rolling 24h)", rowsRead24h: usage.rows_read_24h, rowsWritten24h: usage.rows_written_24h }));
    return;
  }
  const meta = new Map(query(`SELECT key,value FROM catalogue_meta WHERE key IN (${quote(STATE_KEY)}, 'searchIndexBackfillWrites', 'searchIndexBackfillDay')`).map((row) => [row.key, row.value]));
  let state = meta.has(STATE_KEY) ? JSON.parse(meta.get(STATE_KEY)) : {
    format: FORMAT, cursor: "", day: utcDay(),
    writes: (meta.get("searchIndexBackfillDay") === utcDay() ? Number(meta.get("searchIndexBackfillWrites") ?? 0) : 0) + 2,
    leaseUntil: 0, complete: false,
  };
  if (statusOnly) return console.log(JSON.stringify(state));
  if (state.format !== FORMAT) throw new Error("Unexpected index format; explicit migration required.");
  if (!meta.has(STATE_KEY)) execute(`INSERT INTO catalogue_meta (key,value) VALUES (${quote(STATE_KEY)},${quote(JSON.stringify(state))}) ON CONFLICT DO NOTHING`);
  const argument = process.argv.indexOf("--max-batches");
  const maxBatches = argument < 0 ? 20 : Number(process.argv[argument + 1]);
  if (!Number.isInteger(maxBatches) || maxBatches < 1) throw new Error("Invalid --max-batches");
  for (let batch = 0; batch < maxBatches && !state.complete; batch++) {
    if (!hasHeadroom()) break;
    const reserved = reserveBatch(state, utcDay());
    if (!reserved) break;
    const rows = query(`SELECT app_id,name,release_year,developers_json,publishers_json,categories_json,genres_json,tags_json FROM games WHERE app_id > ${quote(state.cursor)} ORDER BY app_id LIMIT ${BATCH_SIZE}`);
    const values = [];
    let bytes = 0;
    for (const row of rows) {
      if (!/^\d{1,10}$/.test(row.app_id)) throw new Error(`Invalid app_id: ${row.app_id}`);
      const value = `(${Number(row.app_id)},${quote(row.app_id)},${documentFor(row).map(quote).join(",")})`;
      const size = Buffer.byteLength(value);
      if (size > 75_000) throw new Error(`Search document too large: ${row.app_id}`);
      if (bytes + size > 75_000) break;
      bytes += size;
      values.push(value);
    }
    const claimed = execute(`UPDATE catalogue_meta SET value=${quote(JSON.stringify(reserved))} WHERE key=${quote(STATE_KEY)} AND value=${quote(JSON.stringify(state))} RETURNING value`);
    if (!claimed[0]?.results?.length) throw new Error("Another backfill owns the checkpoint; retry later.");
    const committed = { ...reserved, cursor: values.length ? rows[values.length - 1].app_id : state.cursor, complete: rows.length === 0 };
    const sql = (values.length ? `INSERT OR REPLACE INTO games_search (rowid,app_id,text,genres,tags,developers,publishers,years) VALUES ${values.join(",")};\n` : "")
      + `UPDATE catalogue_meta SET value=${quote(JSON.stringify(committed))} WHERE key=${quote(STATE_KEY)};`;
    const measured = written(execute(sql, true)) + written(claimed);
    if (measured + 2 > BATCH_RESERVE) throw new Error("Batch exceeded reserved writes; stop and review before resuming.");
    const settled = { ...committed, writes: reserved.writes - BATCH_RESERVE + measured + 2, leaseUntil: 0 };
    execute(`UPDATE catalogue_meta SET value=${quote(JSON.stringify(settled))} WHERE key=${quote(STATE_KEY)} AND value=${quote(JSON.stringify(committed))}`);
    state = settled;
    console.log(JSON.stringify(state));
  }
  console.log(JSON.stringify({ ...state, nextRun: state.complete ? "--activate" : "resume; daily budget resets at 00:00 UTC" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
