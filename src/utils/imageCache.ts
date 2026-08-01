import { loadCachedImage, resolveSteamLibraryAsset } from "../data";
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
export const imageResolvePromises = new Map<string, Promise<string>>();
export const screenshotPreloadCache = new Set<string>();
const steamLibraryCoverSourceCache = new Map<string, string>();
const steamLibraryCoverResolvePromises = new Map<string, Promise<string>>();
const steamHeaderSourceCache = new Map<string, string>();
const steamHeaderResolvePromises = new Map<string, Promise<string>>();
// Sources that have actually finished loading at least once. Unlike
// screenshotPreloadCache (which is set optimistically when a load starts and
// removed on failure), this only holds sources we know decoded successfully,
// so consumers can paint them synchronously without a flicker.
export const loadedImageSources = new Set<string>();

type ImagePreloadOptions = {
  decode?: boolean;
  forceRetry?: boolean;
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

export function readStoredImageSourceCache() {
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(imageSourceCacheKey) ?? "{}"
    ) as Record<string, string>;

    Object.entries(parsed).forEach(([source, cachedSource]) => {
      if (typeof source === "string" && typeof cachedSource === "string") {
        imageSourceCache.set(source, cachedSource);
      }
    });
  } catch {
    imageSourceCache.clear();
  }
}

export function writeStoredImageSourceCache() {
  if (typeof window === "undefined") return;

  try {
    const entries = [...imageSourceCache.entries()].slice(
      -imageSourceCacheLimit
    );
    imageSourceCache.clear();
    entries.forEach(([source, cachedSource]) =>
      imageSourceCache.set(source, cachedSource)
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
export function scheduleStoredImageSourceCacheWrite() {
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
    return `url("${encodeURI(source).replace(/"/g, "%22")}")`;
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

    if (!/steamstatic\.com$/i.test(url.hostname)) return null;

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

  const promise = resolveSteamLibraryAsset(appId, "library_capsule.jpg")
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

  const promise = resolveSteamLibraryAsset(appId, "header.jpg")
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

export function withCachedImageSources(sources: string[]) {
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
  requestSteamAssetManifests(appIds);

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

  return uniqueSources(
    [
      ...(resolvedCoverSource ? [resolvedCoverSource] : []),
      ...(resolvedHeaderSource ? [resolvedHeaderSource] : []),
      ...orderedSources.flatMap((source) => {
        const manifestSource = steamAssetManifestSourceFor(source);
        const cachedSource = imageSourceCache.get(source);
        const cdnFallback = steamCdnFallbackForSource(source);
        const shouldPrependCachedSource =
          cachedSource &&
          cachedSource !== source &&
          !isHigherDensityFallbackForStandardSteamAsset(source, cachedSource);
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

export async function resolveCachedImageSource(
  source: string,
  options: { steamAssetFallback?: boolean } = {}
) {
  if (!/^https?:\/\//i.test(source)) return source;
  if (
    isPredictableSteamAssetSource(source) &&
    !(options.steamAssetFallback && canResolveSteamLibraryAssetFallback(source))
  ) {
    return source;
  }

  const cachedSource = imageSourceCache.get(source);
  if (cachedSource) {
    return cachedSource;
  }

  const pending = imageResolvePromises.get(source);
  if (pending) return pending;

  const promise = loadCachedImage(source)
    .then((nextSource) => {
      if (nextSource) {
        imageSourceCache.set(source, nextSource);
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

  const promise = enqueueImagePreload(
    () =>
      new Promise<void>((resolve, reject) => {
        const image = new Image();

        image.decoding = "async";
        image.onload = async () => {
          if (options.decode && typeof image.decode === "function") {
            await image.decode().catch(() => undefined);
          }

          imagePreloadFailures.delete(source);
          loadedImageSources.add(source);
          resolve();
        };
        image.onerror = () => {
          screenshotPreloadCache.delete(source);
          imagePreloadFailures.set(source, Date.now());
          reject(new Error(`Failed to preload image: ${source}`));
        };
        image.src = source;
      })
  )
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
  } = {}
) {
  const candidates = uniqueSources(sources).slice(
    0,
    options.limit ?? sources.length
  );
  const run = () => {
    candidates.forEach((source) => {
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
