import { useEffect, useMemo, useState } from "react";
import type { GhostBoxGame } from "../data";
import { loadSteamPlayerCounts } from "../data";
import { normalizeGameCacheId } from "../utils/gameCache";

/** Reamostra enquanto a prateleira está montada — o número é vivo. */
const REFRESH_INTERVAL_MS = 120_000;

/**
 * Jogadores online agora para uma lista de jogos, por app id.
 *
 * O `playingNow` que chega junto do jogo é a amostra diária da SteamSpy vista
 * através do cache de catálogo; este hook busca a contagem real da Steam pelo
 * backend (ver `steam_get_player_counts`), que mantém cache curto próprio.
 *
 * App id fora do mapa é "sem dado" — o card mostra travessão em vez de zero.
 */
export function useSteamPlayerCounts(games: GhostBoxGame[], enabled = true) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // A lista é recriada a cada render do pai; a chave é o que de fato muda.
  const appIds = useMemo(
    () => [...new Set(games.map((game) => normalizeGameCacheId(game)).filter(Boolean))],
    [games]
  );
  const appIdsKey = appIds.join("|");

  useEffect(() => {
    if (!enabled || !appIdsKey) return;

    let cancelled = false;
    const ids = appIdsKey.split("|");

    const load = async () => {
      const loaded = await loadSteamPlayerCounts(ids).catch(() => null);
      if (cancelled || !loaded) return;
      // Mescla em vez de substituir: uma resposta parcial (Steam fora do ar
      // para um app) não deve apagar as contagens que já estavam na tela.
      setCounts((current) => ({ ...current, ...loaded }));
    };

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [appIdsKey, enabled]);

  return counts;
}
