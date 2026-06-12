import type { PirateGame } from "../data";

function getUnlockedAchievementCount(game: PirateGame) {
  const explicitUnlocked = (game.achievementList ?? []).filter(
    (achievement) => achievement.unlocked === true
  ).length;

  return Math.max(explicitUnlocked, game.achievements?.unlocked ?? 0);
}

function getAchievementTotal(game: PirateGame) {
  return Math.max(
    game.achievementList?.length ?? 0,
    game.achievements?.total ?? 0,
    getUnlockedAchievementCount(game)
  );
}

function getRicherAchievementGame(current: PirateGame, incoming: PirateGame) {
  const currentTotal = getAchievementTotal(current);
  const incomingTotal = getAchievementTotal(incoming);
  const currentUnlocked = getUnlockedAchievementCount(current);
  const incomingUnlocked = getUnlockedAchievementCount(incoming);

  if (incomingTotal > currentTotal) return incoming;
  if (incomingTotal < currentTotal) return current;
  if (incomingUnlocked > currentUnlocked) return incoming;
  if (incomingUnlocked < currentUnlocked) return current;

  return (incoming.achievementList?.length ?? 0) >=
    (current.achievementList?.length ?? 0)
    ? incoming
    : current;
}

function preferString(primary: string | undefined, fallback: string) {
  return primary?.trim() ? primary : fallback;
}

function preferArray(primary: string[] | undefined, fallback: string[]) {
  return primary?.length ? primary : fallback;
}

export function mergeGameCardData(game: PirateGame, details: PirateGame) {
  const richerAchievementGame = getRicherAchievementGame(game, details);
  const gamePlaytime = game.playTimeInMilliseconds ?? 0;
  const detailsPlaytime = details.playTimeInMilliseconds ?? 0;
  const isPlaceholderTitle = /^Steam \d+$/.test(details.title);

  return {
    ...game,
    ...details,
    title: isPlaceholderTitle && game.title ? game.title : details.title || game.title,
    cover: preferString(details.cover, game.cover),
    hero: preferString(details.hero, game.hero),
    coverUrl: preferString(details.coverUrl, game.coverUrl),
    heroUrl: preferString(details.heroUrl, game.heroUrl),
    coverFallbacks: preferArray(details.coverFallbacks, game.coverFallbacks),
    heroFallbacks: preferArray(details.heroFallbacks, game.heroFallbacks),
    logo: preferString(details.logo, game.logo),
    screenshots: preferArray(details.screenshots, game.screenshots),
    achievements: richerAchievementGame.achievements,
    achievementList: richerAchievementGame.achievementList,
    playTimeInMilliseconds:
      detailsPlaytime > gamePlaytime
        ? details.playTimeInMilliseconds
        : game.playTimeInMilliseconds ?? details.playTimeInMilliseconds,
    hours: Math.max(game.hours, details.hours),
    lastTimePlayed: game.lastTimePlayed ?? details.lastTimePlayed,
  };
}
