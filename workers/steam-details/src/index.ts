import {
  normalizeAppType,
  normalizeStoreDetails,
  parseLanguage,
  steamAppData,
  validAppId,
} from "./pure";

type Env = Record<string, never>;

// v5: respostas passam a incluir `drmNotice` (Steam `data.drm_notice`),
// exibido como selo de DRM no banner do modal. Bump invalida o edge cache
// antigo, que não tinha o campo. (v4 trouxe `appType` para excluir demos.)
const CACHE_VERSION = "v6"; // Invalidate false 404s from alternate appdetails keys.
const TYPES_BATCH_MAX_IDS = 50;
const POSITIVE_CACHE_CONTROL =
  "public, max-age=28800, stale-while-revalidate=86400, stale-if-error=604800";
const NEGATIVE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "x-ghostbox-cache",
} as const;

function jsonResponse(
  value: unknown,
  status: number,
  cacheControl: string,
  cacheStatus: "HIT" | "MISS"
): Response {
  return Response.json(value, {
    status,
    headers: {
      ...CORS_HEADERS,
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "x-ghostbox-cache": cacheStatus,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status, "no-store", "MISS");
}

function cacheRequest(appId: string, language: string): Request {
  return new Request(
    `https://ghostbox-steam-details.cache/${CACHE_VERSION}/games/${appId}/details?lang=${language}`
  );
}

function withCacheStatus(response: Response, status: "HIT" | "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.set("x-ghostbox-cache", status);
  return new Response(response.body, { status: response.status, headers });
}

async function fetchSteamDetails(appId: string, language: string): Promise<Response> {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", appId);
  url.searchParams.set("l", language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    return await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "GhostBox Steam Details/1.0",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleDetails(
  request: Request,
  appId: string,
  ctx: ExecutionContext
): Promise<Response> {
  if (!validAppId(appId)) return errorResponse("Invalid Steam app ID", 400);

  const language = parseLanguage(new URL(request.url).searchParams.get("lang"));
  if (!language) return errorResponse("Invalid language", 400);

  const key = cacheRequest(appId, language);
  const cached = await caches.default.match(key).catch(() => undefined);
  if (cached) return withCacheStatus(cached, "HIT");

  let upstream: Response;
  try {
    upstream = await fetchSteamDetails(appId, language);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error(JSON.stringify({
      message: timedOut ? "Steam appdetails timed out" : "Steam appdetails request failed",
      appId,
      language,
    }));
    return errorResponse(
      timedOut ? "Steam request timed out" : "Failed to fetch Steam details",
      timedOut ? 504 : 502
    );
  }

  if (upstream.status === 404) {
    const response = jsonResponse({ error: "Steam app not found", appId }, 404, NEGATIVE_CACHE_CONTROL, "MISS");
    ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => undefined));
    return response;
  }
  if (!upstream.ok) {
    console.warn(JSON.stringify({
      message: "Steam appdetails returned an error",
      appId,
      language,
      status: upstream.status,
    }));
    return errorResponse("Steam details are unavailable", 502);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return errorResponse("Steam returned invalid JSON", 502);
  }

  const data = steamAppData(payload, appId);
  if (!data) {
    const response = jsonResponse({ error: "Steam app not found", appId }, 404, NEGATIVE_CACHE_CONTROL, "MISS");
    ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => undefined));
    return response;
  }

  const details = normalizeStoreDetails(appId, data);
  if (!details) return errorResponse("Steam returned invalid app data", 502);

  const response = jsonResponse(details, 200, POSITIVE_CACHE_CONTROL, "MISS");
  ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => undefined));
  return response;
}

function parseTypesAppIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((id, index, all) => validAppId(id) && all.indexOf(id) === index)
    .slice(0, TYPES_BATCH_MAX_IDS);
  return ids.length ? ids : null;
}

async function handleTypes(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const appIds = parseTypesAppIds(url.searchParams.get("appids"));
  if (!appIds) return errorResponse("Invalid or empty appids (1-50 numeric ids)", 400);

  const language = parseLanguage(url.searchParams.get("lang")) ?? "english";
  const results: Array<{ appId: string; appType?: string }> = [];
  // Sem KV próprio aqui: reutiliza o edge cache de detalhes por app e extrai
  // só o tipo. Resposta batch também é cacheada (positiva 24h, negativa curta)
  // para o próximo lote não refazer o upstream.
  const batchKey = new Request(
    `https://ghostbox-steam-details.cache/${CACHE_VERSION}/games/types?lang=${language}&appids=${[...appIds].sort().join(",")}`,
  );
  const cachedBatch = await caches.default.match(batchKey).catch(() => undefined);
  if (cachedBatch) {
    try {
      const body = (await cachedBatch.json()) as {
        types?: Array<{ appId: string; appType?: unknown }>;
      };
      const byId = new Map(
        (body.types ?? []).map((entry) => [entry.appId, normalizeAppType(entry.appType)]),
      );
      if (appIds.every((appId) => byId.has(appId))) {
        return withCacheStatus(cachedBatch, "HIT");
      }
    } catch {
      // Cache corrompido: trata como miss e resolve de novo.
    }
  }
  const uncached: string[] = [];
  for (const appId of appIds) {
    const key = cacheRequest(appId, language);
    const cached = await caches.default.match(key).catch(() => undefined);
    if (cached) {
      try {
        const body = (await cached.json()) as { appType?: unknown };
        const appType = normalizeAppType(body?.appType);
        results.push(appType ? { appId, appType } : { appId });
        continue;
      } catch {
        // Cache corrompido: trata como miss e busca no upstream.
      }
    }
    uncached.push(appId);
  }

  if (uncached.length) {
    const batchUrl = new URL("https://store.steampowered.com/api/appdetails");
    batchUrl.searchParams.set("appids", uncached.join(","));
    batchUrl.searchParams.set("l", language);
    try {
      const upstream = await fetch(batchUrl, {
        headers: {
          accept: "application/json",
          "user-agent": "GhostBox Steam Details/1.0",
        },
        signal: AbortSignal.timeout(6_000),
      });
      if (upstream.ok) {
        const payload = (await upstream.json()) as Record<
          string,
          { success?: boolean; data?: { type?: unknown } }
        >;
        for (const appId of uncached) {
          const entry = payload[appId];
          const appType =
            entry?.success && entry.data
              ? normalizeAppType(entry.data.type)
              : "";
          results.push(appType ? { appId, appType } : { appId });
        }
      } else {
        for (const appId of uncached) results.push({ appId });
      }
    } catch {
      for (const appId of uncached) results.push({ appId });
    }
  }

  const byId = new Map(results.map((entry) => [entry.appId, entry]));
  const ordered = appIds.map((appId) => byId.get(appId) ?? { appId });
  const resolvedCount = ordered.filter((entry) => entry.appType).length;
  const response = jsonResponse(
    { types: ordered },
    200,
    resolvedCount === ordered.length
      ? "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=604800"
      : "public, max-age=300, stale-while-revalidate=60",
    "MISS",
  );
  // Grava o próprio batch (não só lê o cache de detalhes): sem isso cada lote
  // idêntico refazia o upstream. Negativo curto para ids sem tipo.
  ctx.waitUntil(caches.default.put(batchKey, response.clone()).catch(() => undefined));
  return response;
}

export default {
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "access-control-max-age": "86400",
          "cache-control": "no-store",
          "x-ghostbox-cache": "MISS",
        },
      });
    }

    const path = new URL(request.url).pathname;
    if (path === "/v2/games/types") {
      if (request.method !== "GET") {
        const response = errorResponse("Method not allowed", 405);
        response.headers.set("allow", "GET, OPTIONS");
        return response;
      }
      return handleTypes(request, ctx);
    }
    const match = /^\/(?:v2\/)?games\/([^/]+)\/details\/?$/.exec(path);
    if (!match) return errorResponse("Not found", 404);
    if (request.method !== "GET") {
      const response = errorResponse("Method not allowed", 405);
      response.headers.set("allow", "GET, OPTIONS");
      return response;
    }

    return handleDetails(request, match[1], ctx);
  },
} satisfies ExportedHandler<Env>;
