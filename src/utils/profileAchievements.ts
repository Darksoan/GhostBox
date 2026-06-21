import type { GhostBoxGame, SteamAchievement } from "../data";

export function isProfileAchievementUnlocked(achievement: SteamAchievement) {
  return achievement.unlocked === true;
}

export function getProfileUnlockedAchievementCount(game: GhostBoxGame) {
  const explicitUnlocked = (game.achievementList ?? []).filter(
    isProfileAchievementUnlocked
  ).length;

  return Math.max(explicitUnlocked, game.achievements?.unlocked ?? 0);
}

export function getProfileAchievementTotal(game: GhostBoxGame) {
  return Math.max(
    game.achievementList?.length ?? 0,
    game.achievements?.total ?? 0,
    getProfileUnlockedAchievementCount(game)
  );
}

export function getRicherProfileAchievementGame(
  current: GhostBoxGame | undefined,
  incoming: GhostBoxGame
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
