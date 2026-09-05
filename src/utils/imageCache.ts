import {
  loadCachedImages,
  loadStoredImages,
  resolveSteamLibraryAssetsBatch,
} from "../data";
import {
  imageSourceCacheKey,
  imageSourceCacheLimit,
} from "../constants/catalogue";
import {
  getSteamAssetUrl,
  isSteamAssetManifestPending,
  requestSteamAssetManifests,
} from "./steamAssetManifest";

export const imageSourceCache = new Map<string, string>();
const imageIdentitySourceCache = new Map<string, string>();
const imageResolvePromises = new Map<string, Promise<string>>();
const screenshotPreloadCache = new Set<string>();
const steamLibraryCoverSourceCache = new Map<string, string>();
const steamLibraryCoverResolvePromises = new Map<string, Promise<string>>();
const steamHeaderSourceCache = new Map<string, string>();
const steamHeaderResolvePromises = new Map<string, Promise<string>>();

// Vários GameCards resolvem capa/header no mesmo instante (primeiro paint da
// grid); sem isso cada um disparava seu próprio invoke IPC. Enfileira os
// pedidos feitos no mesmo tick e resolve todos em uma única chamada batched.
type SteamAssetBatchRequest = {
  appId: string;
  fileName: string;
  resolve: (source: string) => void;
};
let steamAssetBatchQueue: SteamAssetBatchRequest[] = [];
let steamAssetBatchScheduled = false;

type ImageBatchRequest = {
  source: string;
  resolve: (source: string) => void;
};
let imageBatchQueue: ImageBatchRequest[] = [];
let imageBatchScheduled = false;
let imageCacheGeneration = 0;

function storeCachedImageSource(source: string, cachedSource: string) {
  imageSourceCache.set(source, cachedSource);
  imageIdentitySourceCache.set(imageSourceIdentity(source), cachedSource);
}

function rebuildImageIdentitySourceCache() {
  imageIdentitySourceCache.clear();
  for (const [source, cachedSource] of imageSourceCache) {
    imageIdentitySourceCache.set(imageSourceIdentity(source), cachedSource);
  }
}

function flushImageBatchQueue() {
  const queue = imageBatchQueue;
  imageBatchQueue = [];
  imageBatchScheduled = false;
  if (!queue.length) return;
  const generation = imageCacheGeneration;

  const requestsBySource = new Map<string, ImageBatchRequest[]>();
  for (const request of queue) {
    const requests = requestsBySource.get(request.source) ?? [];
    requests.push(request);
    requestsBySource.set(request.source, requests);
  }
  const sources = [...requestsBySource.keys()];
  const resolveResults = (
    results: Record<string, string>,
    resolvedSources: string[],
  ) => {
      if (generation !== imageCacheGeneration) {
        queue.forEach((request) => request.resolve(request.source));
        return false;
      }
      let changed = false;
      for (const source of resolvedSources) {
        const nextSource = results[source] || source;
        if (nextSource !== source) {
          storeCachedImageSource(source, nextSource);
          changed = true;
        }
        requestsBySource
          .get(source)
          ?.forEach((request) => request.resolve(nextSource));
      }
      if (changed) scheduleStoredImageSourceCacheWrite();
      return true;
  };

  loadStoredImages(sources)
    .then((storedResults) => {
      const hits = sources.filter((source) => Boolean(storedResults[source]));
      if (!resolveResults(storedResults, hits)) return;
      const misses = sources.filter((source) => !storedResults[source]);
      if (!misses.length) return;
      return loadCachedImages(misses).then((results) => {
        resolveResults(results, misses);
      });
    })
    .catch(() => {
      queue.forEach((request) => request.resolve(request.source));
    });
}

function resolveCachedImageBatched(source: string) {
  return new Promise<string>((resolve) => {
    imageBatchQueue.push({ source, resolve });
    if (!imageBatchScheduled) {
      imageBatchScheduled = true;
      queueMicrotask(flushImageBatchQueue);
    }
  });
}

function flushSteamAssetBatchQueue() {
  const queue = steamAssetBatchQueue;
  steamAssetBatchQueue = [];
  steamAssetBatchScheduled = false;
  if (!queue.length) return;

  resolveSteamLibraryAssetsBatch(
    queue.map(({ appId, fileName }) => ({ appId, fileName }))
  )
    .then((results) => {
      for (const request of queue) {
        request.resolve(
          results[`${request.appId}|${request.fileName}`] ?? ""
        );
      }
    })
    .catch(() => {
      for (const request of queue) request.resolve("");
    });
}

function resolveSteamLibraryAssetBatched(appId: string, fileName: string) {
  return new Promise<string>((resolve) => {
    steamAssetBatchQueue.push({ appId, fileName, resolve });
    if (!steamAssetBatchScheduled) {
      steamAssetBatchScheduled = true;
      queueMicrotask(flushSteamAssetBatchQueue);
    }
  });
}
// Sources that have actually finished loading at least once. Unlike
// screenshotPreloadCache (which is set optimistically when a load starts and
// removed on failure), this only holds sources we know decoded successfully,
// so consumers can paint them synchronously without a flicker.
export const loadedImageSources = new Set<string>();
const loadedImageSourcesLimit = 4096;

export function markImageSourceLoaded(source: string) {
  if (!source) return;
  loadedImageSources.delete(source);
  loadedImageSources.add(source);
  while (loadedImageSources.size > loadedImageSourcesLimit) {
    const oldest = loadedImageSources.values().next().value as string | undefined;
    if (!oldest) break;
    loadedImageSources.delete(oldest);
  }
}

type ImagePreloadOptions = {
  decode?: boolean;
  forceRetry?: boolean;
  immediate?: boolean;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const imagePreloadPromises = new Map<string, Promise<void>>();
const imagePreloadFailures = new Map<string, number>();
const imagePreloadQueue: Array<() => void> = [];
let maxConcurrentImagePreloads = 4;
const imagePreloadRetryDelayMs = 10_000;
let activeImagePreloads = 0;

export function setImagePreloadConcurrency(value: 2 | 4 | 6) {
  maxConcurrentImagePreloads = value;
  runNextImagePreload();
}

function runNextImagePreload() {
  while (
    activeImagePreloads < maxConcurrentImagePreloads &&
    imagePreloadQueue.length > 0
  ) {
    const run = imagePreloadQueue.shift();
    if (!run) return;

    activeImagePreloads += 1;
    run();
  }
}

function enqueueImagePreload(task: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    imagePreloadQueue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          activeImagePreloads = Math.max(0, activeImagePreloads - 1);
          runNextImagePreload();
        });
    });

    runNextImagePreload();
  });
}

export function runWhenIdle(callback: () => void, timeout = 1200) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  const idleWindow = window as IdleWindow;

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

function readStoredImageSourceCache() {
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(imageSourceCacheKey) ?? "{}"
    ) as Record<string, string>;

    Object.entries(parsed).forEach(([source, cachedSource]) => {
      if (typeof source === "string" && typeof cachedSource === "string") {
        storeCachedImageSource(source, cachedSource);
      }
    });
  } catch {
    imageSourceCache.clear();
    imageIdentitySourceCache.clear();
  }
}

function writeStoredImageSourceCache() {
  if (typeof window === "undefined") return;

  try {
    const entries = [...imageSourceCache.entries()].slice(
      -imageSourceCacheLimit
    );
    imageSourceCache.clear();
    imageIdentitySourceCache.clear();
    entries.forEach(([source, cachedSource]) =>
      storeCachedImageSource(source, cachedSource)
    );
    window.localStorage.setItem(
      imageSourceCacheKey,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // File cache still works through IPC when localStorage is unavailable or full.
  }
}

let cancelPendingCacheWrite: (() => void) | null = null;

// Coalesce localStorage writes: serializing the whole cache on every resolved
// image caused main-thread jank while scrolling the catalogue. Write at most
// once per idle window instead.
function scheduleStoredImageSourceCacheWrite() {
  if (typeof window === "undefined") {
    writeStoredImageSourceCache();
    return;
  }

  if (cancelPendingCacheWrite) return;

  cancelPendingCacheWrite = runWhenIdle(() => {
    cancelPendingCacheWrite = null;
    writeStoredImageSourceCache();
  }, 2000);
}

export function uniqueSources(sources: unknown[]) {
  return [
    ...new Set(
      sources.filter(
        (source): source is string =>
          typeof source === "string" && source.length > 0
      )
    ),
  ];
}

export function cssImageUrl(source: string) {
  try {
    return `url(${JSON.stringify(source)})`;
  } catch {
    return "";
  }
}

const steamLibraryAssetFallbackNames = new Set([
  "library_600x900_2x.jpg",
  "library_600x900.jpg",
  "library_capsule_2x.jpg",
  "library_capsule.jpg",
  "hero_capsule.jpg",
]);

const steamPortraitLibraryAssetNames = new Set([
  "library_600x900_2x.jpg",
  "library_600x900.jpg",
  "library_capsule_2x.jpg",
  "library_capsule.jpg",
]);

const steamHeaderAssetNames = new Set([
  "header.jpg",
  "capsule_616x353.jpg",
  "capsule_467x181.jpg",
  "capsule_231x87.jpg",
]);

function normalizeSteamLibraryAssetName(fileName: string) {
  if (fileName === "library_600x900_2x.jpg") return "library_600x900.jpg";
  if (fileName === "library_capsule.jpg") return "library_600x900.jpg";
  if (fileName === "library_capsule_2x.jpg") return "library_600x900.jpg";
  return fileName;
}

function isSteamPortraitLibraryAssetSource(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return false;
  return steamPortraitLibraryAssetNames.has(parsed.asset.toLowerCase());
}

function isSteamHeaderAssetSource(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return false;
  return steamHeaderAssetNames.has(parsed.asset.toLowerCase());
}

/** True when the caller is loading portrait covers, not landscape headers/heroes. */
function sourceListRequestsPortraitLibraryCover(sources: string[]) {
  return sources.some((source) => isSteamPortraitLibraryAssetSource(source));
}

function sourceListRequestsSteamHeader(sources: string[]) {
  return sources.some((source) => isSteamHeaderAssetSource(source));
}

function parseSteamAssetSource(source: string) {
  try {
    const url = new URL(source);
    const proxyMatch = /\/images\/steam\/apps\/(\d+)\/([^/]+)$/i.exec(
      url.pathname
    );
    if (proxyMatch) {
      const appId = proxyMatch[1];
      const asset = decodeURIComponent(proxyMatch[2]);
      if (!/^[a-z0-9_]+\.(?:jpg|jpeg|png|webp)$/i.test(asset)) return null;

      return { appId, asset };
    }

    if (
      !/steamstatic\.com$/i.test(url.hostname) &&
      url.hostname.toLowerCase() !== "steamcdn-a.akamaihd.net"
    )
      return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const appsIndex = parts.findIndex(
      (part, index) => part === "apps" && parts[index - 1] === "steam"
    );
    if (appsIndex === -1) return null;

    const appId = parts[appsIndex + 1] ?? "";
    const firstAssetPart = decodeURIComponent(parts[appsIndex + 2] ?? "");
    const secondAssetPart = decodeURIComponent(parts[appsIndex + 3] ?? "");
    const dottedAssetMatch =
      /^[a-f0-9]{20,}\.([a-z0-9_]+\.(?:jpg|jpeg|png|webp))$/i.exec(
        firstAssetPart
      );
    const asset = dottedAssetMatch
      ? dottedAssetMatch[1]
      : /^[a-f0-9]{20,}$/i.test(firstAssetPart)
        ? secondAssetPart
        : firstAssetPart;

    if (!/^\d+$/.test(appId)) return null;
    if (!/^[a-z0-9_]+\.(?:jpg|jpeg|png|webp)$/i.test(asset)) return null;

    return { appId, asset };
  } catch {
    return null;
  }
}

function imageSourceIdentity(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return source;
  const asset = normalizeSteamLibraryAssetName(parsed.asset.toLowerCase());
  return `steam:${parsed.appId}:${asset}`;
}

function cachedImageSourceFor(source: string) {
  const direct = imageSourceCache.get(source);
  if (direct) return direct;
  return imageIdentitySourceCache.get(imageSourceIdentity(source)) ?? "";
}

export function getCachedImageSource(source: string) {
  return cachedImageSourceFor(source);
}

export function steamAppIdFromImageSource(source: string) {
  return parseSteamAssetSource(source)?.appId ?? "";
}

function resolvedSteamLibraryCoverSourceForSources(sources: string[]) {
  for (const source of sources) {
    const appId = steamAppIdFromImageSource(source);
    if (!appId) continue;

    const resolvedSource = steamLibraryCoverSourceCache.get(appId);
    if (resolvedSource) return resolvedSource;
  }

  return "";
}

function resolvedSteamHeaderSourceForSources(sources: string[]) {
  for (const source of sources) {
    const appId = steamAppIdFromImageSource(source);
    if (!appId) continue;

    const resolvedSource = steamHeaderSourceCache.get(appId);
    if (resolvedSource) return resolvedSource;
  }

  return "";
}

export function resolveSteamLibraryCoverSource(appId: string) {
  if (!/^\d+$/.test(appId)) return Promise.resolve("");

  const cachedSource = steamLibraryCoverSourceCache.get(appId);
  if (cachedSource) return Promise.resolve(cachedSource);

  const pending = steamLibraryCoverResolvePromises.get(appId);
  if (pending) return pending;

  const promise = resolveSteamLibraryAssetBatched(appId, "library_capsule.jpg")
    .then((source) => {
      if (/^https?:\/\//i.test(source)) {
        steamLibraryCoverSourceCache.set(appId, source);
        return source;
      }
      return "";
    })
    .catch(() => "")
    .finally(() => {
      steamLibraryCoverResolvePromises.delete(appId);
    });

  steamLibraryCoverResolvePromises.set(appId, promise);
  return promise;
}

export function resolveSteamHeaderSource(appId: string) {
  if (!/^\d+$/.test(appId)) return Promise.resolve("");

  const cachedSource = steamHeaderSourceCache.get(appId);
  if (cachedSource) return Promise.resolve(cachedSource);

  const pending = steamHeaderResolvePromises.get(appId);
  if (pending) return pending;

  const promise = resolveSteamLibraryAssetBatched(appId, "header.jpg")
    .then((source) => {
      if (/^https?:\/\//i.test(source)) {
        steamHeaderSourceCache.set(appId, source);
        return source;
      }
      return "";
    })
    .catch(() => "")
    .finally(() => {
      steamHeaderResolvePromises.delete(appId);
    });

  steamHeaderResolvePromises.set(appId, promise);
  return promise;
}

function steamCdnFallbackForSource(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return "";

  const asset = normalizeSteamLibraryAssetName(parsed.asset);
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${parsed.appId}/${asset}`;
}

function isHigherDensityFallbackForStandardSteamAsset(
  source: string,
  cachedSource: string
) {
  const sourceAsset = parseSteamAssetSource(source)?.asset.toLowerCase();
  const cachedAsset = parseSteamAssetSource(cachedSource)?.asset.toLowerCase();
  if (!sourceAsset || !cachedAsset) return false;

  return cachedAsset === sourceAsset.replace(/\.(jpg|jpeg|png|webp)$/i, "_2x.$1");
}

export function isPredictableSteamAssetSource(source: string) {
  return parseSteamAssetSource(source) !== null;
}

export function isStandardSteamHeaderSource(source: string) {
  return parseSteamAssetSource(source)?.asset.toLowerCase() === "header.jpg";
}

function canResolveSteamLibraryAssetFallback(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return false;

  return steamLibraryAssetFallbackNames.has(parsed.asset.toLowerCase());
}

const steamLandscapeAssetNames = new Set([
  "header.jpg",
  "header_2x.jpg",
  "capsule_616x353.jpg",
  "capsule_231x87.jpg",
  "capsule_467x181.jpg",
  "hero_capsule.jpg",
  "hero_capsule_2x.jpg",
  "library_hero.jpg",
  "library_hero_2x.jpg",
]);

/**
 * Substitutos horizontais que aparecem no fim de uma cadeia de capa vertical:
 * capsules, heroes e o screenshot que o backend inclui em `coverFallbacks`.
 */
function isLandscapeCoverSource(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (parsed) return steamLandscapeAssetNames.has(parsed.asset.toLowerCase());
  return /(^|\/)ss_[^/]+\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i.test(source);
}

// Nomes antigos dos mesmos arquivos. O manifesto é indexado pelos nomes atuais.
const steamAssetManifestAliases: Record<string, string> = {
  "library_capsule.jpg": "library_600x900.jpg",
  "library_capsule_2x.jpg": "library_600x900_2x.jpg",
};

/** URL com hash equivalente a este source, quando o manifesto já resolveu. */
function steamAssetManifestSourceFor(source: string) {
  const parsed = parseSteamAssetSource(source);
  if (!parsed) return "";

  const asset = parsed.asset.toLowerCase();
  const fileName = steamAssetManifestAliases[asset] ?? asset;
  const manifestSource = getSteamAssetUrl(parsed.appId, fileName);

  return manifestSource === source ? "" : manifestSource;
}

export function steamAppIdsFromSources(sources: string[]) {
  return [
    ...new Set(
      sources.map((source) => steamAppIdFromImageSource(source)).filter(Boolean)
    ),
  ];
}

export function withCachedImageSources(
  sources: string[],
  {
    requestManifests = true,
    preserveSourceOrder = false,
    prioritizeCached = false,
  }: {
    requestManifests?: boolean;
    preserveSourceOrder?: boolean;
    prioritizeCached?: boolean;
  } = {}
) {
  // Only inject the resolved library capsule for portrait requests. Prepending
  // it for header/landscape lists (home calendar, catalogue rows, etc.) causes
  // the correct header to flash and then swap to a vertical cover.
  const resolvedCoverSource = sourceListRequestsPortraitLibraryCover(sources)
    ? resolvedSteamLibraryCoverSourceForSources(sources)
    : "";
  const resolvedHeaderSource = sourceListRequestsSteamHeader(sources)
    ? resolvedSteamHeaderSourceForSources(sources)
    : "";

  const appIds = steamAppIdsFromSources(sources);
  if (requestManifests) requestSteamAssetManifests(appIds);

  // Enquanto o manifesto do jogo não chegou, uma capa horizontal no fim da
  // cadeia pintaria antes da vertical correta e depois trocaria na tela. Melhor
  // segurar o placeholder por alguns frames.
  const holdsLandscapeFallback =
    sourceListRequestsPortraitLibraryCover(sources) &&
    !resolvedCoverSource &&
    appIds.some((appId) => isSteamAssetManifestPending(appId));
  const orderedSources = holdsLandscapeFallback
    ? sources.filter((source) => !isLandscapeCoverSource(source))
    : sources;
  const prioritizedCachedSources = prioritizeCached
    ? uniqueSources(
        orderedSources
          .map((source) => cachedImageSourceFor(source))
          .filter(Boolean)
      )
    : [];

  return uniqueSources(
    [
      ...(resolvedCoverSource ? [resolvedCoverSource] : []),
      ...prioritizedCachedSources,
      ...(!preserveSourceOrder && resolvedHeaderSource ? [resolvedHeaderSource] : []),
      ...orderedSources.flatMap((source) => {
        const manifestSource = steamAssetManifestSourceFor(source);
        const cachedSource = cachedImageSourceFor(source);
        const cdnFallback = steamCdnFallbackForSource(source);
        const shouldPrependCachedSource =
          cachedSource &&
          cachedSource !== source &&
          !isHigherDensityFallbackForStandardSteamAsset(source, cachedSource);
        if (preserveSourceOrder) {
          return uniqueSources([
            ...(shouldPrependCachedSource ? [cachedSource] : []),
            source,
            ...(manifestSource ? [manifestSource] : []),
            ...(preserveSourceOrder && resolvedHeaderSource && parseSteamAssetSource(source)?.asset.toLowerCase() === "header.jpg"
              ? [resolvedHeaderSource]
              : []),
            ...(cdnFallback && cdnFallback !== source ? [cdnFallback] : []),
            ...(!shouldPrependCachedSource && cachedSource && cachedSource !== source
              ? [cachedSource]
              : []),
          ]);
        }
        return uniqueSources([
          ...(manifestSource ? [manifestSource] : []),
          source,
          ...(shouldPrependCachedSource ? [cachedSource] : []),
          ...(cdnFallback && cdnFallback !== source ? [cdnFallback] : []),
          ...(!shouldPrependCachedSource && cachedSource && cachedSource !== source
            ? [cachedSource]
            : []),
        ]);
      }),
    ]
  );
}

export function getLoadedImageSource(sources: string[]) {
  return withCachedImageSources(sources, { requestManifests: false }).find(
    (source) => loadedImageSources.has(source)
  );
}

export async function resolveCachedImageSource(
  source: string,
  options: { steamAssetFallback?: boolean; cachePredictable?: boolean } = {}
) {
  if (!/^https?:\/\//i.test(source)) return source;
  if (
    isPredictableSteamAssetSource(source) &&
    !options.cachePredictable &&
    !(options.steamAssetFallback && canResolveSteamLibraryAssetFallback(source))
  ) {
    return source;
  }

  const cachedSource = cachedImageSourceFor(source);
  if (cachedSource) {
    return cachedSource;
  }

  const pending = imageResolvePromises.get(source);
  if (pending) return pending;

  const promise = resolveCachedImageBatched(source)
    .then((nextSource) => {
      if (nextSource) {
        storeCachedImageSource(source, nextSource);
        scheduleStoredImageSourceCacheWrite();
        return nextSource;
      }
      return source;
    })
    .catch(() => source)
    .finally(() => {
      imageResolvePromises.delete(source);
    });

  imageResolvePromises.set(source, promise);

  return promise;
}

/**
 * Esquece um source que falhou ao carregar — tanto como chave (URL remota
 * quebrada) quanto como valor (arquivo do cache em disco que sumiu, deixando um
 * `asset://` órfão no mapa persistido). Sem isso, um cache apontando para um
 * arquivo apagado nunca mais é rebaixado: `resolveCachedImageSource` devolve o
 * caminho morto para sempre e a imagem fica quebrada mesmo com a URL de origem
 * saudável.
 */
export function forgetCachedImageSource(source: string) {
  if (!source) return;

  let changed = imageSourceCache.delete(source);
  for (const [key, cachedSource] of imageSourceCache) {
    if (cachedSource !== source) continue;
    imageSourceCache.delete(key);
    changed = true;
  }

  loadedImageSources.delete(source);
  imageResolvePromises.delete(source);
  if (changed) {
    rebuildImageIdentitySourceCache();
    scheduleStoredImageSourceCacheWrite();
  }
}

/**
 * Invalida o estado efemero quando o usuário limpa o cache de imagens. Sem
 * isso o frontend continuava apontando para `asset://` removido até a próxima
 * falha de carregamento.
 */
export function clearImageCacheState() {
  imageCacheGeneration += 1;
  imageSourceCache.clear();
  imageIdentitySourceCache.clear();
  imageResolvePromises.clear();
  steamLibraryCoverSourceCache.clear();
  steamLibraryCoverResolvePromises.clear();
  steamHeaderSourceCache.clear();
  steamHeaderResolvePromises.clear();
  screenshotPreloadCache.clear();
  loadedImageSources.clear();
  imagePreloadPromises.clear();
  imagePreloadFailures.clear();
  imagePreloadQueue.length = 0;
  imageBatchQueue = [];
  imageBatchScheduled = false;

  if (cancelPendingCacheWrite) {
    cancelPendingCacheWrite();
    cancelPendingCacheWrite = null;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(imageSourceCacheKey);
    } catch {
      // O cache em disco já foi limpo pelo Rust.
    }
  }
}

export function preloadBrowserImage(
  source: string,
  options: ImagePreloadOptions = {}
) {
  if (!source || typeof Image === "undefined") return Promise.resolve();

  const pending = imagePreloadPromises.get(source);
  if (pending) return pending;

  if (screenshotPreloadCache.has(source)) return Promise.resolve();

  const failedAt = imagePreloadFailures.get(source);
  if (
    failedAt &&
    !options.forceRetry &&
    Date.now() - failedAt < imagePreloadRetryDelayMs
  ) {
    return Promise.resolve();
  }

  screenshotPreloadCache.add(source);

  const load = () =>
    new Promise<void>((resolve, reject) => {
        const image = new Image();

        image.decoding = "async";
        image.onload = async () => {
          if (options.decode && typeof image.decode === "function") {
            await image.decode().catch(() => undefined);
          }

          imagePreloadFailures.delete(source);
          markImageSourceLoaded(source);
          resolve();
        };
        image.onerror = () => {
          screenshotPreloadCache.delete(source);
          imagePreloadFailures.set(source, Date.now());
          reject(new Error(`Failed to preload image: ${source}`));
        };
        image.src = source;
      });
  const promise = (options.immediate ? load() : enqueueImagePreload(load))
    .catch(() => undefined)
    .finally(() => {
      imagePreloadPromises.delete(source);
    });

  imagePreloadPromises.set(source, promise);

  return promise;
}

export function preloadImageSources(
  sources: string[],
  options: ImagePreloadOptions & {
    includeCached?: boolean;
    idle?: boolean;
    limit?: number;
    nativeFirst?: boolean;
  } = {}
) {
  const candidates = uniqueSources(sources).slice(
    0,
    options.limit ?? sources.length
  );
  const run = () => {
    candidates.forEach((source) => {
      if (options.nativeFirst) {
        void resolveCachedImageSource(source, { cachePredictable: true }).then(
          (resolvedSource) =>
            preloadBrowserImage(resolvedSource || source, {
              ...options,
              immediate: resolvedSource !== source,
            })
        );
        return;
      }
      void preloadBrowserImage(source, options);
      if (options.includeCached === false) return;

      void resolveCachedImageSource(source).then((cachedSource) => {
        if (cachedSource !== source) {
          void preloadBrowserImage(cachedSource, options);
        }
      });
    });
  };

  if (options.idle) return runWhenIdle(run);

  run();
  return () => undefined;
}

readStoredImageSourceCache();
