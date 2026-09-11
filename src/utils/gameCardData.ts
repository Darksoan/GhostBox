import type { GhostBoxGame } from "../data";
import { getRicherAchievementGame } from "./achievementStats";
import { isSteamTitlePlaceholder } from "./steamTitles";

function preferString(primary: string | undefined, fallback: string) {
  return primary?.trim() ? primary : fallback;
}

function preferArray(primary: string[] | undefined, fallback: string[]) {
  return primary?.length ? primary : fallback;
}

function preferOptionalString(
  primary: string | undefined,
  fallback: string | undefined,
) {
  if (primary?.trim()) return primary;
  return fallback;
}

function preferOptionalStrings(
  primary: string[] | undefined,
  fallback: string[] | undefined,
) {
  if (primary?.length) return primary;
  return fallback;
}

function preferControllerSupport(
  primary: GhostBoxGame["controllerSupport"],
  fallback: GhostBoxGame["controllerSupport"],
) {
  if (primary === "full" || primary === "partial") return primary;
  if (fallback === "full" || fallback === "partial") return fallback;
  return primary ?? fallback;
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
    movies: details.movies?.length ? details.movies : game.movies,
    shortDescription:
      preferOptionalString(details.shortDescription, game.shortDescription) ??
      details.shortDescription,
    aboutTheGame:
      preferOptionalString(details.aboutTheGame, game.aboutTheGame) ??
      details.aboutTheGame,
    pcRequirements:
      details.pcRequirements?.minimum.length ||
      details.pcRequirements?.recommended.length
        ? {
            minimum: details.pcRequirements?.minimum.length
              ? details.pcRequirements.minimum
              : (game.pcRequirements?.minimum ?? []),
            recommended: details.pcRequirements?.recommended.length
              ? details.pcRequirements.recommended
              : (game.pcRequirements?.recommended ?? []),
          }
        : game.pcRequirements,
    controllerSupport: preferControllerSupport(
      details.controllerSupport,
      game.controllerSupport,
    ),
    supportedLanguages:
      preferOptionalString(
        details.supportedLanguages,
        game.supportedLanguages,
      ) ?? details.supportedLanguages,
    tags: preferOptionalStrings(details.tags, game.tags) ?? details.tags,
    genres: preferOptionalStrings(details.genres, game.genres) ?? details.genres,
    developers:
      preferOptionalStrings(details.developers, game.developers) ??
      details.developers,
    publishers:
      preferOptionalStrings(details.publishers, game.publishers) ??
      details.publishers,
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
