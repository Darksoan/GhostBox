import type { GhostBoxGame } from "../data";

/**
 * Normaliza `appdetails.data.type` para minúsculas.
 * Retorna "" quando ausente/inválido (= não classificado).
 */
export function normalizeSteamAppType(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9_-]{1,32}$/.test(normalized)) return "";
  return normalized;
}

/** Verdadeiro somente quando o app foi classificado como demo pela Steam. */
export function isBlockedSteamDemo(
  game: Pick<GhostBoxGame, "appType"> | null | undefined,
): boolean {
  if (!game) return false;
  return normalizeSteamAppType(game.appType) === "demo";
}

/**
 * Remove demos classificadas de uma lista, preservando identidade do array
 * quando nada precisa sair (evita re-renders em cascata).
 * Itens sem `appType` (não classificados) são mantidos — a classificação
 * assíncrona os remove depois, sem esvaziar a biblioteca no primeiro load.
 */
export function filterOutSteamDemos<T extends Pick<GhostBoxGame, "appType">>(
  games: T[],
): T[] {
  let blocked = false;
  for (const game of games) {
    if (isBlockedSteamDemo(game)) {
      blocked = true;
      break;
    }
  }
  if (!blocked) return games;
  return games.filter((game) => !isBlockedSteamDemo(game));
}

/**
 * Extrai `appType` de payloads variados (catálogo D1, steam-details proxy,
 * appdetails direto, cache Rust) sem acoplar callers ao formato.
 */
export function extractSteamAppType(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["appType", "app_type", "type"]) {
    const normalized = normalizeSteamAppType(record[key]);
    if (normalized) return normalized;
  }
  return "";
}

export function steamAppIdOf(game: Pick<GhostBoxGame, "appId" | "id">): string {
  const appId = game.appId?.trim() ?? "";
  if (/^\d{1,10}$/.test(appId)) return appId;
  const id = game.id?.trim() ?? "";
  const fromId = id.match(/^steam-(\d{1,10})$/i)?.[1] ?? "";
  return fromId;
}

/** Applies resolved Steam types without changing games that have no match. */
export function applySteamAppTypes<T extends Pick<GhostBoxGame, "appId" | "id" | "appType">>(
  games: T[],
  types: Readonly<Record<string, string>>,
): T[] {
  let changed = false;
  const next = games.map((game) => {
    const appId = steamAppIdOf(game);
    const appType = normalizeSteamAppType(types[appId]);
    if (!appType || normalizeSteamAppType(game.appType) === appType) return game;
    changed = true;
    return { ...game, appType };
  });
  return changed ? next : games;
}

/**
 * Strict visibility for Steam-backed games: an unclassified numeric app is
 * withheld rather than risking a demo leak. Non-Steam entries without an app
 * id are unaffected.
 */
export function filterVisibleSteamGames<T extends Pick<GhostBoxGame, "appId" | "id" | "appType">>(
  games: T[],
): T[] {
  return games.filter((game) => {
    if (isBlockedSteamDemo(game)) return false;
    const appId = steamAppIdOf(game);
    return !appId || Boolean(normalizeSteamAppType(game.appType));
  });
}
