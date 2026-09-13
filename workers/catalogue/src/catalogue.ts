import { FILTER_NAMES, type CatalogueMeta, type Facets, type FilterName, type SearchRequest } from "./types";
import {
  RANKING_ORDER,
  ROTATION_POOL_SIZE,
  rotatePool,
  rotates,
  rotationSeed,
  type RotationEntry,
} from "./ranking";
import { steamSpySnapshotSample, type SteamSpySnapshot } from "./steamspy";
import { cachedValue, cacheKey, countCacheKey } from "./cache";

const SOURCE = "cloudflare-d1";

export const GAME_COLUMNS = `games.app_id, games.name, games.release_date, games.release_year, games.header_image,
  games.developers_json, games.publishers_json, games.categories_json, games.genres_json, games.screenshots_json, games.tags_json,
  games.updated_at, games.popularity_score, games.popularity_rank, games.steam_review_count, games.steam_positive_ratio,
  games.metacritic_score, games.recommendations, games.ranking_score, games.ranking_tier, games.steamspy_ccu, games.steamspy_owners_max,
  games.app_type`;

export function normalizeCatalogueAppType(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) return "";
  return normalized;
}

export function isCatalogueDemo(appType: unknown): boolean {
  return normalizeCatalogueAppType(appType) === "demo";
}

/**
 * Exclusão definitiva: o backfill deve classificar as linhas legadas antes de
 * publicar esta versão do worker. NULL fica oculto para nunca transformar
 * "não classificado" em "jogo" e abrir uma brecha para demos.
 */
export function demoExclusionClause(tableAlias = "games"): string {
  return `(${tableAlias}.app_type IS NOT NULL AND lower(${tableAlias}.app_type) <> 'demo')`;
}

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
  app_type: string | null;
}

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

export function toGame(row: GameRow, origin: string, snapshot?: SteamSpySnapshot | null) {
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

  const steamSpySample = snapshot == null
    ? { ccu: row.steamspy_ccu, ownersMax: row.steamspy_owners_max }
    : steamSpySnapshotSample(snapshot, appId) ?? { ccu: 0, ownersMax: 0 };
  const appType = normalizeCatalogueAppType(row.app_type);
  return {
    appId,
    id: `steam-${appId}`,
    appType: appType || undefined,
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
    playingNow: steamSpySample.ccu || undefined,
    ownersEstimate: steamSpySample.ownersMax || undefined,
    databaseAddedAt: row.updated_at,
  };
}

async function metaValue(db: D1Database, key: string): Promise<string | null> {
  return db.prepare("SELECT value FROM catalogue_meta WHERE key = ? LIMIT 1").bind(key).first<string>("value");
}

async function readCatalogueMeta(db: D1Database): Promise<CatalogueMeta> {
  const result = await db.prepare("SELECT key, value FROM catalogue_meta WHERE key IN ('totalGames', 'updatedAt', 'steamspySampledAt', 'searchIndexVersion')").all<{ key: string; value: string }>();
  const meta = new Map(result.results.map(({ key, value }) => [key, value]));
  const parsedTotal = Number.parseInt(meta.get("totalGames") ?? "0", 10);
  return {
    total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
    updatedAt: meta.get("updatedAt") ?? "unknown",
    searchIndexVersion: meta.get("searchIndexVersion") ?? "",
    steamspySampledAt: meta.get("steamspySampledAt") ?? "never",
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

export function normalizeSearchText(value: string): string {
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

export function facetToken(value: string): string {
  const normalized = value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "";
  return `f${[...new TextEncoder().encode(normalized)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function facetTokens(values: string[]): string {
  return [...new Set(values.map(facetToken).filter(Boolean))].join(" ");
}

export interface SearchDocument {
  text: string;
  genres: string;
  tags: string;
  developers: string;
  publishers: string;
  years: string;
}

export function searchDocument(
  appId: string,
  name: string,
  developers: string[],
  publishers: string[],
  genres: string[],
  tags: string[],
  year: string,
): SearchDocument {
  return {
    text: normalizeSearchText([appId, name, ...developers, ...publishers, ...genres, ...tags].join(" ")),
    genres: facetTokens(genres),
    tags: facetTokens(tags),
    developers: facetTokens(developers),
    publishers: facetTokens(publishers),
    years: facetTokens(year ? [year] : []),
  };
}

function emptyFacets(): Facets {
  return Object.fromEntries(FILTER_NAMES.map((name) => [name, []])) as unknown as Facets;
}

function facetsFromGame(
  developers: string[],
  publishers: string[],
  genres: string[],
  tags: string[],
  year: string,
): Facets {
  return { genres, tags, developers, publishers, years: year ? [year] : [] };
}

function mergeFacets(current: Facets, additions: Facets): Facets {
  return Object.fromEntries(FILTER_NAMES.map((name) => [name,
    [...new Set([...current[name], ...additions[name]])].sort((left, right) =>
      name === "years" ? right.localeCompare(left) : left.localeCompare(right)),
  ])) as Facets;
}

function parseFacets(value: string | null): Facets {
  if (!value) return emptyFacets();
  try {
    const parsed: unknown = JSON.parse(value);
    return validFacets(parsed) ? parsed : emptyFacets();
  } catch {
    return emptyFacets();
  }
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

export async function ingestSteamApp(db: D1Database, appId: string, origin: string, onChanged?: () => Promise<unknown>) {
  if (!/^\d{1,10}$/.test(appId)) return { ok: false, error: "invalid_appid" };

  const existing = await db.prepare("SELECT updated_at, app_type FROM games WHERE app_id = ? LIMIT 1")
    .bind(appId)
    .first<{ updated_at: number; app_type: string | null }>();
  if (existing) {
    if (isCatalogueDemo(existing.app_type)) return { ok: false, error: "steam_app_is_demo" };
    if (!normalizeCatalogueAppType(existing.app_type)) {
      // Rows created before app_type existed are classified lazily when an
      // explicit ingest is requested. A missing type is not safe to expose.
      const data = await fetchSteamStoreItem(appId);
      const appType = normalizeCatalogueAppType(data?.type);
      if (!data || !appType) return { ok: false, error: "steam_app_type_unavailable" };
      await db.prepare("UPDATE games SET app_type = ? WHERE app_id = ?")
        .bind(appType, appId)
        .run();
      invalidateCatalogueMetaCache();
      poolCache.clear();
      if (appType === "demo") {
        await onChanged?.();
        return { ok: false, error: "steam_app_is_demo" };
      }
      await onChanged?.();
    }
    const game = await getGame(db, appId, origin);
    if (!game) return { ok: false, error: "steam_app_is_demo" };
    return { ok: true, appId, updatedAt: new Date(existing.updated_at).toISOString(), game };
  }

  const data = await fetchSteamStoreItem(appId);
  if (!data) return { ok: false, error: "steam_app_not_found" };
  const appType = normalizeCatalogueAppType(data.type);
  if (!appType) return { ok: false, error: "steam_app_type_unavailable" };
  if (appType === "demo") return { ok: false, error: "steam_app_is_demo" };

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
  const year = releaseYear(releaseDate);
  const document = searchDocument(appId, name, developers, publishers, genres, tags, year);
  document.text = normalizeSearchText([appId, name, ...developers, ...publishers, ...genres, ...categories].join(" "));
  const [storedTotal, storedFacets] = await Promise.all([
    metaValue(db, "totalGames"),
    metaValue(db, "facets"),
  ]);
  const parsedTotal = Number.parseInt(storedTotal ?? "", 10);
  const total = Number.isFinite(parsedTotal)
    ? parsedTotal + 1
    : Number((await db.prepare("SELECT COUNT(*) AS total FROM games").first<{ total: number }>())?.total ?? 0) + 1;
  const nowFacets = mergeFacets(parseFacets(storedFacets), facetsFromGame(developers, publishers, genres, tags, year));
  const gameStatement = db.prepare(`INSERT INTO games (
      app_id, name, release_date, release_year, release_sort, header_image,
      developers_json, publishers_json, categories_json, genres_json, screenshots_json, tags_json,
      genres_text, tags_text, updated_at, popularity_score, popularity_rank, steam_review_count, steam_positive_ratio,
      metacritic_score, recommendations, search_text, app_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 0, ?, ?, ?, ?)`)
    .bind(
      appId,
      name,
      releaseDate,
      year,
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
      document.text,
      appType || null,
    );
  const updatedAt = new Date(now).toISOString();
  await db.batch([
    gameStatement,
    db.prepare("INSERT INTO games_search (rowid, app_id, text, genres, tags, developers, publishers, years) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(Number(appId), appId, document.text, document.genres, document.tags, document.developers, document.publishers, document.years),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('totalGames', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(total)),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('updatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(updatedAt),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('facets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(nowFacets)),
    db.prepare("INSERT INTO catalogue_meta (key, value) VALUES ('facetsUpdatedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(updatedAt),
  ]);
  invalidateCatalogueMetaCache();
  poolCache.clear();
  await onChanged?.();

  const game = await getGame(db, appId, origin);
  return { ok: true, appId, updatedAt, game };
}

function validFacets(value: unknown): value is Facets {
  if (!value || typeof value !== "object") return false;
  return FILTER_NAMES.every((name) => Array.isArray((value as Record<string, unknown>)[name]) &&
    (value as Record<string, unknown[]>)[name].every((item) => typeof item === "string"));
}

export async function getCatalogueFacets(db: D1Database, _updatedAt: string): Promise<Facets> {
  // Facets are materialized by ingestion/backfill. Rebuilding them per request
  // used to be the largest source of D1 reads.
  return parseFacets(await metaValue(db, "facets"));
}

export function searchConditions(request: SearchRequest, useSteamSpySnapshot = false): { sql: string; bindings: unknown[] } {
  const clauses: string[] = [demoExclusionClause("games")];
  const bindings: unknown[] = [];
  // "Jogando agora" is meaningless for the ~107k games with no SteamSpy sample
  // (steamspy_ccu = 0) — without this they'd fill the entire page with zeros.
  if (request.sort === "playingNow") {
    clauses.push(`${useSteamSpySnapshot ? "steamspy.sample_ccu" : "games.steamspy_ccu"} > 0`);
  }
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
    // The legacy tag filter only exposes twelve entries. Scalar extraction
    // preserves that behavior without billing twelve virtual rows per game.
    const tests = values.map(() => name === "tags"
      ? `lower(?) IN (${Array.from({ length: 12 }, (_, index) => `lower(CAST(json_extract(${jsonSource}, '$[${index}]') AS TEXT))`).join(", ")})`
      : `EXISTS (SELECT 1 FROM json_each(${jsonSource}) f WHERE lower(CAST(f.value AS TEXT)) = lower(?))`);
    clauses.push(`(${tests.join(" AND ")})`);
    bindings.push(...values);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

function hasSearchCriteria(request: SearchRequest): boolean {
  return request.q.length > 0 || FILTER_NAMES.some((name) => request.filters[name].length > 0);
}

export function searchIndexMatch(request: SearchRequest): string | null {
  const terms = request.q.split(/\s+/).filter(Boolean).map((term) => `text:${term}*`);
  for (const name of FILTER_NAMES) {
    const filters: string[] = [];
    for (const value of [...new Set(request.filters[name])]) {
      const token = facetToken(value);
      if (token) filters.push(`${name}:${token}`);
    }
    if (filters.length) terms.push(`(${filters.join(name === "years" ? " OR " : " AND ")})`);
  }
  return terms.length ? terms.join(" AND ") : null;
}

export function indexedSearchConditions(request: SearchRequest, useSteamSpySnapshot = false): { sql: string; bindings: unknown[] } {
  const clauses: string[] = [demoExclusionClause("games")];
  const bindings: unknown[] = [];
  if (request.sort === "playingNow") {
    clauses.push(`${useSteamSpySnapshot ? "steamspy.sample_ccu" : "games.steamspy_ccu"} > 0`);
  }
  const match = searchIndexMatch(request);
  if (match) {
    clauses.push("games_search MATCH ?");
    bindings.push(match);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, bindings };
}

type WhereClause = ReturnType<typeof searchConditions>;

async function loadRotationPool(db: D1Database, seed: number, where: WhereClause, indexed: boolean): Promise<RotationEntry[]> {
  // Index-only walk over idx_games_ranking: ids and tiers, never full rows.
  const source = indexed ? "FROM games_search CROSS JOIN games ON games.app_id = games_search.app_id" : "FROM games";
  const order = indexed ? "games.ranking_tier DESC, CAST(games.app_id AS INTEGER) ASC" : RANKING_ORDER;
  const rows = await db.prepare(`SELECT games.app_id, games.ranking_tier ${source} ${where.sql} ORDER BY ${order} LIMIT ?`)
    .bind(...where.bindings, ROTATION_POOL_SIZE)
    .all<{ app_id: string; ranking_tier: number }>();
  const entries = rows.results.map((row) => ({ appId: String(row.app_id), tier: row.ranking_tier }));
  return rotatePool(entries, seed);
}

function rotationPool(db: D1Database, seed: number, where: WhereClause, indexed: boolean): Promise<RotationEntry[]> {
  const key = JSON.stringify([seed, indexed, where.sql, where.bindings]);
  const now = Date.now();
  const cached = poolCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = loadRotationPool(db, seed, where, indexed).catch((error) => {
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
  // Exclusão de demos também no fetch por IDs (pool rotacionado e branch
  // SteamSpy): IDs amostrados passam por aqui antes de virar `toGame`.
  return `SELECT ${GAME_COLUMNS} FROM games WHERE app_id IN (${safe.map((appId) => `'${appId}'`).join(", ")}) AND ${demoExclusionClause("games")}`;
}

async function rotatedPageRows(db: D1Database, request: SearchRequest, where: WhereClause, indexed: boolean, revision: string): Promise<GameRow[]> {
  const pool = await cachedValue(cacheKey("count", JSON.stringify(["rotation", request.seed, indexed, where]), revision), 3600,
    () => rotationPool(db, request.seed, where, indexed));
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
  snapshot?: SteamSpySnapshot | null,
  catalogueUpdatedAt = "unknown",
  useSearchIndex = false,
) {
  if (request.facetsOnly) {
    return { games: [], total, matched: total, limited: false, source: SOURCE, facets };
  }
  const useSnapshot = Boolean(snapshot && request.sort === "playingNow");
  if (useSnapshot && !hasSearchCriteria(request)) {
    const ids = await cachedValue(cacheKey("count", `playing-ids:${snapshot!.sampledAt}`, catalogueUpdatedAt), 3600, async () => {
      const positiveIds = Object.entries(snapshot!.samples).filter(([, sample]) => sample[0] > 0).map(([id]) => id);
      const rows = await db.prepare(`SELECT games.app_id FROM json_each(?) AS sample CROSS JOIN games ON games.app_id = sample.value WHERE ${demoExclusionClause("games")}`)
        .bind(JSON.stringify(positiveIds)).all<{ app_id: string }>();
      return rows.results.map((row) => row.app_id).sort((a, b) => snapshot!.samples[b][0] - snapshot!.samples[a][0] || Number(a) - Number(b));
    });
    const page = ids.slice(request.offset, request.offset + request.limit);
    const sql = rotatedRowsSql(page);
    const rows = sql ? (await db.prepare(sql).all<GameRow>()).results : [];
    const byId = new Map(rows.map((row) => [row.app_id, row]));
    const games = page.filter((id) => byId.has(id)).map((id) => toGame(byId.get(id)!, origin, snapshot));
    return { games, total: ids.length, matched: ids.length, limited: request.offset + games.length < ids.length, source: SOURCE, ...(facets ? { facets } : {}) };
  }
  const indexed = useSearchIndex && hasSearchCriteria(request);
  const where = indexed
    ? indexedSearchConditions(request, useSnapshot)
    : searchConditions(request, useSnapshot);
  const snapshotCcu = indexed && useSnapshot
    ? `COALESCE(json_extract(steamspy_data.samples, '$."' || games.app_id || '"[0]'), 0)`
    : "steamspy.sample_ccu";
  if (indexed && useSnapshot) where.sql = where.sql.replaceAll("steamspy.sample_ccu", snapshotCcu);
  const snapshotJson = useSnapshot ? JSON.stringify(snapshot!.samples) : null;
  const snapshotCte = useSnapshot
    ? indexed
      ? "WITH steamspy_data AS (SELECT ? AS samples) "
      : "WITH steamspy AS (SELECT key AS snapshot_app_id, CAST(json_extract(value, '$[0]') AS INTEGER) AS sample_ccu FROM json_each(?)) "
    : "";
  const gamesSource = indexed
    ? "games_search CROSS JOIN games ON games.app_id = games_search.app_id"
    : "games";
  const fromClause = useSnapshot
    ? indexed
      ? `FROM ${gamesSource} CROSS JOIN steamspy_data`
      : `FROM ${gamesSource} JOIN steamspy ON steamspy.snapshot_app_id = games.app_id`
    : `FROM ${gamesSource}`;
  // Quando indexado, o COUNT precisa do JOIN com `games` para aplicar a
  // exclusão de demos (`games.app_type` não existe em `games_search`).
  const countFrom = indexed && !useSnapshot && request.sort !== "playingNow"
    ? "FROM games_search CROSS JOIN games ON games.app_id = games_search.app_id"
    : fromClause;
  const countQuery = () => (where.sql
    ? cachedValue(
      countCacheKey(request, `${catalogueUpdatedAt}:${useSnapshot ? snapshot!.sampledAt : "d1"}`, origin),
      request.sort === "playingNow" ? 300 : 86400,
      () => db.prepare(`${snapshotCte}SELECT COUNT(*) AS matched ${countFrom} ${where.sql}`)
        .bind(...(useSnapshot ? [snapshotJson] : []), ...where.bindings)
        .first<{ matched: number }>(),
    )
    : Promise.resolve({ matched: total }));

  if (rotates(request)) {
    const [pageRows, count] = await Promise.all([rotatedPageRows(db, request, where, indexed, catalogueUpdatedAt), countQuery()]);
    const games = pageRows.map((row) => toGame(row, origin, snapshot));
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
  let order = indexed ? "games.ranking_tier DESC, CAST(games.app_id AS INTEGER) ASC" : POPULAR_ORDER;
  if (normalizedQuery) {
    if (indexed) {
      order = "bm25(games_search), LENGTH(games.name) ASC, games.name COLLATE NOCASE ASC";
    } else {
      order = `CASE
        WHEN games.search_text = ? THEN 0
        WHEN games.search_text LIKE ? ESCAPE '\\' THEN 1
        WHEN games.search_text LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END, LENGTH(games.name) ASC, games.name COLLATE NOCASE ASC`;
      orderBindings.push(normalizedQuery, `${escapedQuery}%`, `%${escapedQuery}%`);
    }
  } else if (request.sort === "recentlyAdded") {
    order = "games.updated_at DESC, CAST(games.app_id AS INTEGER) DESC";
  } else if (request.sort === "playingNow") {
    order = `${useSnapshot ? snapshotCcu : "games.steamspy_ccu"} DESC, CAST(games.app_id AS INTEGER) ASC`;
  }
  const rowLimit = request.limit + 1;
  const rowsPromise = db.prepare(`${snapshotCte}SELECT ${GAME_COLUMNS} ${fromClause} ${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...(useSnapshot ? [snapshotJson] : []), ...where.bindings, ...orderBindings, rowLimit, request.offset)
    .all<GameRow>();
  const [rows, count] = await Promise.all([rowsPromise, countQuery()]);
  const pageRows = rows.results.slice(0, request.limit);
  const games = pageRows.map((row) => toGame(row, origin, snapshot));
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

export async function getGame(db: D1Database, appId: string, origin: string, snapshot?: SteamSpySnapshot | null): Promise<ReturnType<typeof toGame> | null> {
  const row = await db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE app_id = ? LIMIT 1`).bind(appId).first<GameRow>();
  if (!row) return null;
  if (isCatalogueDemo(row.app_type)) return null;
  return toGame(row, origin, snapshot);
}

export async function getHome(
  db: D1Database,
  meta: CatalogueMeta,
  origin: string,
  facets: Facets,
  snapshot?: SteamSpySnapshot | null,
) {
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
    searchCatalogue(db, { ...base, limit: 20, sort: "popular" }, meta.total, origin, undefined, snapshot),
    searchCatalogue(db, { ...base, limit: 12, sort: "recentlyAdded" }, meta.total, origin, undefined, snapshot),
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
