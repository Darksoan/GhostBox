import type { GhostBoxGame } from "../data";
import type { BackupDetails, BackupSettings } from "../types";
import type { SteamAchievement } from "../data";
import {
  getUnlockedAchievementCount,
  isAchievementUnlocked,
} from "../utils/achievementStats";
import { isSteamTitlePlaceholder, normalizeSteamGameTitle } from "../utils/steamTitles";

function normalizeAchievementKey(value: string) {
  return value.trim().toLowerCase();
}

export function upsertProfileHistoryGame(
  games: GhostBoxGame[],
  nextGame: GhostBoxGame
) {
  const existingGame = games.find((game) => game.appId === nextGame.appId);
  const normalizedNextGame = existingGame
    ? normalizeSteamGameTitle(
        mergeGameDetailsPreservingAchievements(existingGame, nextGame),
        [existingGame]
      )
    : nextGame;

  return [
    normalizedNextGame,
    ...games.filter((game) => game.appId !== nextGame.appId),
  ].slice(0, 50);
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

function countUnlockedAchievements(game: GhostBoxGame | undefined) {
  if (!game) return 0;
  return getUnlockedAchievementCount(game);
}

function preferNonEmptyString(
  incoming: string | undefined,
  current: string | undefined,
): string | undefined {
  if (incoming?.trim()) return incoming;
  return current;
}

function preferNonEmptyStrings(
  incoming: string[] | undefined,
  current: string[] | undefined,
): string[] | undefined {
  if (incoming?.length) return incoming;
  return current;
}

function preferNonEmptyMovies(
  incoming: GhostBoxGame["movies"],
  current: GhostBoxGame["movies"],
): GhostBoxGame["movies"] {
  if (incoming?.length) return incoming;
  return current;
}

function mergeRequirementsPreserving(
  current: GhostBoxGame["pcRequirements"],
  incoming: GhostBoxGame["pcRequirements"],
): GhostBoxGame["pcRequirements"] {
  const incomingMin = incoming?.minimum ?? [];
  const incomingRec = incoming?.recommended ?? [];
  if (!incomingMin.length && !incomingRec.length) return current;
  const currentMin = current?.minimum ?? [];
  const currentRec = current?.recommended ?? [];
  return {
    minimum: incomingMin.length ? incomingMin : currentMin,
    recommended: incomingRec.length ? incomingRec : currentRec,
  };
}

function mergeControllerSupportPreserving(
  current: GhostBoxGame["controllerSupport"],
  incoming: GhostBoxGame["controllerSupport"],
): GhostBoxGame["controllerSupport"] {
  if (incoming === "full" || incoming === "partial") return incoming;
  if (current === "full" || current === "partial") return current;
  return incoming ?? current;
}

function preferNumberPreserving(
  incoming: number | undefined,
  current: number | undefined,
): number | undefined {
  if (typeof incoming !== "number" || !Number.isFinite(incoming)) return current;
  if (incoming === 0 && typeof current === "number" && current !== 0) return current;
  return incoming;
}

export function mergeGameDetailsPreservingAchievements(
  game: GhostBoxGame,
  details: GhostBoxGame
): GhostBoxGame {
  const isPlaceholderTitle = isSteamTitlePlaceholder(details.title, details.appId);
  // Prefer the payload with the richer list. Catalogue/store often has
  // achievements.total > 0 with an empty achievementList — that must never
  // wipe a previously loaded full list (e.g. DayZ appears then disappears).
  const gameListLength = game.achievementList?.length ?? 0;
  const detailsListLength = details.achievementList?.length ?? 0;
  const gameUnlocked = countUnlockedAchievements(game);
  const detailsUnlocked = countUnlockedAchievements(details);
  const preferDetailsList =
    detailsListLength > gameListLength ||
    (detailsListLength === gameListLength &&
      detailsListLength > 0 &&
      detailsUnlocked > gameUnlocked);

  const achievementList = preferDetailsList
    ? (details.achievementList ?? [])
    : (game.achievementList ?? []);
  const unlocked = Math.max(
    gameUnlocked,
    detailsUnlocked,
    achievementList.filter(isAchievementUnlocked).length
  );
  const total = Math.max(
    game.achievements?.total ?? 0,
    details.achievements?.total ?? 0,
    achievementList.length,
    unlocked
  );

  return {
    ...game,
    ...details,
    title: isPlaceholderTitle && game.title ? game.title : details.title,
    cover: preferNonEmptyString(details.cover, game.cover) ?? details.cover,
    hero: preferNonEmptyString(details.hero, game.hero) ?? details.hero,
    coverUrl: preferNonEmptyString(details.coverUrl, game.coverUrl) ?? details.coverUrl,
    heroUrl: preferNonEmptyString(details.heroUrl, game.heroUrl) ?? details.heroUrl,
    logo: preferNonEmptyString(details.logo, game.logo) ?? details.logo,
    coverFallbacks:
      preferNonEmptyStrings(details.coverFallbacks, game.coverFallbacks) ??
      details.coverFallbacks,
    heroFallbacks:
      preferNonEmptyStrings(details.heroFallbacks, game.heroFallbacks) ??
      details.heroFallbacks,
    screenshots:
      preferNonEmptyStrings(details.screenshots, game.screenshots) ??
      details.screenshots,
    movies: preferNonEmptyMovies(details.movies, game.movies),
    shortDescription:
      preferNonEmptyString(details.shortDescription, game.shortDescription) ??
      details.shortDescription,
    aboutTheGame:
      preferNonEmptyString(details.aboutTheGame, game.aboutTheGame) ??
      details.aboutTheGame,
    pcRequirements: mergeRequirementsPreserving(
      game.pcRequirements,
      details.pcRequirements,
    ),
    controllerSupport: mergeControllerSupportPreserving(
      game.controllerSupport,
      details.controllerSupport,
    ),
    supportedLanguages:
      preferNonEmptyString(details.supportedLanguages, game.supportedLanguages) ??
      details.supportedLanguages,
    tags:
      preferNonEmptyStrings(details.tags, game.tags) ?? details.tags,
    genres:
      preferNonEmptyStrings(details.genres, game.genres) ?? details.genres,
    developers:
      preferNonEmptyStrings(details.developers, game.developers) ??
      details.developers,
    publishers:
      preferNonEmptyStrings(details.publishers, game.publishers) ??
      details.publishers,
    steamReviewCount:
      preferNumberPreserving(details.steamReviewCount, game.steamReviewCount) ??
      details.steamReviewCount,
    steamPositiveRatio:
      preferNumberPreserving(details.steamPositiveRatio, game.steamPositiveRatio) ??
      details.steamPositiveRatio,
    metacriticScore:
      preferNumberPreserving(details.metacriticScore, game.metacriticScore) ??
      details.metacriticScore,
    recommendations:
      preferNumberPreserving(details.recommendations, game.recommendations) ??
      details.recommendations,
    playingNow:
      preferNumberPreserving(details.playingNow, game.playingNow) ??
      details.playingNow,
    ownersEstimate:
      preferNumberPreserving(details.ownersEstimate, game.ownersEstimate) ??
      details.ownersEstimate,
    popularityScore:
      preferNumberPreserving(details.popularityScore, game.popularityScore) ??
      details.popularityScore,
    popularityRank:
      preferNumberPreserving(details.popularityRank, game.popularityRank) ??
      details.popularityRank,
    rankingScore:
      preferNumberPreserving(details.rankingScore, game.rankingScore) ??
      details.rankingScore,
    rankingTier:
      preferNumberPreserving(details.rankingTier, game.rankingTier) ??
      details.rankingTier,
    achievements: {
      unlocked,
      total,
      progress: total > 0 ? Math.round((unlocked / total) * 100) : 0,
    },
    achievementList,
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

/**
 * Backup dates double as "last activity" for games with no local play history:
 * a fresh install (or a machine that only holds the cloud save) would
 * otherwise show a game with no last-played date at all.
 */
export function withBackupRecordLastPlayed(
  game: GhostBoxGame,
  record: BackupSettings["backupRecords"][string]
): GhostBoxGame {
  if (game.lastTimePlayed) return game;
  const lastBackupAt = record.entries?.[0]?.backupAt ?? record.lastBackupAt;
  if (!lastBackupAt) return game;
  return { ...game, lastTimePlayed: lastBackupAt };
}
