import { useEffect, useState } from "react";
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
let storedCacheWriteTimeout: ReturnType<typeof setTimeout> | null = null;
let batchLoadTimeout: ReturnType<typeof setTimeout> | null = null;

function isSteamClientIconUrl(appId: string, url: string) {
  return (
    url.startsWith("https://") &&
    url.includes(`steamcommunity/public/images/apps/${appId}/`) &&
    /\.ico(?:[?#].*)?$/i.test(url)
  );
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
      if (/^\d+$/.test(appId) && typeof url === "string" && isSteamClientIconUrl(appId, url)) {
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
    const entries = [...cache.entries()].slice(-gameIconUrlCacheLimit);
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
    if (/^\d+$/.test(appId) && typeof url === "string" && isSteamClientIconUrl(appId, url)) {
      cache.set(appId, url);
      validResult[appId] = url;
      changed = true;
    }
  });

  if (changed) {
    scheduleStoredCacheWrite();
    notifyListeners();
  }

  return validResult;
}

function scheduleBatchLoad() {
  if (batchLoadTimeout) return;

  batchLoadTimeout = setTimeout(() => {
    batchLoadTimeout = null;
    const appIds = [...queuedAppIds].filter((appId) => !cache.has(appId));
    queuedAppIds.clear();
    if (!appIds.length) return;

    const request = ghostboxApi
      .getGameIconUrls(appIds)
      .then(storeResolvedIcons)
      .catch(() => ({} as Record<string, string>));

    appIds.forEach((appId) => {
      requestCache.set(
        appId,
        request
          .then((result) => result[appId] ?? null)
          .finally(() => {
            requestCache.delete(appId);
          })
      );
    });
  }, 25);
}

function loadIconUrl(appId: string) {
  if (cache.has(appId)) return Promise.resolve(cache.get(appId) ?? null);

  const pending = requestCache.get(appId);
  if (pending) return pending;

  const request = new Promise<string | null>((resolve) => {
    queuedAppIds.add(appId);
    scheduleBatchLoad();

    const waitForBatchRequest = () => {
      const next = requestCache.get(appId);
      if (next && next !== request) {
        void next.then(resolve);
        return;
      }
      window.setTimeout(waitForBatchRequest, 10);
    };
    waitForBatchRequest();
  }).finally(() => {
    if (requestCache.get(appId) === request) requestCache.delete(appId);
  });

  requestCache.set(appId, request);
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

export function useGameIconUrl(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const [url, setUrl] = useState<string | null>(() => cache.get(appId) ?? null);

  useEffect(() => {
    let cancelled = false;

    const syncFromCache = () => {
      if (!cancelled && cache.has(appId)) {
        setUrl(cache.get(appId) ?? null);
      }
    };

    const load = () => {
      if (cache.has(appId)) {
        if (!cancelled) setUrl(cache.get(appId) ?? null);
        return;
      }

      if (!cancelled) setUrl(null);

      void loadIconUrl(appId).then((result) => {
        if (!cancelled) setUrl(result ?? null);
      });
    };

    listeners.add(syncFromCache);
    load();

    return () => {
      cancelled = true;
      listeners.delete(syncFromCache);
    };
  }, [appId]);

  return url;
}
