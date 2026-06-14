import { useEffect, useState } from "react";
import { getGameAppId } from "../utils/image";
import type { GhostBoxGame } from "../data";
import { ghostboxApi } from "../lib/ghostboxApi";

const gameIconUrlCacheKey = "ghostbox:game-icon-url-cache:v1";
const legacyEdenGameIconUrlCacheKey = "eden:game-icon-url-cache:v1";
const legacyGameIconUrlCacheKey = "piratebox:game-icon-url-cache:v1";
const gameIconUrlCacheLimit = 300;
const cache = new Map<string, string>();
const requestCache = new Map<string, Promise<string | null>>();

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
      if (/^\d+$/.test(appId) && typeof url === "string" && url) {
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

function loadIconUrl(appId: string) {
  const pending = requestCache.get(appId);
  if (pending) return pending;

  const request = ghostboxApi
    .getGameIconUrl(appId)
    .then((result) => {
      if (result) {
        cache.set(appId, result);
        writeStoredCache();
      }

      return result ?? null;
    })
    .catch(() => null)
    .finally(() => {
      requestCache.delete(appId);
    });

  requestCache.set(appId, request);
  return request;
}

readStoredCache();

export function useGameIconUrl(game: GhostBoxGame) {
  const appId = getGameAppId(game);
  const [url, setUrl] = useState<string | null>(() => cache.get(appId) ?? null);

  useEffect(() => {
    let cancelled = false;

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

    load();

    return () => {
      cancelled = true;
    };
  }, [appId]);

  return url;
}
