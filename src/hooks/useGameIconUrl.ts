import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getGameAppId } from "../utils/image";
import type { GhostBoxGame } from "../data";
import { ghostboxApi } from "../lib/ghostboxApi";

const gameIconUrlCacheKey = "ghostbox:game-icon-url-cache:v2";
const legacyEdenGameIconUrlCacheKey = "eden:game-icon-url-cache:v1";
const legacyGameIconUrlCacheKey = "piratebox:game-icon-url-cache:v1";
const gameIconUrlCacheLimit = 300;
const cache = new Map<string, string>();
const requestCache = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();
const queuedAppIds = new Set<string>();
const backgroundAppIds = new Set<string>();
const negativeCache = new Map<string, number>();
const negativeCacheTtlMs = 10 * 60 * 1000;
let storedCacheWriteTimeout: ReturnType<typeof setTimeout> | null = null;
let batchLoadTimeout: ReturnType<typeof setTimeout> | null = null;

function isSteamCommunityIconUrl(appId: string, url: string) {
  return (
    url.startsWith("https://") &&
    url.includes(`steamcommunity/public/images/apps/${appId}/`) &&
    /\.(?:ico|jpe?g|png)(?:[?#].*)?$/i.test(url)
  );
}

function isAssetOrLocalIconUrl(url: string) {
  return (
    url.startsWith("asset:") ||
    url.startsWith("https://asset.localhost/") ||
    url.startsWith("http://asset.localhost/") ||
    /^[a-zA-Z]:[\\/]/.test(url) ||
    url.startsWith("\\\\")
  );
}

function isGameIconUrl(appId: string, url: string) {
  return isSteamCommunityIconUrl(appId, url) || isAssetOrLocalIconUrl(url);
}

function toDisplayIconUrl(url: string) {
  if (
    url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("asset:") ||
    url.startsWith("data:")
  ) {
    return url;
  }

  try {
    return convertFileSrc(url);
  } catch {
    return url;
  }
}

function readStoredCache() {
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(gameIconUrlCacheKey) ??
        window.localStorage.getItem(legacyEdenGameIconUrlCacheKey) ??
        window.localStorage.getItem(legacyGameIconUrlCacheKey) ??
        "{}"
    ) as Record<string, string>;

    Object.entries(parsed).forEach(([appId, url]) => {
      if (/^\d+$/.test(appId) && typeof url === "string" && isSteamCommunityIconUrl(appId, url)) {
        cache.set(appId, url);
      }
    });
  } catch {
    cache.clear();
  }
}

function writeStoredCache() {
  if (typeof window === "undefined") return;

  try {
    const entries = [...cache.entries()]
      .filter(([appId, url]) => isSteamCommunityIconUrl(appId, url))
      .slice(-gameIconUrlCacheLimit);
    window.localStorage.setItem(
      gameIconUrlCacheKey,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // Sidebar icons still work through IPC during this session if storage fails.
  }
}

function scheduleStoredCacheWrite() {
  if (storedCacheWriteTimeout) return;

  storedCacheWriteTimeout = setTimeout(() => {
    storedCacheWriteTimeout = null;
    writeStoredCache();
  }, 250);
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function storeResolvedIcons(result: Record<string, string>) {
  let changed = false;
  const validResult: Record<string, string> = {};

  Object.entries(result).forEach(([appId, url]) => {
    if (!/^\d+$/.test(appId) || typeof url !== "string" || !url.trim()) return;
    const displayUrl = toDisplayIconUrl(url.trim());
    if (!isGameIconUrl(appId, displayUrl) && !isGameIconUrl(appId, url.trim())) return;
    const finalUrl = isGameIconUrl(appId, displayUrl) ? displayUrl : toDisplayIconUrl(url.trim());
    cache.set(appId, finalUrl);
    backgroundAppIds.delete(appId);
    negativeCache.delete(appId);
    validResult[appId] = finalUrl;
    changed = true;
  });

  if (changed) {
    scheduleStoredCacheWrite();
    notifyListeners();
  }

  return validResult;
}

function isNegativelyCached(appId: string) {
  const expiresAt = negativeCache.get(appId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    negativeCache.delete(appId);
    return false;
  }
  return true;
}

function resolveIconsInBackground(appIds: string[]) {
  const pending = appIds.filter(
    (appId) =>
      !cache.has(appId) &&
      !backgroundAppIds.has(appId) &&
      !isNegativelyCached(appId),
  );
  if (!pending.length) return;

  pending.forEach((appId) => backgroundAppIds.add(appId));
  void ghostboxApi
    .resolveGameIconUrls(pending)
    .then(storeResolvedIcons)
    .catch(() => ({} as Record<string, string>))
    .finally(() => {
      pending.forEach((appId) => {
        backgroundAppIds.delete(appId);
        if (!cache.has(appId)) {
          negativeCache.set(appId, Date.now() + negativeCacheTtlMs);
        }
      });
      notifyListeners();
    });
}

function flushBatchLoad() {
  batchLoadTimeout = null;
  const appIds = [...queuedAppIds].filter(
    (appId) =>
      !cache.has(appId) &&
      !requestCache.has(appId) &&
      !isNegativelyCached(appId),
  );
  queuedAppIds.clear();
  if (!appIds.length) return;

  const request = ghostboxApi
    .getLocalGameIconUrls(appIds)
    .then((result) => {
      const resolved = storeResolvedIcons(result);
      resolveIconsInBackground(
        appIds.filter(
          (appId) => !Object.prototype.hasOwnProperty.call(resolved, appId),
        ),
      );
      return resolved;
    })
    .catch(() => ({} as Record<string, string>));

  appIds.forEach((appId) => {
    requestCache.set(
      appId,
      request
        .then((result) => result[appId] ?? null)
        .finally(() => {
          if (requestCache.get(appId)) {
            // Keep settled promise until consumers finish reading.
            requestCache.delete(appId);
          }
        })
    );
  });
}

function scheduleBatchLoad() {
  if (batchLoadTimeout) return;
  // 0ms still coalesces every loadIconUrl scheduled in the same tick (preload lists).
  batchLoadTimeout = setTimeout(flushBatchLoad, 0);
}

function loadIconUrl(appId: string) {
  if (cache.has(appId)) return Promise.resolve(cache.get(appId) ?? null);
  if (isNegativelyCached(appId)) return Promise.resolve(null);

  const pending = requestCache.get(appId);
  if (pending) return pending;

  queuedAppIds.add(appId);

  const request = new Promise<string | null>((resolve, reject) => {
    const attach = () => {
      const next = requestCache.get(appId);
      if (next) {
        next.then(resolve, reject);
        return;
      }
      if (cache.has(appId)) {
        resolve(cache.get(appId) ?? null);
        return;
      }
      if (!queuedAppIds.has(appId)) {
        resolve(null);
        return;
      }
      window.setTimeout(attach, 0);
    };

    scheduleBatchLoad();
    attach();
  });

  return request;
}

export function preloadGameIconUrls(games: GhostBoxGame[]) {
  const appIds = [
    ...new Set(
      games
        .map(getGameAppId)
        .filter(
          (appId) =>
            /^\d+$/.test(appId) && !cache.has(appId) && !requestCache.has(appId)
        )
    ),
  ];

  if (appIds.length === 0) return;

  appIds.forEach((appId) => void loadIconUrl(appId));
}

readStoredCache();
ghostboxApi.onGameIconUrlsResolved(storeResolvedIcons);

export function useGameIconUrl(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const hasNumericAppId = /^\d+$/.test(appId);
  const [url, setUrl] = useState<string | null>(() => cache.get(appId) ?? null);
  const [loading, setLoading] = useState(
    () => hasNumericAppId && !cache.has(appId)
  );

  useEffect(() => {
    let cancelled = false;

    const syncFromCache = () => {
      if (cancelled) return;
      if (cache.has(appId)) {
        setUrl(cache.get(appId) ?? null);
        setLoading(false);
      } else if (!requestCache.has(appId) && !backgroundAppIds.has(appId)) {
        setLoading(false);
      }
    };

    const load = () => {
      if (!hasNumericAppId) {
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
        return;
      }

      if (cache.has(appId)) {
        if (!cancelled) {
          setUrl(cache.get(appId) ?? null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setUrl(null);
        setLoading(true);
      }

      void loadIconUrl(appId).then((result) => {
        if (cancelled) return;
        setUrl(result ?? null);
        setLoading(backgroundAppIds.has(appId));
      });
    };

    listeners.add(syncFromCache);
    load();

    return () => {
      cancelled = true;
      listeners.delete(syncFromCache);
    };
  }, [appId, hasNumericAppId]);

  return { url, loading };
}
