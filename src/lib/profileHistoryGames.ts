import type { GhostBoxGame } from "../data";
import type { BackupDetails, BackupSettings } from "../types";
import type { SteamAchievement } from "../data";

function normalizeAchievementKey(value: string) {
  return value.trim().toLowerCase();
}

function isPlaceholderGameTitle(title: string | undefined) {
  return /^Steam(?: App)? \d+$/i.test(title?.trim() ?? "");
}

export function upsertProfileHistoryGame(
  games: GhostBoxGame[],
  nextGame: GhostBoxGame
) {
  return [
    nextGame,
    ...games.filter((game) => game.appId !== nextGame.appId),
  ].slice(0, 50);
}

export function removeProfileHistoryGameByAppId(
  games: GhostBoxGame[],
  appId: string
) {
  return games.filter((game) => game.appId !== appId);
}

export function getBackupRecordLatestKey(
  record: BackupSettings["backupRecords"][string]
) {
  const latestEntry = record.entries?.[0];
  return [
    latestEntry?.path ?? record.lastBackupPath ?? "",
    latestEntry?.backupAt ?? record.lastBackupAt ?? "",
    record.lastBackupSuccess ? "ok" : "failed",
  ].join("|");
}

export function countUnlockedAchievements(game: GhostBoxGame | undefined) {
  if (!game) return 0;

  const explicitUnlocked = (game.achievementList ?? []).filter(
    (achievement) =>
      achievement.unlocked === true || Boolean(achievement.unlockedAt)
  ).length;

  return Math.max(explicitUnlocked, game.achievements.unlocked);
}

export function mergeGameDetailsPreservingAchievements(
  game: GhostBoxGame,
  details: GhostBoxGame
): GhostBoxGame {
  const isPlaceholderTitle = isPlaceholderGameTitle(details.title);
  const hasAchievementDetails =
    details.achievements.total > 0 || (details.achievementList ?? []).length > 0;

  const achievementGame = hasAchievementDetails
    ? {
        ...game,
        achievements: details.achievements,
        achievementList: details.achievementList ?? [],
      }
    : game;

  return {
    ...game,
    ...details,
    title: isPlaceholderTitle && game.title ? game.title : details.title,
    achievements: achievementGame.achievements,
    achievementList: achievementGame.achievementList,
    // Playtime comes only from the live Steam snapshot merge — never cache it
    // from catalogue/details payloads.
    playTimeInMilliseconds: game.playTimeInMilliseconds,
    lastTimePlayed: game.lastTimePlayed ?? details.lastTimePlayed,
  };
}

export function mergeBackupAchievementsIntoGame(
  game: GhostBoxGame,
  backupDetails: BackupDetails | null
): GhostBoxGame {
  const backupAchievements = backupDetails?.achievements ?? [];
  if (!backupAchievements.length) return game;

  const achievementList = [...(game.achievementList ?? [])];
  const achievementIndexes = new Map<string, number>();
  achievementList.forEach((achievement, index) => {
    if (achievement.name) {
      achievementIndexes.set(normalizeAchievementKey(achievement.name), index);
    }
    if (achievement.title) {
      achievementIndexes.set(normalizeAchievementKey(achievement.title), index);
    }
  });

  for (const backupAchievement of backupAchievements) {
    const nameKey = normalizeAchievementKey(backupAchievement.name);
    const titleKey = normalizeAchievementKey(backupAchievement.title);
    const index = achievementIndexes.get(nameKey) ?? achievementIndexes.get(titleKey);
    const fallbackAchievement: SteamAchievement = {
      name: backupAchievement.name,
      title: backupAchievement.title || backupAchievement.name,
      description: "",
      icon: backupAchievement.icon ?? "",
      iconGray: backupAchievement.iconGray ?? backupAchievement.icon ?? "",
      unlocked: true,
      unlockedAt: backupAchievement.unlockedAt,
    };

    if (index === undefined) {
      achievementIndexes.set(nameKey, achievementList.length);
      if (titleKey) {
        achievementIndexes.set(titleKey, achievementList.length);
      }
      achievementList.push(fallbackAchievement);
      continue;
    }

    const existingAchievement = achievementList[index];
    achievementList[index] = {
      ...existingAchievement,
      title: existingAchievement.title || fallbackAchievement.title,
      icon: existingAchievement.icon || fallbackAchievement.icon,
      iconGray: existingAchievement.iconGray || fallbackAchievement.iconGray,
      unlocked: true,
      unlockedAt: existingAchievement.unlockedAt || backupAchievement.unlockedAt,
    };
  }

  const unlocked = Math.max(
    countUnlockedAchievements({ ...game, achievementList }),
    backupAchievements.length
  );
  const total = Math.max(game.achievements.total, achievementList.length, unlocked);

  return {
    ...game,
    achievements: {
      unlocked,
      total,
      progress: total ? Math.round((unlocked / total) * 100) : 0,
    },
    achievementList,
  };
}

export function createProfileHistoryFallbackGame(
  appId: string,
  title: string
): GhostBoxGame {
  const headerImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
  const heroImage = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`;

  return {
    appId,
    id: `steam-${appId}`,
    title,
    subtitle: "Steam",
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: "Steam",
    progress: 0,
    accent: "#ff2d35",
    cover: headerImage,
    hero: heroImage,
    coverUrl: headerImage,
    heroUrl: heroImage,
    coverFallbacks: [headerImage],
    heroFallbacks: [heroImage, headerImage],
    logo: "",
    tags: [],
    genres: [],
    screenshots: [],
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    pcRequirements: { minimum: [], recommended: [] },
  };
}
