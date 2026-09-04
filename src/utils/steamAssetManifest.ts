import { ghostboxApi } from "../lib/ghostboxApi";

/**
 * Manifesto de assets da Steam no frontend.
 *
 * Jogos migrados não existem mais no caminho sem hash; a URL real só sai do
 * manifesto que o Rust busca na `GetItems`. Este módulo guarda o resultado em
 * memória e em localStorage, e agrupa os pedidos da viewport num lote só.
 */

type AssetUrls = Record<string, string>;
type ManifestEntry = { urls: AssetUrls; fetchedAt: number };

const STORAGE_KEY = "ghostbox:steam-asset-manifest";
const STORAGE_LIMIT = 4000;
const BATCH_DEBOUNCE_MS = 50;

const MEMORY_LIMIT = 6000;
const MAX_FETCH_ATTEMPTS = 3;
/**
 * O manifesto é o que carrega o hash e o cache-buster da arte. Sem prazo de
 * validade — como era antes — a entrada no localStorage sobrevivia à sessão e o
 * jogo ficava com a capa antiga para sempre, mesmo depois de o Rust já ter
 * buscado a nova. A entrada vencida continua sendo usada na hora (nada de tela
 * vazia) e é revalidada em segundo plano.
 */
const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const manifestByAppId = new Map<string, ManifestEntry>();
const pendingAppIds = new Set<string>();
const requestedAppIds = new Set<string>();
/** AppIds cujo lote já voltou, com ou sem manifesto. */
const settledAppIds = new Set<string>();
/** Tentativas de rede já gastas por appId, para não desistir num erro só. */
const attemptsByAppId = new Map<string, number>();
/** Listener -> appIds que ele observa. Sem set, recebe toda notificação. */
const listeners = new Map<() => void, Set<string> | null>();

let flushHandle: number | null = null;
let storageWriteHandle: number | null = null;
let cacheGeneration = 0;
let version = 0;

/**
 * Notifica só quem observa algum appId do lote. Sem isso, cada flush (a cada
 * 50 ms) reavaliava todo componente montado do app — inclusive as páginas que
 * o router mantém vivas fora da tela.
 */
function notifyListeners(touchedAppIds: Set<string>) {
  if (!touchedAppIds.size) return;
  version += 1;
  for (const [listener, watchedAppIds] of listeners) {
    if (
      watchedAppIds &&
      ![...watchedAppIds].some((appId) => touchedAppIds.has(appId))
    ) {
      continue;
    }
    listener();
  }
}

export function subscribeSteamAssetManifest(
  listener: () => void,
  watchedAppIds?: string[]
) {
  listeners.set(listener, watchedAppIds ? new Set(watchedAppIds) : null);
  return () => {
    listeners.delete(listener);
  };
}

/** Teto de memória: os mapas eram globais de módulo e cresciam sem fim. */
function pruneMemoryCaches() {
  if (manifestByAppId.size > MEMORY_LIMIT) {
    const excess = manifestByAppId.size - MEMORY_LIMIT;
    let removed = 0;
    for (const appId of manifestByAppId.keys()) {
      manifestByAppId.delete(appId);
      requestedAppIds.delete(appId);
      settledAppIds.delete(appId);
      attemptsByAppId.delete(appId);
      if (++removed >= excess) break;
    }
  }
}

function isFresh(entry: ManifestEntry | undefined): entry is ManifestEntry {
  return Boolean(entry && Date.now() - entry.fetchedAt < MANIFEST_MAX_AGE_MS);
}

function readStoredManifests() {
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}"
    ) as Record<string, AssetUrls | ManifestEntry>;

    for (const [appId, stored] of Object.entries(parsed)) {
      if (!stored || typeof stored !== "object") continue;
      // Formato antigo: só o mapa de URLs, sem data. Entra como vencido, para
      // ser revalidado no primeiro uso em vez de virar capa velha permanente.
      const entry = (stored as ManifestEntry).urls
        ? (stored as ManifestEntry)
        : { urls: stored as AssetUrls, fetchedAt: 0 };
      manifestByAppId.set(appId, entry);
    }
  } catch {
    // Manifesto corrompido volta a ser buscado no Rust; nada a recuperar aqui.
  }
}

function writeStoredManifests() {
  if (typeof window === "undefined") return;
  storageWriteHandle = null;

  try {
    const entries = [...manifestByAppId.entries()].slice(-STORAGE_LIMIT);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // O cache em disco do Rust continua valendo sem o localStorage.
  }
}

function scheduleStorageWrite() {
  if (typeof window === "undefined" || storageWriteHandle !== null) return;
  storageWriteHandle = window.setTimeout(writeStoredManifests, 2000);
}

/** URL já resolvida do asset, ou "" quando o manifesto ainda não chegou. */
export function getSteamAssetUrl(appId: string, fileName: string) {
  return manifestByAppId.get(appId)?.urls[fileName] ?? "";
}

/**
 * Força o cheque do appinfo público (PICS) de um jogo e adota a arte de lá.
 *
 * Custa uma chamada de rede por jogo, então é para uso pontual — abrir o jogo,
 * por exemplo — e não para uma grade inteira, que já é revalidada em lote pelo
 * caminho normal.
 */
export async function refreshSteamAssetManifest(appId: string) {
  if (!/^\d+$/.test(appId)) return;

  try {
    const urls = await ghostboxApi.refreshSteamAssetManifest(appId);
    if (!urls || !Object.keys(urls).length) return;

    const current = manifestByAppId.get(appId);
    manifestByAppId.set(appId, {
      urls: { ...current?.urls, ...urls },
      fetchedAt: Date.now(),
    });
    scheduleStorageWrite();
    notifyListeners(new Set([appId]));
  } catch {
    // A capa em cache continua servindo; nada a fazer aqui.
  }
}

/** True enquanto o lote deste appId não voltou — usado para evitar flicker. */
export function isSteamAssetManifestPending(appId: string) {
  return (
    !manifestByAppId.has(appId) &&
    requestedAppIds.has(appId) &&
    !settledAppIds.has(appId)
  );
}

async function flushPendingAppIds() {
  flushHandle = null;
  const appIds = [...pendingAppIds];
  pendingAppIds.clear();
  if (!appIds.length) return;
  const generation = cacheGeneration;

  // Só os appIds tocados por este lote precisam reavaliar. Quem estava
  // segurando o fallback horizontal por causa do pending entra aqui também,
  // mesmo que o manifesto não tenha vindo.
  const touchedAppIds = new Set(appIds);

  try {
    const manifests = await ghostboxApi.getSteamAssetManifests(appIds);
    if (generation !== cacheGeneration) return;
    let changed = false;
    for (const [appId, urls] of Object.entries(manifests)) {
      if (!urls || !Object.keys(urls).length) continue;
      manifestByAppId.set(appId, { urls, fetchedAt: Date.now() });
      // Some da fila de "já pedido" para poder ser revalidado quando vencer.
      // Quem não veio no lote continua marcado, senão um jogo sem entrada na
      // loja seria re-pedido a cada render.
      requestedAppIds.delete(appId);
      changed = true;
    }
    // Jogo sem entrada na loja nunca vai ter manifesto. Marcar o lote inteiro
    // como resolvido evita que a cadeia de fallback fique presa esperando.
    for (const appId of appIds) {
      settledAppIds.add(appId);
      attemptsByAppId.delete(appId);
    }
    if (changed) {
      pruneMemoryCaches();
      scheduleStorageWrite();
    }
  } catch {
    if (generation !== cacheGeneration) return;
    // Falha de rede/IPC não é "jogo sem manifesto". Devolve os appIds à fila
    // até esgotar as tentativas; só então marca como resolvido para não deixar
    // a cadeia de fallback presa em pending para sempre.
    for (const appId of appIds) {
      const attempts = (attemptsByAppId.get(appId) ?? 0) + 1;
      attemptsByAppId.set(appId, attempts);
      if (attempts < MAX_FETCH_ATTEMPTS) {
        requestedAppIds.delete(appId);
      } else {
        settledAppIds.add(appId);
      }
    }
  }

  notifyListeners(touchedAppIds);
}

/** Limpa o índice persistido e qualquer lote de manifesto em andamento. */
export function clearSteamAssetManifestCache() {
  cacheGeneration += 1;
  if (flushHandle !== null && typeof window !== "undefined") {
    window.clearTimeout(flushHandle);
  }
  if (storageWriteHandle !== null && typeof window !== "undefined") {
    window.clearTimeout(storageWriteHandle);
  }
  flushHandle = null;
  storageWriteHandle = null;
  pendingAppIds.clear();
  requestedAppIds.clear();
  settledAppIds.clear();
  attemptsByAppId.clear();
  manifestByAppId.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // A limpeza do cache em disco continua válida mesmo sem localStorage.
    }
  }
  version += 1;
  for (const [listener] of listeners) listener();
}

/**
 * Enfileira appIds para o próximo lote. Chamadas repetidas dentro da janela de
 * debounce viram um request só — a viewport inteira num `GetItems`.
 */
export function requestSteamAssetManifests(appIds: string[]) {
  let queued = false;

  for (const appId of appIds) {
    if (!/^\d+$/.test(appId)) continue;
    // Entrada vencida entra na fila de novo: ela continua sendo servida
    // enquanto o lote não volta, então a revalidação não pisca a capa.
    if (isFresh(manifestByAppId.get(appId)) || requestedAppIds.has(appId)) continue;
    requestedAppIds.add(appId);
    pendingAppIds.add(appId);
    queued = true;
  }

  if (!queued || flushHandle !== null) return;
  if (typeof window === "undefined") {
    void flushPendingAppIds();
    return;
  }
  flushHandle = window.setTimeout(flushPendingAppIds, BATCH_DEBOUNCE_MS);
}

readStoredManifests();
