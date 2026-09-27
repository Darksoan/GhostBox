import type { GhostBoxGame, SteamAchievement } from "../data";
import type { SteamAccountStats, SteamGameAchievementSummary } from "../types";
import { isAchievementUnlocked } from "./achievementStats";

export type SteamAchievementIndex = ReadonlyMap<string, SteamAchievement[]>;

const steamAchievementIndexCache = new WeakMap<
  SteamAccountStats,
  SteamAchievementIndex
>();

function isoFromUnixSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Ícones de conquista migraram para `community_assets`, mas payloads antigos
 * (cache em disco, DB do catálogo, schema) ainda trazem o host legado
 * `steamcommunity/public/images/apps/...`, que dá 404 para jogos novos
 * (ex. Aniimo 4126040). O arquivo (hash + extensão) é o mesmo.
 */
export function normalizeAchievementImageSource(source: string | undefined): string {
  const trimmed = (source ?? "").trim();
  if (!trimmed) return "";
  const match =
    /^https?:\/\/[^/]+\/steamcommunity\/public\/images\/apps\/(\d+)\/([^?#]+)([?#].*)?$/i.exec(
      trimmed,
    );
  if (!match) return trimmed;
  const [, appId, file] = match;
  if (!/^[a-f0-9]+\.(?:jpg|jpeg|png|ico)$/i.test(file)) return trimmed;
  return `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appId}/${file}`;
}

/**
 * Ordem de tentativa de um ícone: variante normalizada primeiro (host atual),
 * depois o URL original (jogos antigos ainda espelham nos dois). Usado para
 * recuperar payloads já guardados sem esperar o próximo refetch.
 */
export function achievementIconFallbackSources(
  achievement: Pick<SteamAchievement, "icon" | "iconGray">,
  unlocked: boolean,
): string[] {
  const primary = unlocked
    ? achievement.icon || achievement.iconGray
    : achievement.iconGray || achievement.icon;
  const secondary = unlocked
    ? achievement.iconGray || achievement.icon
    : achievement.icon || achievement.iconGray;
  const normalizedPrimary = normalizeAchievementImageSource(primary);
  const normalizedSecondary = normalizeAchievementImageSource(secondary);
  const ordered = [
    normalizedPrimary,
    normalizedSecondary,
    primary?.trim(),
    secondary?.trim(),
  ].filter((source): source is string => Boolean(source?.trim()));
  return [...new Set(ordered)];
}

function calculateAchievementStats(achievementList: SteamAchievement[]) {
  const unlocked = achievementList.filter(isAchievementUnlocked).length;
  const total = achievementList.length;

  return {
    unlocked,
    total,
    progress: total > 0 ? Math.round((unlocked / total) * 100) : 0,
  };
}

function buildSteamAchievementList(
  summary: SteamGameAchievementSummary | undefined,
): SteamAchievement[] {
  return (summary?.achievements ?? []).map((achievement) => ({
    name: achievement.name,
    title: achievement.title || achievement.name,
    description: achievement.description || "",
    icon: normalizeAchievementImageSource(
      achievement.icon || achievement.iconGray || ""
    ),
    iconGray: normalizeAchievementImageSource(
      achievement.iconGray || achievement.icon || ""
    ),
    unlocked: achievement.unlocked,
    unlockedAt: isoFromUnixSeconds(achievement.unlockedAt),
    globalPercent:
      typeof achievement.globalPercent === "number" && Number.isFinite(achievement.globalPercent)
        ? achievement.globalPercent
        : undefined,
  }));
}

export function buildSteamAchievementIndex(
  stats: SteamAccountStats | null | undefined,
): SteamAchievementIndex {
  if (!stats?.achievements?.length) return new Map();

  const cached = steamAchievementIndexCache.get(stats);
  if (cached) return cached;

  const index = new Map<string, SteamAchievement[]>();
  for (const summary of stats.achievements) {
    // Preserve the existing find() semantics when malformed payloads contain
    // more than one summary for the same app.
    if (index.has(summary.appId)) continue;
    index.set(summary.appId, buildSteamAchievementList(summary));
  }

  steamAchievementIndexCache.set(stats, index);
  return index;
}

function mergeAchievementLists(
  baseList: SteamAchievement[] = [],
  incomingList: SteamAchievement[] = [],
) {
  if (baseList.length === 0) return incomingList;
  if (incomingList.length === 0) return baseList;

  const merged = new Map<string, SteamAchievement>();
  const append = (achievement: SteamAchievement) => {
    const key = normalizeKey(achievement.name || achievement.title);
    if (!key) return;

    const current = merged.get(key);
    if (!current) {
      merged.set(key, achievement);
      return;
    }

    merged.set(key, {
      ...current,
      title: current.title || achievement.title,
      description: current.description || achievement.description,
      icon: normalizeAchievementImageSource(current.icon || achievement.icon),
      iconGray: normalizeAchievementImageSource(
        current.iconGray || achievement.iconGray
      ),
      unlocked: current.unlocked === true || achievement.unlocked === true,
      unlockedAt: current.unlockedAt || achievement.unlockedAt,
      globalPercent: current.globalPercent ?? achievement.globalPercent,
    });
  };

  baseList.forEach(append);
  incomingList.forEach(append);

  return [...merged.values()];
}

export function mergeAchievementDetailsIntoGame(
  game: GhostBoxGame,
  incoming: Pick<GhostBoxGame, "achievements" | "achievementList">,
): GhostBoxGame {
  const achievementList = mergeAchievementLists(game.achievementList, incoming.achievementList);
  const calculated = calculateAchievementStats(achievementList);
  const fallbackUnlocked = Math.max(
    game.achievements?.unlocked ?? 0,
    incoming.achievements?.unlocked ?? 0,
  );
  const fallbackTotal = Math.max(
    game.achievements?.total ?? 0,
    incoming.achievements?.total ?? 0,
    fallbackUnlocked,
  );
  // O schema local pode chegar sem os flags pessoais. Preserve o resumo da
  // conta como piso até a lista de desbloqueios ser sincronizada.
  const unlocked = Math.max(calculated.unlocked, fallbackUnlocked);
  const total = Math.max(calculated.total, fallbackTotal, unlocked);
  const achievements = {
    unlocked,
    total,
    progress: total > 0 ? Math.round((unlocked / total) * 100) : 0,
  };

  return {
    ...game,
    achievements,
    achievementList,
  };
}

export function mergeSteamAchievementsIntoGame(
  game: GhostBoxGame,
  stats: SteamAccountStats | null | undefined,
  achievementIndex?: SteamAchievementIndex,
): GhostBoxGame {
  const index = achievementIndex ?? buildSteamAchievementIndex(stats);
  const achievementList = index.get(game.appId);
  if (!achievementList?.length) return game;

  const remoteGame: Pick<GhostBoxGame, "achievements" | "achievementList"> = {
    achievements: calculateAchievementStats(achievementList),
    achievementList,
  };

  return mergeAchievementDetailsIntoGame(game, remoteGame);
}

export function mergeSteamAchievementsIntoGames(
  games: GhostBoxGame[],
  stats: SteamAccountStats | null | undefined,
  achievementIndex?: SteamAchievementIndex,
) {
  const index = achievementIndex ?? buildSteamAchievementIndex(stats);
  if (index.size === 0) return games;
  return games.map((game) =>
    mergeSteamAchievementsIntoGame(game, stats, index),
  );
}

function gameMatchesAppId(
  game: GhostBoxGame,
  appId: string,
  id: string,
) {
  if (appId && game.appId === appId) return true;
  return Boolean(id) && game.id === id;
}

/**
 * Aplica detalhes de conquistas recém-carregados (hover da capa, mesma fusão
 * por união do modal) às listas que guardam cópias do jogo. Devolve a mesma
 * referência quando nada casa, para não provocar re-render à toa.
 */
export function applyAchievementDetailsToGames(
  games: GhostBoxGame[],
  details: Pick<GhostBoxGame, "appId" | "id" | "achievements" | "achievementList">,
): GhostBoxGame[] {
  const appId = details.appId?.trim() ?? "";
  const id = details.id?.trim() ?? "";
  if (!appId && !id) return games;
  if (
    (details.achievementList?.length ?? 0) === 0 &&
    (details.achievements?.total ?? 0) === 0
  ) {
    return games;
  }

  let changed = false;
  const next = games.map((game) => {
    if (!gameMatchesAppId(game, appId, id)) return game;
    changed = true;
    return mergeAchievementDetailsIntoGame(game, details);
  });
  return changed ? next : games;
}
