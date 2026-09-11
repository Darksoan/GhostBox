import type { GhostBoxGame } from "../data";
import { getUnlockedAchievementCount } from "./achievementStats";

export type HiddenProfileGameOption = {
  appId: string;
  title: string;
};

export function hasHiddenProfileGameEvidence(
  game: GhostBoxGame,
  backupGameIds: ReadonlySet<string>,
  personalMetricGameIds: ReadonlySet<string> = new Set(),
) {
  const appId = game.appId.trim();
  if (!appId) return false;

  return backupGameIds.has(appId) ||
    personalMetricGameIds.has(appId) ||
    (game.playTimeInMilliseconds ?? 0) > 0 ||
    (game.lastSessionDurationInMilliseconds ?? 0) > 0 ||
    game.sessionActive === true ||
    Boolean(game.lastTimePlayed || game.lastSessionRecordedAt) ||
    getUnlockedAchievementCount(game) > 0;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function getHiddenProfileGameInitial(title: string) {
  const initial = normalizeSearchText(title).charAt(0).toLocaleUpperCase();
  return /^[A-Z]$/.test(initial) ? initial : "";
}

export function filterAndSortHiddenProfileGames<T extends HiddenProfileGameOption>(
  games: T[],
  hiddenGameIds: ReadonlySet<string>,
  query: string,
  initial = "",
) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedInitial = normalizeSearchText(initial).charAt(0);

  return games
    .filter((game) => {
      const normalizedTitle = normalizeSearchText(game.title);
      return normalizedTitle.includes(normalizedQuery) &&
        (!normalizedInitial || normalizedTitle.startsWith(normalizedInitial));
    })
    .sort((left, right) => {
      const hiddenOrder = Number(hiddenGameIds.has(right.appId)) -
        Number(hiddenGameIds.has(left.appId));
      return hiddenOrder || left.title.localeCompare(right.title);
    });
}
