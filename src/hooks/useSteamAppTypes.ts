import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import { loadSteamAppTypes } from "../data";
import { normalizeSteamAppType, steamAppIdOf } from "../utils/steamAppType";

const STEAM_APP_TYPE_BATCH_SIZE = 50;
const STEAM_APP_TYPE_DEBOUNCE_MS = 350;

function collectUnclassifiedAppIds(games: readonly GhostBoxGame[]): string[] {
  const ids = new Set<string>();
  for (const game of games) {
    if (normalizeSteamAppType(game.appType)) continue;
    const appId = steamAppIdOf(game);
    if (/^\d{1,10}$/.test(appId)) ids.add(appId);
  }
  return [...ids];
}

/**
 * Classificação batch de `appType` via Rust (`steam_get_app_types`).
 *
 * - Agrupa ids em lotes de 50 (limite do endpoint/proxy).
 * - Faz merge incremental: resposta parcial nunca apaga tipos já resolvidos.
 * - Falha de rede é silenciosa: itens seguem não classificados e tentam de
 *   novo quando a lista mudar.
 * - Debounce para não disparar um batch por flush de enriquecimento.
 */
export function useSteamAppTypes(
  games: readonly GhostBoxGame[],
  enabled = true,
): Record<string, string> {
  const [types, setTypes] = useState<Record<string, string>>({});
  const typesRef = useRef(types);
  typesRef.current = types;
  const gamesKey = useMemo(
    () => games.map((game) => `${steamAppIdOf(game)}:${normalizeSteamAppType(game.appType)}`).join("|"),
    [games],
  );
  const gamesRef = useRef(games);
  gamesRef.current = games;

  useEffect(() => {
    if (!enabled || !gamesKey) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const missing = collectUnclassifiedAppIds(gamesRef.current).filter(
        (appId) => !typesRef.current[appId],
      );
      if (!missing.length) return;
      void (async () => {
        const merged: Record<string, string> = {};
        for (let offset = 0; offset < missing.length; offset += STEAM_APP_TYPE_BATCH_SIZE) {
          const batch = missing.slice(offset, offset + STEAM_APP_TYPE_BATCH_SIZE);
          try {
            const resolved = await loadSteamAppTypes(batch);
            for (const [appId, appType] of Object.entries(resolved ?? {})) {
              const normalized = normalizeSteamAppType(appType);
              if (/^\d{1,10}$/.test(appId) && normalized) merged[appId] = normalized;
            }
          } catch {
            // Rede/Rust indisponível: mantém não classificado para retry futuro.
          }
          if (cancelled) return;
        }
        if (cancelled || !Object.keys(merged).length) return;
        setTypes((current) => ({ ...current, ...merged }));
      })();
    }, STEAM_APP_TYPE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, gamesKey]);

  return types;
}
