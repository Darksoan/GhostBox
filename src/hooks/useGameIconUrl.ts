import { useEffect, useState } from "react";
import { getGameAppId } from "../utils/image";
import type { PirateGame } from "../data";
import { pirateboxApi } from "../lib/pirateboxApi";

const cache = new Map<string, string>();

export function useGameIconUrl(game: PirateGame) {
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

      void pirateboxApi.getGameIconUrl(appId).then((result) => {
        if (result) cache.set(appId, result);
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
