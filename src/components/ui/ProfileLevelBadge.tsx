import type { CSSProperties } from "react";
import type { PirateGame, SteamAchievement } from "../../data";

type ProfileLevelBadgeProps = {
  level: number;
  progressPercent: number;
  label: string;
};

type ProfileXpStats = {
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
};

const baseLevelXp = 100;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getLevelRequiredXp(level: number) {
  return baseLevelXp * Math.max(1, level);
}

export function isProfileAchievementUnlocked(achievement: SteamAchievement) {
  return achievement.unlocked === true;
}

export function getProfileAchievementXp(achievement: SteamAchievement) {
  const rarity = achievement.globalPercent;

  if (typeof rarity !== "number" || !Number.isFinite(rarity)) return 10;
  if (rarity <= 5) return 50;
  if (rarity <= 15) return 30;
  if (rarity <= 35) return 20;
  return 10;
}

export function getProfileUnlockedAchievementCount(game: PirateGame) {
  const explicitUnlocked = (game.achievementList ?? []).filter(
    isProfileAchievementUnlocked
  ).length;

  return Math.max(explicitUnlocked, game.achievements?.unlocked ?? 0);
}

export function getProfileAchievementTotal(game: PirateGame) {
  return Math.max(
    game.achievementList?.length ?? 0,
    game.achievements?.total ?? 0,
    getProfileUnlockedAchievementCount(game)
  );
}

export function getRicherProfileAchievementGame(
  current: PirateGame | undefined,
  incoming: PirateGame
) {
  if (!current) return incoming;

  const currentTotal = getProfileAchievementTotal(current);
  const incomingTotal = getProfileAchievementTotal(incoming);
  const currentUnlocked = getProfileUnlockedAchievementCount(current);
  const incomingUnlocked = getProfileUnlockedAchievementCount(incoming);

  if (incomingTotal > currentTotal) return incoming;
  if (incomingTotal < currentTotal) return current;
  if (incomingUnlocked > currentUnlocked) return incoming;
  if (incomingUnlocked < currentUnlocked) return current;

  return (incoming.achievementList?.length ?? 0) >=
    (current.achievementList?.length ?? 0)
    ? incoming
    : current;
}

export function getProfileXpStats(games: PirateGame[]): ProfileXpStats {
  const xp = games.reduce((total, game) => {
    return total + (game.achievementList ?? []).reduce((gameTotal, achievement) => {
      if (!isProfileAchievementUnlocked(achievement)) return gameTotal;
      return gameTotal + getProfileAchievementXp(achievement);
    }, 0);
  }, 0);

  let remainingXp = xp;
  let level = 1;
  let nextLevelXp = getLevelRequiredXp(level);

  while (remainingXp >= nextLevelXp) {
    remainingXp -= nextLevelXp;
    level += 1;
    nextLevelXp = getLevelRequiredXp(level);
  }

  return {
    xp,
    level,
    currentLevelXp: remainingXp,
    nextLevelXp,
    progressPercent: clampPercent((remainingXp / nextLevelXp) * 100),
  };
}

export function ProfileLevelBadge({
  level,
  progressPercent,
  label,
}: ProfileLevelBadgeProps) {
  const safeProgress = clampPercent(progressPercent);

  return (
    <span
      className="profile-level-badge"
      title={label}
      aria-label={label}
      style={{ "--profile-level-progress": `${safeProgress}%` } as CSSProperties}
    >
      <span className="profile-level-badge__ring" aria-hidden="true" />
      <span className="profile-level-badge__value">{level}</span>
    </span>
  );
}
