import type { GhostBoxGame } from "../data";
import { getRicherAchievementGame } from "./achievementStats";
import { isSteamTitlePlaceholder } from "./steamTitles";

function preferString(primary: string | undefined, fallback: string) {
  return primary?.trim() ? primary : fallback;
}

function preferArray(primary: string[] | undefined, fallback: string[]) {
  return primary?.length ? primary : fallback;
}

export function mergeGameCardData(game: GhostBoxGame, details: GhostBoxGame) {
  const richerAchievementGame = getRicherAchievementGame(game, details);
  const gamePlaytime = game.playTimeInMilliseconds ?? 0;
  const detailsPlaytime = details.playTimeInMilliseconds ?? 0;
  const detailsTitleIsPlaceholder = isSteamTitlePlaceholder(
    details.title,
    details.appId || game.appId
  );
  const gameTitleIsPlaceholder = isSteamTitlePlaceholder(game.title, game.appId);
  const mergedTitle = detailsTitleIsPlaceholder
    ? !gameTitleIsPlaceholder && game.title
      ? game.title
      : details.title || game.title
    : details.title || game.title;

  return {
    ...game,
    ...details,
    title: mergedTitle,
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
    // Prefer the higher Steam/synced total already on the game; do not adopt
    // catalogue/details playtime (not personal Steam playtime_forever).
    playTimeInMilliseconds:
      gamePlaytime > 0
        ? game.playTimeInMilliseconds
        : detailsPlaytime > 0
          ? details.playTimeInMilliseconds
          : game.playTimeInMilliseconds ?? details.playTimeInMilliseconds,
    hours: Math.max(game.hours, details.hours),
    lastTimePlayed: game.lastTimePlayed ?? details.lastTimePlayed,
  };
}
