import { cacheControl, cacheKey, canonicalSearchKey, cloudflareCacheControl, searchTtl } from "./cache";
import { getCatalogueFacets, getCatalogueMeta, getGame, getHome, searchCatalogue } from "./catalogue";
import { FILTER_NAMES, type Env, type SearchRequest, type Sort } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function edgeCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default;
}

export function parseSearch(url: URL): SearchRequest {
  const integer = (name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = Number.parseInt(url.searchParams.get(name) ?? "", 10);
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : fallback;
  };
  const sort: Sort = url.searchParams.get("sort") === "recentlyAdded" ? "recentlyAdded" : "popular";
  return {
    q: normalizeSearchText(url.searchParams.get("q") ?? ""),
    limit: integer("limit", 20, 200),
    offset: integer("offset", 0),
    sort,
    includeFacets: url.searchParams.get("includeFacets") === "1",
    facetsOnly: url.searchParams.get("facetsOnly") === "1",
    filters: Object.fromEntries(FILTER_NAMES.map((name) => [name,
      url.searchParams.getAll(name).map((value) => value.trim()).filter(Boolean),
    ])) as SearchRequest["filters"],
  };
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

function json(value: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function responseHeaders(route: string, source: "edge" | "d1", updatedAt: string, ttl: number): HeadersInit {
  return {
    "cache-control": cacheControl(ttl),
    "cloudflare-cdn-cache-control": cloudflareCacheControl(ttl),
    "x-piratebox-cache": source === "edge" ? "HIT" : "MISS",
    "x-piratebox-route": route,
    "x-piratebox-source": source,
    "x-piratebox-updated-at": updatedAt,
  };
}

function privateResponseHeaders(route: string, source: "edge" | "d1", updatedAt: string): HeadersInit {
  return {
    "cache-control": "no-store",
    "x-piratebox-cache": source === "edge" ? "HIT" : "MISS",
    "x-piratebox-route": route,
    "x-piratebox-source": source,
    "x-piratebox-updated-at": updatedAt,
  };
}

interface LoadedResponse {
  body: unknown;
  status?: number;
}

async function cachedJson(
  key: string,
  route: string,
  updatedAt: string,
  ttl: number,
  ctx: ExecutionContext,
  load: () => Promise<LoadedResponse>,
  shared = true,
): Promise<Response> {
  const cache = edgeCache();
  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    const headers = shared
      ? responseHeaders(route, "edge", updatedAt, ttl)
      : privateResponseHeaders(route, "edge", updatedAt);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    if (!shared) response.headers.delete("cloudflare-cdn-cache-control");
    return response;
  }
  const loaded = await load();
  if (loaded.status && loaded.status !== 200) {
    return json(loaded.body, loaded.status, { "cache-control": "private, no-store" });
  }
  const headers = shared
    ? responseHeaders(route, "d1", updatedAt, ttl)
    : privateResponseHeaders(route, "d1", updatedAt);
  const response = json(loaded.body, 200, headers);
  const stored = response.clone();
  stored.headers.set("cache-control", `public, max-age=${ttl}`);
  stored.headers.delete("cloudflare-cdn-cache-control");
  ctx.waitUntil(cache.put(key, stored).catch(() => undefined));
  return response;
}

async function imageProxy(request: Request, appId: string, asset: string, ctx: ExecutionContext): Promise<Response> {
  if (!/^\d+$/.test(appId) || !ASSET_PATTERN.test(asset)) return json({ error: "not found" }, 404, { "cache-control": "private, no-store" });
  const key = new Request(`https://catalogue-images.invalid/steam/apps/${appId}/${asset}`);
  const hit = await edgeCache().match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("cache-control", cacheControl(7 * 24 * 60 * 60));
    response.headers.set("cloudflare-cdn-cache-control", cloudflareCacheControl(7 * 24 * 60 * 60));
    return response;
  }
  const upstream = await fetch(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`, {
    headers: { accept: request.headers.get("accept") ?? "image/*" },
  });
  if (!upstream.ok || !upstream.body) return json({ error: "image not found" }, upstream.status === 404 ? 404 : 502, { "cache-control": "private, no-store" });
  const length = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) return json({ error: "image too large" }, 413, { "cache-control": "private, no-store" });
  let received = 0;
  const bounded = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_IMAGE_BYTES) throw new Error("image exceeds size limit");
      controller.enqueue(chunk);
    },
  }));
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", cacheControl(7 * 24 * 60 * 60));
  headers.set("cloudflare-cdn-cache-control", cloudflareCacheControl(7 * 24 * 60 * 60));
  headers.set("access-control-allow-origin", "*");
  const response = new Response(bounded, { status: upstream.status, headers });
  const stored = response.clone();
  stored.headers.set("cache-control", "public, max-age=604800");
  stored.headers.delete("cloudflare-cdn-cache-control");
  ctx.waitUntil(edgeCache().put(key, stored).catch(() => undefined));
  return response;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...JSON_HEADERS, "access-control-allow-methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { "cache-control": "private, no-store", allow: "GET, OPTIONS" });
  const url = new URL(request.url);
  const image = url.pathname.match(/^\/images\/steam\/apps\/(\d+)\/([^/]+)$/);
  if (image) return imageProxy(request, image[1], image[2], ctx);

  const meta = await getCatalogueMeta(env.DB);
  if (url.pathname === "/catalogue/search") {
    const search = parseSearch(url);
    const ttl = searchTtl(search);
    const route = search.facetsOnly ? "facets" : "catalogue-search";
    return cachedJson(canonicalSearchKey(search, meta.updatedAt, url.origin), route, meta.updatedAt, ttl, ctx, async () => {
      const facets = search.includeFacets || search.facetsOnly
        ? await getCatalogueFacets(env.DB, meta.updatedAt)
        : undefined;
      return { body: await searchCatalogue(env.DB, search, meta.total, url.origin, facets) };
    }, false);
  }
  if (url.pathname === "/home") {
    return cachedJson(cacheKey("home", `${url.origin}:home`, meta.updatedAt), "home", meta.updatedAt, 3600, ctx, async () => {
      const facets = await getCatalogueFacets(env.DB, meta.updatedAt);
      return { body: await getHome(env.DB, meta, url.origin, facets) };
    });
  }
  if (url.pathname === "/manifest") {
    return cachedJson(cacheKey("home", `${url.origin}:manifest`, meta.updatedAt), "manifest", meta.updatedAt, 3600, ctx, async () => ({
      body: {
        apiUrl: url.origin,
        imageProxyUrl: `${url.origin}/images`,
        totalGames: meta.total,
        updatedAt: meta.updatedAt,
      },
    }));
  }
  const gameMatch = url.pathname.match(/^\/games\/(\d+)$/);
  if (gameMatch) {
    return cachedJson(cacheKey("game", `${url.origin}:${gameMatch[1]}`, meta.updatedAt), "game", meta.updatedAt, 86400, ctx, async () => {
      const game = await getGame(env.DB, gameMatch[1], url.origin);
      return game === null
        ? { body: { error: "not found" }, status: 404 }
        : { body: { game } };
    });
  }
  return json({ error: "not found" }, 404, { "cache-control": "private, no-store" });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      if (error instanceof Response) {
        const headers = new Headers(error.headers);
        headers.set("cache-control", "private, no-store");
        headers.set("access-control-allow-origin", "*");
        return new Response(error.body, { status: error.status, headers });
      }
      console.error("catalogue request failed", error);
      return json({ error: "internal error" }, 500, { "cache-control": "private, no-store" });
    }
  },
};
