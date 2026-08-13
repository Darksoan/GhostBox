import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import {
  loadGameAchievementDetailsCached,
  loadGameStoreDetailsCached,
  normalizeGameCacheId,
} from "../utils/gameCache";
import { mergeGameCardData } from "../utils/gameCardData";
import { gameCardEnrichmentQueue } from "../utils/requestQueue";

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
  // O efeito reage a `gamesKey`, não à identidade do array: o pai recria a
  // lista a cada render e disparar o cleanup nisso cancelaria e re-enfileiraria
  // as buscas que já estavam em andamento.
  const gamesRef = useRef(games);
  gamesRef.current = games;

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

    // A fila segura as buscas num teto de concorrência: a lista pode ter 80
    // jogos, mas só um punhado vai ao worker por vez. As que ainda não saíram
    // da fila quando o efeito é cancelado nunca viram requisição.
    const enqueueDetails = (
      game: GhostBoxGame,
      key: string,
      load: (gameKey: string) => Promise<GhostBoxGame | null>,
      gameKey: string
    ) => {
      if (requestedKeysRef.current.has(key)) return;
      requestedKeysRef.current.add(key);
      outstandingKeys.add(key);

      void gameCardEnrichmentQueue
        .enqueue(() => {
          if (cancelled) return null;
          return load(gameKey);
        })
        .then((details) => mergeDetails(game, details))
        .catch(() => undefined)
        .finally(() => outstandingKeys.delete(key));
    };

    gamesRef.current.slice(0, limit).forEach((game) => {
      const gameKey = normalizeGameCacheId(game);
      if (!gameKey) return;

      enqueueDetails(
        game,
        `${gameKey}:store`,
        loadGameStoreDetailsCached,
        gameKey
      );
      enqueueDetails(
        game,
        `${gameKey}:achievements`,
        loadGameAchievementDetailsCached,
        gameKey
      );
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
  }, [enabled, gamesKey, limit]);

  return useMemo(
    () =>
      games.map((game) => {
        const details = detailsByAppId.get(game.appId);
        return details ? mergeGameCardData(game, details) : game;
      }),
    [detailsByAppId, games]
  );
}
