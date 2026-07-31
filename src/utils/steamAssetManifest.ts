import { ghostboxApi } from "../lib/ghostboxApi";

/**
 * Manifesto de assets da Steam no frontend.
 *
 * Jogos migrados não existem mais no caminho sem hash; a URL real só sai do
 * manifesto que o Rust busca na `GetItems`. Este módulo guarda o resultado em
 * memória e em localStorage, e agrupa os pedidos da viewport num lote só.
 */

type AssetUrls = Record<string, string>;

const STORAGE_KEY = "ghostbox:steam-asset-manifest";
const STORAGE_LIMIT = 4000;
const BATCH_DEBOUNCE_MS = 50;

const manifestByAppId = new Map<string, AssetUrls>();
const pendingAppIds = new Set<string>();
const requestedAppIds = new Set<string>();
/** AppIds cujo lote já voltou, com ou sem manifesto. */
const settledAppIds = new Set<string>();
const listeners = new Set<() => void>();

let flushHandle: number | null = null;
let storageWriteHandle: number | null = null;
let version = 0;

function notifyListeners() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeSteamAssetManifest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSteamAssetManifestVersion() {
  return version;
}

function readStoredManifests() {
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}"
    ) as Record<string, AssetUrls>;

    for (const [appId, urls] of Object.entries(parsed)) {
      if (urls && typeof urls === "object") manifestByAppId.set(appId, urls);
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
  return manifestByAppId.get(appId)?.[fileName] ?? "";
}

export function hasSteamAssetManifest(appId: string) {
  return manifestByAppId.has(appId);
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

  try {
    const manifests = await ghostboxApi.getSteamAssetManifests(appIds);
    let changed = false;
    for (const [appId, urls] of Object.entries(manifests)) {
      if (!urls || !Object.keys(urls).length) continue;
      manifestByAppId.set(appId, urls);
      changed = true;
    }
    // Jogo sem entrada na loja nunca vai ter manifesto. Marcar o lote inteiro
    // como resolvido evita que a cadeia de fallback fique presa esperando.
    for (const appId of appIds) settledAppIds.add(appId);
    if (changed) scheduleStorageWrite();
  } catch {
    // Sem manifesto, as cadeias de adivinhação seguem valendo. Os appIds saem
    // de `requestedAppIds` para que a próxima passagem tente de novo.
    for (const appId of appIds) requestedAppIds.delete(appId);
  }

  // Notifica mesmo sem manifesto novo: quem estava segurando o fallback
  // horizontal por causa do pending precisa reavaliar.
  notifyListeners();
}

/**
 * Enfileira appIds para o próximo lote. Chamadas repetidas dentro da janela de
 * debounce viram um request só — a viewport inteira num `GetItems`.
 */
export function requestSteamAssetManifests(appIds: string[]) {
  let queued = false;

  for (const appId of appIds) {
    if (!/^\d+$/.test(appId)) continue;
    if (manifestByAppId.has(appId) || requestedAppIds.has(appId)) continue;
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
