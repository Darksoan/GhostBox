import type { GhostBoxGame, SteamAchievement } from "../data";
import { isSteamTitlePlaceholder } from "./steamTitles";

/**
 * Single source of truth for "is this achievement unlocked?".
 *
 * Lenient on purpose: a persisted `unlockedAt` is proof of an unlock even when the
 * boolean was never written. Older cache entries and backup payloads produce exactly
 * that shape, and the strict reading made those games lose achievements — enough to
 * drop them from the profile entirely via `isRecognizedSteamProfileGame`.
 */
export function isAchievementUnlocked(achievement: SteamAchievement) {
  return achievement.unlocked === true || Boolean(achievement.unlockedAt);
}

export function getUnlockedAchievementCount(game: GhostBoxGame) {
  let explicitUnlocked = 0;
  for (const achievement of game.achievementList ?? []) {
    if (isAchievementUnlocked(achievement)) explicitUnlocked += 1;
  }

  // The account-level summary can know about unlocks the list has not been hydrated
  // with yet, so it sets the floor rather than being overwritten.
  return Math.max(explicitUnlocked, game.achievements?.unlocked ?? 0);
}

export function getAchievementTotal(game: GhostBoxGame) {
  return Math.max(
    game.achievementList?.length ?? 0,
    game.achievements?.total ?? 0,
    getUnlockedAchievementCount(game),
  );
}

type RicherAchievementGameOptions = {
  /**
   * Carry a real title over from the losing side when the richer game only has a
   * placeholder like "STEAM APP 242760". Off by default: the card merge in
   * `gameCardData` depends on getting the winning object back by reference.
   */
  preferNonPlaceholderTitle?: boolean;
};

function preferNonPlaceholderTitleOf(
  current: GhostBoxGame,
  incoming: GhostBoxGame,
  richer: GhostBoxGame,
) {
  if (!isSteamTitlePlaceholder(richer.title, richer.appId)) return richer.title;
  if (!isSteamTitlePlaceholder(current.title, current.appId)) return current.title;
  if (!isSteamTitlePlaceholder(incoming.title, incoming.appId)) return incoming.title;
  return richer.title;
}

/**
 * Pick whichever of the two carries more achievement data. Ties fall through to the
 * longer `achievementList`, and a full tie favours `incoming` so later payloads win.
 */
export function getRicherAchievementGame(
  current: GhostBoxGame | undefined,
  incoming: GhostBoxGame,
  options: RicherAchievementGameOptions = {},
): GhostBoxGame {
  if (!current) return incoming;

  const currentTotal = getAchievementTotal(current);
  const incomingTotal = getAchievementTotal(incoming);
  const currentUnlocked = getUnlockedAchievementCount(current);
  const incomingUnlocked = getUnlockedAchievementCount(incoming);

  let richer: GhostBoxGame;

  if (incomingTotal > currentTotal) richer = incoming;
  else if (incomingTotal < currentTotal) richer = current;
  else if (incomingUnlocked > currentUnlocked) richer = incoming;
  else if (incomingUnlocked < currentUnlocked) richer = current;
  else {
    richer =
      (incoming.achievementList?.length ?? 0) >= (current.achievementList?.length ?? 0)
        ? incoming
        : current;
  }

  if (!options.preferNonPlaceholderTitle) return richer;

  const title = preferNonPlaceholderTitleOf(current, incoming, richer);
  return title === richer.title ? richer : { ...richer, title };
}
