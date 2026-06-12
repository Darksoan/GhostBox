import { useEffect, useMemo, useRef, useState } from "react";
import type { PirateGame } from "../data";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
} from "../utils/gameCache";
import { mergeGameCardData } from "../utils/gameCardData";

export function useEnrichedGameCards(games: PirateGame[], limit = 80) {
  const requestedKeysRef = useRef(new Set<string>());
  const [detailsByAppId, setDetailsByAppId] = useState(
    () => new Map<string, PirateGame>()
  );
  const gamesKey = games.map((game) => game.id).join("|");

  useEffect(() => {
    let cancelled = false;

    const mergeDetails = (baseGame: PirateGame, details: PirateGame | null) => {
      if (cancelled || !details) return;

      setDetailsByAppId((current) => {
        const existing = current.get(baseGame.appId) ?? baseGame;
        const merged = mergeGameCardData(existing, details);
        const next = new Map(current);
        next.set(baseGame.appId, merged);
        return next;
      });
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
