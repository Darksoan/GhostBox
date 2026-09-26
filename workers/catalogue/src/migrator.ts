import { packScreenshots } from "./screenshots";
import { searchDocumentForRow } from "./search-index";

const BATCH_SIZE = 25;
const BATCH_WRITE_RESERVE = 220;
const DAILY_WRITE_BUDGET = 60_000;
const MAX_DB_BYTES = 375_000_000;
const CURSOR_KEY = "v2MigrationCursor";
const BUDGET_KEY = "v2MigrationWriteBudget";
const PAUSE_KEY = "v2MigrationPaused";
const FIELDS = [
  "app_id", "name", "release_date", "release_year", "release_sort", "header_image",
  "developers_json", "publishers_json", "categories_json", "genres_json", "screenshots_json", "tags_json",
  "updated_at", "popularity_score", "popularity_rank", "steam_review_count", "steam_positive_ratio",
  "metacritic_score", "recommendations", "steamspy_ccu", "steamspy_owners_max", "app_type",
] as const;

type SourceRow = Record<(typeof FIELDS)[number], string | number | null>;
type MetaRow = { key: string; value: string };

function quote(value: string | number | null | undefined): string {
  return value == null ? "NULL" : typeof value === "number" && Number.isFinite(value)
    ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
}

export async function migratePage(source: D1Database, target: D1Database, scheduledTime: number): Promise<string> {
  const state = await target.prepare(`SELECT key,value FROM catalogue_meta WHERE key IN (?,?,?,'searchIndexVersion')`)
    .bind(CURSOR_KEY, BUDGET_KEY, PAUSE_KEY).all<MetaRow>();
  const meta = new Map(state.results.map((row) => [row.key, row.value]));
  if (meta.has(PAUSE_KEY) || meta.get("searchIndexVersion") === "2") return "paused";
  // D1Result.meta.size_after is the measured database file size, not an
  // estimate based on row payloads. Read it before each attempted batch.
  if (!Number.isFinite(state.meta.size_after) || state.meta.size_after > MAX_DB_BYTES) return "capacity";
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  const budget = JSON.parse(meta.get(BUDGET_KEY) ?? "null") as { day?: string; writes?: number } | null;
  const writes = budget?.day === day ? Number(budget.writes ?? 0) : 0;
  if (!Number.isFinite(writes) || writes + BATCH_WRITE_RESERVE > DAILY_WRITE_BUDGET) return "budget";
  const cursor = meta.get(CURSOR_KEY) ?? "";
  // v1 has no app_type column; legacy rows are kept visible as unclassified.
  const fields = FIELDS.filter((field) => field !== "app_type");
  const rows = await source.prepare(`SELECT ${fields.join(",")} FROM games WHERE app_id>? ORDER BY app_id LIMIT ?`)
    .bind(cursor, BATCH_SIZE).all<SourceRow>();
  if (!rows.results.length) return "complete"; // Activation requires separate size/coverage validation.

  const games: string[] = [];
  const documents: string[] = [];
  for (const row of rows.results) {
    const appId = String(row.app_id);
    if (!/^\d{1,10}$/.test(appId)) throw new Error(`Invalid legacy app ID: ${appId}`);
    const values = {
      ...row,
      screenshots_json: packScreenshots(appId, JSON.parse(String(row.screenshots_json || "[]")) as string[]),
      app_type: "unclassified",
    };
    games.push(`(${FIELDS.map((field) => quote(values[field])).join(",")})`);
    const doc = searchDocumentForRow(row as unknown as Parameters<typeof searchDocumentForRow>[0]);
    documents.push(`(${Number(appId)},${[doc.text, doc.genres, doc.tags, doc.developers, doc.publishers, doc.years].map(quote).join(",")})`);
  }
  const next = String(rows.results.at(-1)!.app_id);
  const statements = [
    target.prepare(`INSERT INTO games(${FIELDS.join(",")}) VALUES ${games.join(",")} ON CONFLICT(app_id) DO NOTHING`),
    target.prepare(`INSERT OR REPLACE INTO games_search(rowid,text,genres,tags,developers,publishers,years) VALUES ${documents.join(",")}`),
    target.prepare("INSERT INTO catalogue_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(CURSOR_KEY, next),
    target.prepare("INSERT INTO catalogue_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(BUDGET_KEY, JSON.stringify({ day, writes: writes + BATCH_WRITE_RESERVE })),
  ];
  const results = await target.batch(statements);
  const measured = results.reduce((sum, result) => sum + Number(result.meta.rows_written ?? 0), 0);
  const finalSize = results.at(-1)?.meta.size_after;
  if (measured > BATCH_WRITE_RESERVE || !Number.isFinite(finalSize) || finalSize! > MAX_DB_BYTES) {
    await target.prepare("INSERT INTO catalogue_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(PAUSE_KEY, `writes=${measured}, size=${finalSize}`).run();
    return "capacity";
  }
  console.log("catalogue v2 migration", JSON.stringify({ cursor: next, writes: measured, size: finalSize }));
  return "progress";
}

export default {
  async scheduled(event: ScheduledController, env: { SOURCE_DB: D1Database; DB: D1Database }) {
    try {
      const status = await migratePage(env.SOURCE_DB, env.DB, event.scheduledTime);
      if (status !== "progress" && status !== "budget") console.log("catalogue v2 migration", status);
    } catch (error) {
      console.error("catalogue v2 migration failed", error);
    }
  },
  fetch() { return new Response("Not found", { status: 404 }); },
};
