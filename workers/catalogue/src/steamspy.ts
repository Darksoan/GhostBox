const STEAMSPY_ALL_URL = "https://steamspy.com/api.php?request=all";
const STEAM_PLAYER_COUNT_URL =
  "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/";

/**
 * Páginas de 1000 jogos ordenadas por owners. O ciclo para bem antes do fim da
 * lista da SteamSpy: da página 20 em diante são títulos com owners na casa dos
 * milhares, cujo CCU é 0 na amostra — puxá-los só gastaria requisição.
 */
export const STEAMSPY_MAX_PAGES = 20;

const SNAPSHOT_ACTIVE_KEY = "catalogue:steamspy:active";
const SNAPSHOT_PREVIOUS_KEY = "catalogue:steamspy:previous";
const SNAPSHOT_KEY_PREFIX = "catalogue:steamspy:snapshot:";
const SNAPSHOT_PAGE_KEY_PREFIX = "catalogue:steamspy:page:";
const SNAPSHOT_PAGE_TTL_SECONDS = 3 * 24 * 60 * 60;
const SNAPSHOT_TTL_SECONDS = 8 * 24 * 60 * 60;
const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_RETRY_TTL_MS = 60_000;

interface SteamSpyEntry {
  appid?: number;
  ccu?: number;
  owners?: string;
}

export interface SteamSpySample {
  appId: string;
  ccu: number;
  ownersMax: number;
}

/** Compact representation: the catalogue only needs the two numeric samples. */
export interface SteamSpySnapshot {
  sampledAt: string;
  samples: Record<string, [ccu: number, ownersMax: number]>;
}

function snapshotDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function snapshotPageKey(day: string, page: number): string {
  return `${SNAPSHOT_PAGE_KEY_PREFIX}${day}:${page}`;
}

function snapshotKey(day: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${day}`;
}

function decodeSnapshot(value: unknown): SteamSpySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sampledAt !== "string" || !Number.isFinite(Date.parse(record.sampledAt)) ||
    !record.samples || typeof record.samples !== "object" || Array.isArray(record.samples)) return null;
  const samples: Record<string, [number, number]> = {};
  for (const [appId, sample] of Object.entries(record.samples as Record<string, unknown>)) {
    if (!/^\d{1,10}$/.test(appId) || !Array.isArray(sample) || sample.length !== 2 ||
      !sample.every((entry) => Number.isSafeInteger(entry) && entry >= 0)) return null;
    samples[appId] = [sample[0], sample[1]];
  }
  return Object.keys(samples).length > 0 ? { sampledAt: record.sampledAt, samples } : null;
}

export function steamSpySnapshotSample(snapshot: SteamSpySnapshot | null | undefined, appId: string): SteamSpySample | null {
  const value = snapshot?.samples[appId];
  return value ? { appId, ccu: value[0], ownersMax: value[1] } : null;
}

interface SnapshotCache {
  expiresAt: number;
  lastGood: SteamSpySnapshot | null;
  promise?: Promise<SteamSpySnapshot | null>;
}
let snapshotCaches = new WeakMap<KVNamespace, SnapshotCache>();

function validSamplePage(value: unknown): value is SteamSpySample[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 1000 && value.every((sample) =>
    sample && /^\d{1,10}$/.test(sample.appId) &&
    Number.isSafeInteger(sample.ccu) && sample.ccu >= 0 &&
    Number.isSafeInteger(sample.ownersMax) && sample.ownersMax >= 0,
  );
}

/**
 * "10,000,000 .. 20,000,000" -> 20000000. A SteamSpy só publica a faixa; o
 * limite superior é o que as outras superfícies já chamam de `ownersEstimate`.
 */
export function parseOwnersMax(owners: string | undefined): number {
  if (!owners) return 0;
  const bounds = owners.split("..").map((part) => Number.parseInt(part.replace(/[^\d]/g, ""), 10));
  const max = bounds.filter((value) => Number.isFinite(value)).pop();
  return max && max > 0 ? max : 0;
}

/** Descarta entradas sem appid utilizável e sem nenhuma das duas amostras. */
export function toSteamSpySamples(payload: unknown): SteamSpySample[] {
  if (!payload || typeof payload !== "object") return [];
  const samples: SteamSpySample[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, SteamSpyEntry>)) {
    const appId = String(value?.appid ?? key).trim();
    if (!/^\d+$/.test(appId)) continue;
    const ccu = Number.isFinite(value?.ccu) ? Math.max(0, Math.trunc(value?.ccu ?? 0)) : 0;
    const ownersMax = parseOwnersMax(value?.owners);
    if (ccu === 0 && ownersMax === 0) continue;
    samples.push({ appId, ccu, ownersMax });
  }
  return samples;
}

async function fetchSteamSpyPage(page: number): Promise<SteamSpySample[]> {
  const response = await fetch(`${STEAMSPY_ALL_URL}&page=${page}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`steamspy page ${page} failed: ${response.status}`);
  return toSteamSpySamples(await response.json());
}

async function publishSteamSpySnapshot(kv: KVNamespace, day: string, sampledAt: number): Promise<SteamSpySnapshot> {
  // Minutes 42 and 44 are retry windows for delayed/eventually-consistent page
  // writes. Once today's snapshot is active, retries are read-only.
  const activeDay = await kv.get(SNAPSHOT_ACTIVE_KEY);
  if (activeDay === day) {
    const active = decodeSnapshot(await kv.get(snapshotKey(day), "json"));
    if (active) return active;
  }
  const pageValues = await Promise.all(
    Array.from({ length: STEAMSPY_MAX_PAGES }, (_, page) => kv.get(snapshotPageKey(day, page), "json")),
  );
  if (!pageValues.every(validSamplePage)) {
    throw new Error(`steamspy snapshot ${day} is incomplete`);
  }
  const samples = Object.fromEntries(
    pageValues.flat().map(({ appId, ccu, ownersMax }) => [appId, [ccu, ownersMax]]),
  ) as SteamSpySnapshot["samples"];
  if (Object.keys(samples).length === 0) throw new Error(`steamspy snapshot ${day} has no samples`);
  const snapshot: SteamSpySnapshot = { sampledAt: new Date(sampledAt).toISOString(), samples };
  await kv.put(snapshotKey(day), JSON.stringify(snapshot), { expirationTtl: SNAPSHOT_TTL_SECONDS });
  if (activeDay && activeDay !== day) {
    await kv.put(SNAPSHOT_PREVIOUS_KEY, activeDay, { expirationTtl: SNAPSHOT_TTL_SECONDS });
  }
  await kv.put(SNAPSHOT_ACTIVE_KEY, day, { expirationTtl: SNAPSHOT_TTL_SECONDS });
  return snapshot;
}

/**
 * Stores one page per scheduled invocation and publishes one immutable daily
 * snapshot. No game-level D1 UPDATE is performed.
 */
export async function refreshSteamSpySnapshot(
  kv: KVNamespace,
  now = Date.now(),
  page = Math.floor(new Date(now).getUTCMinutes() / 2),
): Promise<{ page: number; samples: number; published: boolean }> {
  const day = snapshotDay(now);
  if (!Number.isInteger(page) || page < 0 || page > STEAMSPY_MAX_PAGES + 2) {
    throw new Error("invalid SteamSpy snapshot page");
  }
  if (page >= STEAMSPY_MAX_PAGES) {
    // One missing/invalid page can be recovered per retry without violating the
    // upstream one-request-per-minute limit.
    const pages = await Promise.all(Array.from({ length: STEAMSPY_MAX_PAGES }, (_, index) =>
      kv.get(snapshotPageKey(day, index), "json"),
    ));
    const missingPage = pages.findIndex((value) => !validSamplePage(value));
    if (missingPage !== -1) {
      const recovered = await fetchSteamSpyPage(missingPage);
      if (!validSamplePage(recovered)) throw new Error(`steamspy page ${missingPage} has no valid samples`);
      await kv.put(snapshotPageKey(day, missingPage), JSON.stringify(recovered), { expirationTtl: SNAPSHOT_PAGE_TTL_SECONDS });
    }
    const snapshot = await publishSteamSpySnapshot(kv, day, now);
    return { page, samples: Object.keys(snapshot.samples).length, published: true };
  }
  const existing = await kv.get(snapshotPageKey(day, page), "json");
  if (validSamplePage(existing)) return { page, samples: existing.length, published: false };
  const samples = await fetchSteamSpyPage(page);
  if (!validSamplePage(samples)) throw new Error(`steamspy page ${page} has no valid samples`);
  await kv.put(snapshotPageKey(day, page), JSON.stringify(samples), { expirationTtl: SNAPSHOT_PAGE_TTL_SECONDS });
  return { page, samples: samples.length, published: false };
}

export async function getSteamSpySnapshot(kv: KVNamespace | undefined): Promise<SteamSpySnapshot | null> {
  if (!kv) return null;
  const now = Date.now();
  let cache = snapshotCaches.get(kv);
  if (!cache) {
    cache = { expiresAt: 0, lastGood: null };
    snapshotCaches.set(kv, cache);
  }
  if (cache.promise) return cache.promise;
  if (cache.expiresAt > now) return cache.lastGood;
  const state = cache;
  state.promise = (async () => {
    try {
      const activeDay = await kv.get(SNAPSHOT_ACTIVE_KEY);
      let snapshot = activeDay ? decodeSnapshot(await kv.get(snapshotKey(activeDay), "json")) : null;
      if (!snapshot) {
        const previousDay = await kv.get(SNAPSHOT_PREVIOUS_KEY);
        snapshot = previousDay ? decodeSnapshot(await kv.get(snapshotKey(previousDay), "json")) : null;
      }
      if (snapshot) state.lastGood = snapshot;
      state.expiresAt = now + (snapshot ? SNAPSHOT_CACHE_TTL_MS : SNAPSHOT_RETRY_TTL_MS);
    } catch (error) {
      state.expiresAt = now + SNAPSHOT_RETRY_TTL_MS;
      console.warn("steamspy snapshot unavailable; keeping fallback", error);
    }
    return state.lastGood;
  })().finally(() => { state.promise = undefined; });
  return state.promise;
}

export function invalidateSteamSpySnapshotCache() {
  snapshotCaches = new WeakMap();
}

/**
 * Contagem de jogadores ao vivo da própria Steam, endpoint público e sem chave.
 *
 * Existe junto com a amostra da SteamSpy porque as duas medem coisas
 * diferentes: a SteamSpy publica uma amostra diária (Resident Evil 4 apareceu
 * com 3.748 quando a Steam reportava 12.039 no mesmo instante), boa para
 * ordenar o catálogo, ruim para mostrar num card como "jogando agora".
 *
 * Devolve `null` em qualquer falha — quem chama cai na coluna do D1 em vez de
 * derrubar a resposta inteira por causa de um número.
 */
export async function fetchLivePlayerCount(appId: string): Promise<number | null> {
  if (!/^\d+$/.test(appId)) return null;
  const controller = new AbortController();
  // /games/:id awaits this optional live metric; do not stall the entire
  // details response when Steam is slow (the D1 snapshot is already available).
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`${STEAM_PLAYER_COUNT_URL}?appid=${appId}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      response?: { player_count?: number; result?: number };
    };
    // `result` 1 é o único sucesso; app inexistente responde 200 com result 42.
    if (payload.response?.result !== 1) return null;
    const count = payload.response?.player_count;
    return typeof count === "number" && Number.isFinite(count) && count >= 0
      ? Math.trunc(count)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
