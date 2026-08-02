import { FILTER_NAMES, type CatalogueMeta, type Facets, type FilterName, type SearchRequest } from "./types";
import {
  RANKING_ORDER,
  ROTATION_POOL_SIZE,
  rotatePool,
  rotates,
  rotationSeed,
  type RotationEntry,
} from "./ranking";

const SOURCE = "cloudflare-d1";

export const GAME_COLUMNS = `app_id, name, release_date, release_year, header_image,
  developers_json, publishers_json, categories_json, genres_json, screenshots_json, tags_json,
  updated_at, popularity_score, popularity_rank, steam_review_count, steam_positive_ratio,
  metacritic_score, recommendations, ranking_score, ranking_tier, steamspy_ccu, steamspy_owners_max`;

export const POPULAR_ORDER = RANKING_ORDER;

const POOL_CACHE_TTL_MS = 60_000;
const POOL_CACHE_MAX_ENTRIES = 32;
const poolCache = new Map<string, { expiresAt: number; promise: Promise<RotationEntry[]> }>();

interface GameRow {
  app_id: string;
  name: string;
  release_date: string | null;
  release_year: string;
  header_image: string | null;
  developers_json: string;
  publishers_json: string;
  categories_json: string;
  genres_json: string;
  screenshots_json: string;
  tags_json: string;
  updated_at: number;
  popularity_score: number;
  popularity_rank: number | null;
  steam_review_count: number;
  steam_positive_ratio: number;
  metacritic_score: number;
  recommendations: number;
  ranking_score: number;
  ranking_tier: number;
  steamspy_ccu: number;
  steamspy_owners_max: number;
}

let facetsInFlight: Promise<Facets> | undefined;
let metaCache: { expiresAt: number; promise: Promise<CatalogueMeta> } | undefined;

type SteamStoreItem = {
  type?: string;
  name?: string;
  steam_appid?: number;
  required_age?: number | string;
  is_free?: boolean;
  header_image?: string;
  release_date?: { coming_soon?: boolean; date?: string };
  developers?: string[];
  publishers?: string[];
  categories?: Array<{ id?: number; description?: string }>;
  genres?: Array<{ id?: string; description?: string }>;
  screenshots?: Array<{ id?: number; path_thumbnail?: string; path_full?: string }>;
  metacritic?: { score?: number; url?: string };
  recommendations?: { total?: number };
};

function stringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function toGame(row: GameRow, origin: string) {
  const appId = String(row.app_id);
  const imageBase = `${origin}/images/steam/apps/${appId}`;
  const cdnBase = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  const developers = stringArray(row.developers_json);
  const publishers = stringArray(row.publishers_json);
  const genres = stringArray(row.genres_json).slice(0, 6);
  const rawTags = stringArray(row.tags_json);
  const tags = (rawTags.length ? rawTags : stringArray(row.categories_json)).slice(0, 12);
  const screenshots = stringArray(row.screenshots_json).slice(0, 8);
  const coverUrl = `${imageBase}/header.jpg`;
  const heroUrl = `${imageBase}/library_hero.jpg`;
  const subtitle = [genres.slice(0, 2).join(" / "), developers[0]].filter(Boolean).join(" - ");

  return {
    appId,
    id: `steam-${appId}`,
    title: row.name,
    subtitle,
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: row.release_date ?? "",
    progress: 0,
    accent: "#73757d",
    cover: `linear-gradient(180deg, transparent 58%, rgba(5, 7, 10, 0.18) 100%), url("${coverUrl}") center/cover`,
    hero: `linear-gradient(180deg, transparent 58%, rgba(5, 7, 10, 0.18) 100%), url("${heroUrl}") center/cover`,
    coverUrl,
    heroUrl,
    coverFallbacks: unique([coverUrl, `${cdnBase}/header.jpg`, row.header_image]),
    heroFallbacks: unique([heroUrl, `${cdnBase}/library_hero.jpg`, screenshots[0]]),
    logo: `${imageBase}/logo.png`,
    tags,
    genres,
    developers,
    publishers,
    screenshots,
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    popularityScore: row.popularity_score,
    popularityRank: row.popularity_rank ?? undefined,
    steamReviewCount: row.steam_review_count,
    steamPositiveRatio: row.steam_positive_ratio,
    metacriticScore: row.metacritic_score,
    recommendations: row.recommendations,
    rankingScore: row.ranking_score,
    rankingTier: row.ranking_tier,
    playingNow: row.steamspy_ccu || undefined,
    ownersEstimate: row.steamspy_owners_max || undefined,
    databaseAddedAt: row.updated_at,
  };
}

async function metaValue(db: D1Database, key: string): Promise<string | null> {
  return db.prepare("SELECT value FROM catalogue_meta WHERE key = ? LIMIT 1").bind(key).first<string>("value");
}

async function readCatalogueMeta(db: D1Database): Promise<CatalogueMeta> {
  const result = await db.prepare("SELECT key, value FROM catalogue_meta WHERE key IN ('totalGames', 'updatedAt')").all<{ key: string; value: string }>();
  const meta = new Map(result.results.map(({ key, value }) => [key, value]));
  const parsedTotal = Number.parseInt(meta.get("totalGames") ?? "0", 10);
  return {
    total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
    updatedAt: meta.get("updatedAt") ?? "unknown",
  };
}

export function getCatalogueMeta(db: D1Database): Promise<CatalogueMeta> {
  const now = Date.now();
  if (metaCache && metaCache.expiresAt > now) return metaCache.promise;
  const promise = readCatalogueMeta(db).catch((error) => {
    metaCache = undefined;
    throw error;
  });
  metaCache = { expiresAt: now + 60_000, promise };
  return promise;
}

export function invalidateCatalogueMetaCache() {
  metaCache = undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storeDescriptions(values: Array<{ description?: string }> | undefined, limit = Number.MAX_SAFE_INTEGER): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.description?.trim() ?? "")
    .filter(Boolean))]
    .slice(0, limit);
}

function textArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.trim())
    .filter(Boolean))];
}

function releaseYear(date: string): string {
  const match = date.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "";
}

function releaseSort(date: string): number {
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function listText(values: string[]): string {
  return values.length ? `\n${values.join("\n")}\n` : "";
}

async function fetchSteamStoreItem(appId: string): Promise<SteamStoreItem | null> {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", appId);
  url.searchParams.set("cc", "us");
  url.searchParams.set("l", "english");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "GhostBox Catalogue Worker",
    },
  });
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, { success?: boolean; data?: SteamStoreItem }>;
  const result = payload[appId];
  if (!result?.success || !result.data?.name?.trim()) return null;
  return result.data;
}

export async function ingestSteamApp(db: D1Database, appId: string, origin: string) {
  if (!/^\d{1,10}$/.test(appId)) return { ok: false, error: "invalid_appid" };
  const data = await fetchSteamStoreItem(appId);
  if (!data) return { ok: false, error: "steam_app_not_found" };

  const now = Date.now();
  const name = data.name!.trim();
  const releaseDate = data.release_date?.date?.trim() ?? "";
  const developers = textArray(data.developers);
  const publishers = textArray(data.publishers);
  const categories = storeDescriptions(data.categories, 16);
  const genres = storeDescriptions(data.genres, 8);
  const screenshots = [...new Set((data.screenshots ?? [])
    .map((screenshot) => screenshot.path_full?.trim() ?? "")
    .filter(Boolean))]
    .slice(0, 8);
  const tags = genres.length ? genres : categories.slice(0, 12);
  const recommendations = Math.max(0, Math.trunc(data.recommendations?.total ?? 0));
  const metacriticScore = Math.max(0, Math.min(100, Math.trunc(data.metacritic?.score ?? 0)));
  const searchText = normalizeSearchText([
    appId,
    name,
    ...developers,
    ...publishers,
    ...genres,
    ...categories,
  ].join(" "));

  await db.prepare(`INSERT INTO games (
      app_id, name, release_date, release_year, release_sort, header_image,
      developers_json, publishers_json, categories_json, genres_json, screenshots_json, tags_json,
      genres_text, tags_text, updated_at, popularity_score, popularity_rank, steam_review_count, steam_positive_ratio,
      metacritic_score, recommendations, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 0, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      name = excluded.name,
      release_date = excluded.release_date,
      release_year = excluded.release_year,
      release_sort = excluded.release_sort,
      header_image = excluded.header_image,
      developers_json = excluded.developers_json,
      publishers_json = excluded.publishers_json,
      categories_json = excluded.categories_json,
      genres_json = excluded.genres_json,
      screenshots_json = excluded.screenshots_json,
      tags_json = excluded.tags_json,
      genres_text = excluded.genres_text,
      tags_text = excluded.tags_text,
      updated_at = excluded.updated_at,
      metacritic_score = excluded.metacritic_score,
      recommendations = excluded.recommendations,
      search_text = excluded.search_text`)
    .bind(
      appId,
      name,
      releaseDate,
      releaseYear(releaseDate),
      releaseSort(releaseDate),
      data.header_image?.trim() ?? "",
      JSON.stringify(developers),
      JSON.stringify(publishers),
      JSON.stringify(categories),
      JSON.stringify(genres),
      JSON.stringify(screenshots),
      JSON.stringify(tags),
      listText(genres),
      listText(tags),
      now,
      metacriticScore,
      recommendations,
      searchText,
    )
    .run();

  const total = await db.prepare("SELECT COUNT(*) AS total FROM games").first<{ total: number }>();
  const updatedAt = new Date(now).toISOString();
  await db.batch([
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('totalGames', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(total?.total ?? 0)),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('updatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(updatedAt),
  ]);
  invalidateCatalogueMetaCache();

  const game = await getGame(db, appId, origin);
  return { ok: true, appId, updatedAt, game };
}

function validFacets(value: unknown): value is Facets {
  if (!value || typeof value !== "object") return false;
  return FILTER_NAMES.every((name) => Array.isArray((value as Record<string, unknown>)[name]) &&
    (value as Record<string, unknown[]>)[name].every((item) => typeof item === "string"));
}

async function calculateFacets(db: D1Database, updatedAt: string): Promise<Facets> {
  const results = await db.batch([
    db.prepare("SELECT DISTINCT CAST(j.value AS TEXT) AS value FROM games g, json_each(CASE WHEN json_valid(g.genres_json) THEN g.genres_json ELSE '[]' END) j WHERE j.value IS NOT NULL"),
    db.prepare(`SELECT DISTINCT CAST(j.value AS TEXT) AS value
      FROM games g, json_each(CASE
        WHEN json_valid(g.tags_json) AND json_array_length(g.tags_json) > 0 THEN g.tags_json
        WHEN json_valid(g.categories_json) THEN g.categories_json
        ELSE '[]'
      END) j
      WHERE j.key < 12 AND j.value IS NOT NULL`),
    db.prepare("SELECT DISTINCT CAST(j.value AS TEXT) AS value FROM games g, json_each(CASE WHEN json_valid(g.developers_json) THEN g.developers_json ELSE '[]' END) j WHERE j.value IS NOT NULL"),
    db.prepare("SELECT DISTINCT CAST(j.value AS TEXT) AS value FROM games g, json_each(CASE WHEN json_valid(g.publishers_json) THEN g.publishers_json ELSE '[]' END) j WHERE j.value IS NOT NULL"),
    db.prepare("SELECT DISTINCT release_year AS value FROM games WHERE release_year <> ''"),
  ]);
  const facets = Object.fromEntries(FILTER_NAMES.map((name, index) => {
    const values = results[index].results
      .map((row) => String((row as { value: unknown }).value).trim())
      .filter(Boolean);
    return [name, [...new Set(values)].sort((a, b) => name === "years" ? b.localeCompare(a) : a.localeCompare(b))];
  })) as Facets;
  await db.batch([
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('facets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(facets)),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('facetsUpdatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(updatedAt),
  ]);
  return facets;
}

export async function getCatalogueFacets(db: D1Database, updatedAt: string): Promise<Facets> {
  const [stored, storedUpdatedAt] = await Promise.all([
    metaValue(db, "facets"),
    metaValue(db, "facetsUpdatedAt"),
  ]);
  if (stored !== null && storedUpdatedAt === updatedAt) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (validFacets(parsed)) return parsed;
    } catch {
      // Rebuild malformed metadata below.
    }
  }
  facetsInFlight ??= calculateFacets(db, updatedAt).finally(() => { facetsInFlight = undefined; });
  return facetsInFlight;
}

export function searchConditions(request: SearchRequest): { sql: string; bindings: unknown[] } {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  // "Jogando agora" is meaningless for the ~107k games with no SteamSpy sample
  // (steamspy_ccu = 0) — without this they'd fill the entire page with zeros.
  if (request.sort === "playingNow") clauses.push("steamspy_ccu > 0");
  const tokens = request.q.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    clauses.push("search_text LIKE ? ESCAPE '\\'");
    bindings.push(`%${token.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const columns: Record<Exclude<FilterName, "years">, string> = {
    genres: "genres_json",
    tags: "tags_json",
    developers: "developers_json",
    publishers: "publishers_json",
  };
  for (const name of FILTER_NAMES) {
    const values = request.filters[name];
    if (!values.length) continue;
    if (name === "years") {
      clauses.push(`release_year IN (${values.map(() => "?").join(", ")})`);
      bindings.push(...values);
      continue;
    }
    const jsonSource = name === "tags"
      ? `CASE
          WHEN json_valid(tags_json) AND json_array_length(tags_json) > 0 THEN tags_json
          WHEN json_valid(categories_json) THEN categories_json
          ELSE '[]'
        END`
      : columns[name];
    const keyLimit = name === "tags" ? "f.key < 12 AND " : "";
    const tests = values.map(() => `EXISTS (SELECT 1 FROM json_each(${jsonSource}) f WHERE ${keyLimit}lower(CAST(f.value AS TEXT)) = lower(?))`);
    clauses.push(`(${tests.join(" AND ")})`);
    bindings.push(...values);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

type WhereClause = ReturnType<typeof searchConditions>;

async function loadRotationPool(db: D1Database, seed: number, where: WhereClause): Promise<RotationEntry[]> {
  // Index-only walk over idx_games_ranking: ids and tiers, never full rows.
  const rows = await db.prepare(`SELECT app_id, ranking_tier FROM games ${where.sql} ORDER BY ${RANKING_ORDER} LIMIT ?`)
    .bind(...where.bindings, ROTATION_POOL_SIZE)
    .all<{ app_id: string; ranking_tier: number }>();
  const entries = rows.results.map((row) => ({ appId: String(row.app_id), tier: row.ranking_tier }));
  return rotatePool(entries, seed);
}

function rotationPool(db: D1Database, seed: number, where: WhereClause): Promise<RotationEntry[]> {
  const key = JSON.stringify([seed, where.sql, where.bindings]);
  const now = Date.now();
  const cached = poolCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = loadRotationPool(db, seed, where).catch((error) => {
    poolCache.delete(key);
    throw error;
  });
  if (poolCache.size >= POOL_CACHE_MAX_ENTRIES) poolCache.clear();
  poolCache.set(key, { expiresAt: now + POOL_CACHE_TTL_MS, promise });
  return promise;
}

/**
 * Builds the page fetch for a rotated slice.
 *
 * The ids are inlined rather than bound: D1 caps a statement at 100 bind
 * variables and a catalogue page holds up to 200 rows, so binding them fails
 * outright. Inlining is injection-safe because every id is digit-validated
 * here, and they are quoted so the TEXT `app_id` column compares without
 * relying on SQLite's numeric-literal affinity conversion.
 */
export function rotatedRowsSql(appIds: readonly string[]): string | null {
  const safe = appIds.filter((appId) => /^\d{1,10}$/.test(appId));
  if (!safe.length) return null;
  return `SELECT ${GAME_COLUMNS} FROM games WHERE app_id IN (${safe.map((appId) => `'${appId}'`).join(", ")})`;
}

async function rotatedPageRows(db: D1Database, request: SearchRequest, where: WhereClause): Promise<GameRow[]> {
  const pool = await rotationPool(db, request.seed, where);
  const slice = pool.slice(request.offset, request.offset + request.limit);
  const sql = rotatedRowsSql(slice.map((entry) => entry.appId));
  if (!sql) return [];
  const rows = await db.prepare(sql).all<GameRow>();
  const byAppId = new Map(rows.results.map((row) => [String(row.app_id), row]));
  // `IN (...)` returns rows in storage order — restore the rotated order here.
  return slice
    .map((entry) => byAppId.get(entry.appId))
    .filter((row): row is GameRow => row !== undefined);
}

export async function searchCatalogue(
  db: D1Database,
  request: SearchRequest,
  total: number,
  origin: string,
  facets?: Facets,
) {
  if (request.facetsOnly) {
    return { games: [], total, matched: total, limited: false, source: SOURCE, facets };
  }
  const where = searchConditions(request);
  const countQuery = () => (where.sql
    ? db.prepare(`SELECT COUNT(*) AS matched FROM games ${where.sql}`).bind(...where.bindings).first<{ matched: number }>()
    : Promise.resolve({ matched: total }));

  if (rotates(request)) {
    const [pageRows, count] = await Promise.all([rotatedPageRows(db, request, where), countQuery()]);
    const games = pageRows.map((row) => toGame(row, origin));
    const matched = Number(count?.matched ?? 0);
    return {
      games,
      total: matched,
      matched,
      limited: request.offset + games.length < matched,
      source: SOURCE,
      ...(facets ? { facets } : {}),
    };
  }

  const normalizedQuery = request.q.split(/\s+/).filter(Boolean).join(" ");
  const escapedQuery = normalizedQuery.replace(/[\\%_]/g, "\\$&");
  const orderBindings: unknown[] = [];
  let order = POPULAR_ORDER;
  if (normalizedQuery) {
    order = `CASE
      WHEN search_text = ? THEN 0
      WHEN search_text LIKE ? ESCAPE '\\' THEN 1
      WHEN search_text LIKE ? ESCAPE '\\' THEN 2
      ELSE 3
    END, LENGTH(name) ASC, name COLLATE NOCASE ASC`;
    orderBindings.push(normalizedQuery, `${escapedQuery}%`, `%${escapedQuery}%`);
  } else if (request.sort === "recentlyAdded") {
    order = "updated_at DESC, CAST(app_id AS INTEGER) DESC";
  } else if (request.sort === "playingNow") {
    order = "steamspy_ccu DESC, CAST(app_id AS INTEGER) ASC";
  }
  const rowLimit = request.limit + 1;
  const rowsPromise = db.prepare(`SELECT ${GAME_COLUMNS} FROM games ${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...where.bindings, ...orderBindings, rowLimit, request.offset)
    .all<GameRow>();
  const [rows, count] = await Promise.all([rowsPromise, countQuery()]);
  const pageRows = rows.results.slice(0, request.limit);
  const games = pageRows.map((row) => toGame(row, origin));
  const matched = Number(count?.matched ?? 0);
  return {
    games,
    total: matched,
    matched,
    limited: rows.results.length > request.limit || request.offset + games.length < matched,
    source: SOURCE,
    ...(facets ? { facets } : {}),
  };
}

export async function getGame(db: D1Database, appId: string, origin: string): Promise<ReturnType<typeof toGame> | null> {
  const row = await db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE app_id = ? LIMIT 1`).bind(appId).first<GameRow>();
  return row ? toGame(row, origin) : null;
}

export async function getHome(db: D1Database, meta: CatalogueMeta, origin: string, facets: Facets) {
  const emptyFilters = Object.fromEntries(
    FILTER_NAMES.map((name) => [name, [] as string[]]),
  ) as unknown as Record<FilterName, string[]>;
  const base = {
    q: "",
    offset: 0,
    includeFacets: false,
    facetsOnly: false,
    seed: rotationSeed(new Date()),
    match: "all" as const,
    filters: emptyFilters,
  };
  const [popular, recent] = await Promise.all([
    searchCatalogue(db, { ...base, limit: 20, sort: "popular" }, meta.total, origin),
    searchCatalogue(db, { ...base, limit: 12, sort: "recentlyAdded" }, meta.total, origin),
  ]);
  return {
    popular: popular.games,
    recentlyAdded: recent.games,
    total: meta.total,
    updatedAt: meta.updatedAt,
    facets,
    source: SOURCE,
  };
}
