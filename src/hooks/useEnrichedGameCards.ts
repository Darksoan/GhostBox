import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
  normalizeGameCacheId,
} from "../utils/gameCache";
import { mergeGameCardData } from "../utils/gameCardData";

export function useEnrichedGameCards(
  games: GhostBoxGame[],
  limit = 80,
  enabled = true,
) {
  const requestedKeysRef = useRef(new Set<string>());
  const [detailsByAppId, setDetailsByAppId] = useState(
    () => new Map<string, GhostBoxGame>()
  );
  const gamesKey = games.map((game) => normalizeGameCacheId(game)).join("|");

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const outstandingKeys = new Set<string>();
    // Buffer incoming detail resolutions and flush them into state once per
    // animation frame, so a burst of resolved promises produces a single
    // re-render instead of one per resolution.
    const pending: Array<{ baseGame: GhostBoxGame; details: GhostBoxGame }> = [];
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      if (cancelled || pending.length === 0) return;

      const batch = pending.splice(0, pending.length);
      setDetailsByAppId((current) => {
        const next = new Map(current);
        for (const { baseGame, details } of batch) {
          const existing = next.get(baseGame.appId) ?? baseGame;
          next.set(baseGame.appId, mergeGameCardData(existing, details));
        }
        return next;
      });
    };

    const mergeDetails = (baseGame: GhostBoxGame, details: GhostBoxGame | null) => {
      if (cancelled || !details) return;
      pending.push({ baseGame, details });
      if (frame === null) {
        frame = requestAnimationFrame(flush);
      }
    };

    games.slice(0, limit).forEach((game) => {
      const gameKey = normalizeGameCacheId(game);
      if (!gameKey) return;

      const storeKey = `${gameKey}:store`;
      if (!requestedKeysRef.current.has(storeKey)) {
        requestedKeysRef.current.add(storeKey);
        outstandingKeys.add(storeKey);
        loadGameStoreDetailsCached(gameKey)
          .then((details) => mergeDetails(game, details))
          .catch(() => undefined)
          .finally(() => outstandingKeys.delete(storeKey));
      }

      const achievementKey = `${gameKey}:achievements`;
      if (!requestedKeysRef.current.has(achievementKey)) {
        requestedKeysRef.current.add(achievementKey);
        outstandingKeys.add(achievementKey);
        loadGameAchievementDetailsCached(gameKey)
          .then((details) => mergeDetails(game, details))
          .catch(() => undefined)
          .finally(() => outstandingKeys.delete(achievementKey));
      }
    });

    return () => {
      cancelled = true;
      for (const key of outstandingKeys) {
        requestedKeysRef.current.delete(key);
      }
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [enabled, gamesKey, games, limit]);

  return useMemo(
    () =>
      games.map((game) => {
        const details = detailsByAppId.get(game.appId);
        return details ? mergeGameCardData(game, details) : game;
      }),
    [detailsByAppId, games]
  );
}
