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

function calculateAchievementStats(achievementList: SteamAchievement[]) {
  const unlocked = achievementList.filter(isAchievementUnlocked).length;
  const total = achievementList.length;

  return {
    unlocked,
    total,
    progress: total > 0 ? Math.round((unlocked / total) * 100) : 0,
  };
}

export function buildSteamAchievementList(
  summary: SteamGameAchievementSummary | undefined,
): SteamAchievement[] {
  return (summary?.achievements ?? []).map((achievement) => ({
    name: achievement.name,
    title: achievement.title || achievement.name,
    description: achievement.description || "",
    icon: achievement.icon || achievement.iconGray || "",
    iconGray: achievement.iconGray || achievement.icon || "",
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

export function mergeAchievementLists(
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
      icon: current.icon || achievement.icon,
      iconGray: current.iconGray || achievement.iconGray,
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
  const achievements = achievementList.length > 0
    ? calculated
    : {
        unlocked: fallbackUnlocked,
        total: fallbackTotal,
        progress: fallbackTotal > 0 ? Math.round((fallbackUnlocked / fallbackTotal) * 100) : 0,
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
