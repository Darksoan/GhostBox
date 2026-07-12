import type { GhostBoxGame, SteamAchievement } from "../data";
import { isSteamTitlePlaceholder } from "./steamTitles";

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

function preferProfileGameTitle(
  current: GhostBoxGame,
  incoming: GhostBoxGame,
  richer: GhostBoxGame
) {
  if (isSteamTitlePlaceholder(richer.title, richer.appId)) {
    if (!isSteamTitlePlaceholder(current.title, current.appId)) return current.title;
    if (!isSteamTitlePlaceholder(incoming.title, incoming.appId)) return incoming.title;
  }

  return richer.title;
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

  let richer: GhostBoxGame;

  if (incomingTotal > currentTotal) richer = incoming;
  else if (incomingTotal < currentTotal) richer = current;
  else if (incomingUnlocked > currentUnlocked) richer = incoming;
  else if (incomingUnlocked < currentUnlocked) richer = current;
  else {
    richer = (incoming.achievementList?.length ?? 0) >=
      (current.achievementList?.length ?? 0)
      ? incoming
      : current;
  }

  return {
    ...richer,
    title: preferProfileGameTitle(current, incoming, richer),
  };
}
