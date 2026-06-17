import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
} from "../utils/gameCache";
import { mergeGameCardData } from "../utils/gameCardData";

export function useEnrichedGameCards(games: GhostBoxGame[], limit = 80) {
  const requestedKeysRef = useRef(new Set<string>());
  const [detailsByAppId, setDetailsByAppId] = useState(
    () => new Map<string, GhostBoxGame>()
  );
  const gamesKey = games.map((game) => game.id).join("|");

  useEffect(() => {
    let cancelled = false;
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
      const storeKey = `${game.id}:store`;
      if (!requestedKeysRef.current.has(storeKey)) {
        requestedKeysRef.current.add(storeKey);
        loadGameStoreDetailsCached(game.id)
          .then((details) => mergeDetails(game, details))
          .catch(() => undefined);
      }

      const achievementKey = `${game.id}:achievements`;
      if (!requestedKeysRef.current.has(achievementKey)) {
        requestedKeysRef.current.add(achievementKey);
        loadGameAchievementDetailsCached(game.id)
          .then((details) => mergeDetails(game, details))
          .catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [gamesKey, games, limit]);

  return useMemo(
    () =>
      games.map((game) => {
        const details = detailsByAppId.get(game.appId);
        return details ? mergeGameCardData(game, details) : game;
      }),
    [detailsByAppId, games]
  );
}
