import { invalidateCatalogueMetaCache, normalizeSearchText, searchDocument, type SearchDocument } from "./catalogue";

export const SEARCH_INDEX_CRON = "*/2 * * * *";

const STATE_KEY = "searchIndexBackfillState";
const FORMAT = 2;
const DAILY_WRITE_BUDGET = 80_000;
const BATCH_RESERVE = 1_000;
const BATCH_SIZE = 75;
const LEASE_MS = 10 * 60_000;

interface SearchSourceRow {
  app_id: string;
  name: string;
  release_year: string;
  developers_json: string;
  publishers_json: string;
  categories_json: string;
  genres_json: string;
  tags_json: string;
}

interface SearchIndexState {
  format: number;
  cursor: string;
  day: string;
  writes: number;
  leaseUntil: number;
  complete: boolean;
  activated?: boolean;
  error?: string;
}

export interface SearchIndexProgress {
  status: "progress" | "budget" | "leased" | "complete" | "activated" | "error";
  cursor: string;
  writes: number;
  indexed?: number;
  error?: string;
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

export function searchDocumentForRow(row: SearchSourceRow): SearchDocument {
  const developers = parseArray(row.developers_json);
  const publishers = parseArray(row.publishers_json);
  const categories = parseArray(row.categories_json);
  const genres = parseArray(row.genres_json);
  const storedTags = parseArray(row.tags_json);
  const tags = (storedTags.length ? storedTags : categories).slice(0, 12);
  const document = searchDocument(row.app_id, row.name, developers, publishers, genres, tags, row.release_year);
  document.text = normalizeSearchText([row.app_id, row.name, ...developers, ...publishers, ...genres, ...categories].join(" "));
  return document;
}

function initialState(day: string): SearchIndexState {
  return { format: FORMAT, cursor: "", day, writes: 0, leaseUntil: 0, complete: false };
}

function parseState(value: string | null, day: string): SearchIndexState {
  if (!value) return initialState(day);
  try {
    const state = JSON.parse(value) as SearchIndexState;
    if (state.format === FORMAT && typeof state.cursor === "string" && Number.isFinite(state.writes)) return state;
  } catch { /* Start the current format from the beginning. */ }
  return initialState(day);
}

function stateStatement(db: D1Database, state: SearchIndexState) {
  return db.prepare("INSERT INTO catalogue_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(STATE_KEY, JSON.stringify(state));
}

function written(result: D1Result<unknown>): number {
  const value = Number(result.meta?.rows_written);
  if (!Number.isFinite(value)) throw new Error("D1 did not report rows_written");
  return value;
}

async function validateAndActivate(db: D1Database, state: SearchIndexState): Promise<SearchIndexProgress> {
  try {
    const counts = await db.prepare("SELECT (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM games_search) AS indexed")
      .first<{ games: number; indexed: number }>();
    if (!counts || Number(counts.games) !== Number(counts.indexed)) throw new Error(`count mismatch: ${JSON.stringify(counts)}`);
    const missing = await db.prepare("SELECT games.app_id FROM games WHERE NOT EXISTS (SELECT 1 FROM games_search WHERE rowid=CAST(games.app_id AS INTEGER)) LIMIT 1").first<string>("app_id");
    const extra = await db.prepare("SELECT app_id FROM games_search WHERE NOT EXISTS (SELECT 1 FROM games WHERE games.app_id=games_search.app_id) LIMIT 1").first<string>("app_id");
    if (missing || extra) throw new Error(`coverage mismatch: missing=${missing ?? "none"}, extra=${extra ?? "none"}`);
    const samples = await db.prepare(`SELECT games.app_id,games.name,games.release_year,games.developers_json,games.publishers_json,
      games.categories_json,games.genres_json,games.tags_json,
      games_search.text AS index_text,games_search.genres AS index_genres,games_search.tags AS index_tags,
      games_search.developers AS index_developers,games_search.publishers AS index_publishers,games_search.years AS index_years
      FROM games JOIN games_search ON games_search.rowid=CAST(games.app_id AS INTEGER)
      ORDER BY games.app_id LIMIT 12`).all<SearchSourceRow & Record<`index_${keyof SearchDocument}`, string>>();
    for (const row of samples.results) {
      const expected = searchDocumentForRow(row);
      for (const key of Object.keys(expected) as Array<keyof SearchDocument>) {
        if (row[`index_${key}`] !== expected[key]) throw new Error(`sample mismatch: ${row.app_id}.${key}`);
      }
    }
    const activated = { ...state, activated: true, leaseUntil: 0 };
    await db.batch([
      db.prepare("INSERT INTO catalogue_meta (key,value) VALUES ('searchIndexVersion','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
      stateStatement(db, activated),
    ]);
    invalidateCatalogueMetaCache();
    return { status: "activated", cursor: state.cursor, writes: state.writes, indexed: Number(counts.indexed) };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    await stateStatement(db, { ...state, error, leaseUntil: 0 }).run();
    return { status: "error", cursor: state.cursor, writes: state.writes, error };
  }
}

export async function runSearchIndexBackfill(db: D1Database, timestamp = Date.now()): Promise<SearchIndexProgress> {
  const day = utcDay(timestamp);
  const stored = await db.prepare("SELECT value FROM catalogue_meta WHERE key=? LIMIT 1").bind(STATE_KEY).first<string>("value");
  const state = parseState(stored, day);
  if (state.error) return { status: "error", cursor: state.cursor, writes: state.writes, error: state.error };
  if (state.activated) return { status: "activated", cursor: state.cursor, writes: state.writes };
  if (state.complete) return validateAndActivate(db, state);
  if (state.leaseUntil > Date.now()) return { status: "leased", cursor: state.cursor, writes: state.writes };
  const dayWrites = state.day === day ? state.writes : 0;
  if (dayWrites + BATCH_RESERVE > DAILY_WRITE_BUDGET) return { status: "budget", cursor: state.cursor, writes: dayWrites };

  const reserved: SearchIndexState = { ...state, day, writes: dayWrites + BATCH_RESERVE, leaseUntil: Date.now() + LEASE_MS };
  const claim = stored
    ? await db.prepare("UPDATE catalogue_meta SET value=? WHERE key=? AND value=?").bind(JSON.stringify(reserved), STATE_KEY, stored).run()
    : await db.prepare("INSERT INTO catalogue_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING").bind(STATE_KEY, JSON.stringify(reserved)).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return { status: "leased", cursor: state.cursor, writes: dayWrites };

  const rows = await db.prepare(`SELECT app_id,name,release_year,developers_json,publishers_json,categories_json,genres_json,tags_json
    FROM games WHERE app_id>? ORDER BY app_id LIMIT ?`).bind(state.cursor, BATCH_SIZE).all<SearchSourceRow>();
  const nextCursor = rows.results.at(-1)?.app_id ?? state.cursor;
  const checkpoint: SearchIndexState = { ...reserved, cursor: nextCursor, complete: rows.results.length === 0 };
  const statements = rows.results.map((row) => {
    if (!/^\d{1,10}$/.test(row.app_id)) throw new Error(`invalid app_id: ${row.app_id}`);
    const document = searchDocumentForRow(row);
    return db.prepare("INSERT OR REPLACE INTO games_search (rowid,app_id,text,genres,tags,developers,publishers,years) VALUES (?,?,?,?,?,?,?,?)")
      .bind(Number(row.app_id), row.app_id, document.text, document.genres, document.tags, document.developers, document.publishers, document.years);
  });
  statements.push(stateStatement(db, checkpoint));
  const results = await db.batch(statements);
  const measured = written(claim) + results.reduce((sum, result) => sum + written(result), 0) + 1;
  if (measured > BATCH_RESERVE) {
    await stateStatement(db, { ...checkpoint, error: `batch exceeded ${BATCH_RESERVE} reserved writes`, leaseUntil: 0 }).run();
    return { status: "error", cursor: nextCursor, writes: reserved.writes, error: "write reservation exceeded" };
  }
  const settled: SearchIndexState = { ...checkpoint, writes: dayWrites + measured, leaseUntil: 0 };
  await stateStatement(db, settled).run();
  return { status: settled.complete ? "complete" : "progress", cursor: settled.cursor, writes: settled.writes, indexed: rows.results.length };
}
