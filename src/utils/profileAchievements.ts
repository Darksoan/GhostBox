import type { GhostBoxGame, SteamAchievement } from "../data";
import { isSteamTitlePlaceholder } from "./steamTitles";

export function isProfileAchievementUnlocked(achievement: SteamAchievement) {
  return achievement.unlocked === true;
}

export function getProfileUnlockedAchievementCount(game: GhostBoxGame) {
  let explicitUnlocked = 0;
  for (const achievement of game.achievementList ?? []) {
    if (isProfileAchievementUnlocked(achievement)) explicitUnlocked += 1;
  }

  return Math.max(explicitUnlocked, game.achievements?.unlocked ?? 0);
}

export function getProfileAchievementTotal(game: GhostBoxGame) {
  return Math.max(
    game.achievementList?.length ?? 0,
    game.achievements?.total ?? 0,
    getProfileUnlockedAchievementCount(game)
  );
}

const steamSoftwareLabelMarkers = [
  "software",
  "utilities",
  "utilitários",
  "utilitarios",
  "animation & modeling",
  "animação e modelagem",
  "animacao e modelagem",
  "video production",
  "produção de vídeo",
  "producao de video",
  "design & illustration",
  "web publishing",
  "education",
  "educação",
  "educacao",
  "accounting",
  "photo editing",
  "audio production",
  "game development",
  "desenvolvimento de jogos",
];

export function isSteamSoftwareLikeGame(game: GhostBoxGame) {
  const labels = [...(game.genres ?? []), ...(game.tags ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (labels.length === 0) return false;

  return labels.some((label) =>
    steamSoftwareLabelMarkers.some(
      (marker) => label === marker || label.includes(marker),
    ),
  );
}

/** Steam profile recognition: playtime + unlocked achievements, never software. */
export function isRecognizedSteamProfileGame(
  game: GhostBoxGame,
  playtimeInMilliseconds: number,
) {
  if (playtimeInMilliseconds <= 0) return false;
  // Require at least one unlocked achievement — total-only (e.g. 0 of 53) is not enough.
  if (getProfileUnlockedAchievementCount(game) <= 0) return false;
  if (isSteamSoftwareLikeGame(game)) return false;
  return true;
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
