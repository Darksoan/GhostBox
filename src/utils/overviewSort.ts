import type { GhostBoxGame } from "../data";
import type { OverviewSortBy } from "./storage";
import {
  getProfileAchievementTotal,
  getProfileUnlockedAchievementCount,
} from "./profileAchievements";
import { parseLastPlayed } from "./time";

function getOverviewLastPlayedTime(game: GhostBoxGame) {
  const lastPlayedTime = parseLastPlayed(game.lastTimePlayed);
  return Number.isFinite(lastPlayedTime) ? lastPlayedTime : 0;
}

function getOverviewPlaytimeInMilliseconds(game: GhostBoxGame) {
  // Match profile overview: Steam-synced totals only.
  return Number.isFinite(game.playTimeInMilliseconds)
    ? game.playTimeInMilliseconds ?? 0
    : 0;
}

function compareOverviewTitles(
  left: GhostBoxGame,
  right: GhostBoxGame,
  language: "pt" | "en",
) {
  return left.title.localeCompare(right.title, language === "pt" ? "pt-BR" : "en", {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortOverviewGames(
  games: GhostBoxGame[],
  sortBy: OverviewSortBy,
  language: "pt" | "en",
) {
  return [...games].sort((left, right) => {
    if (sortBy === "recent") {
      const recentDiff =
        getOverviewLastPlayedTime(right) - getOverviewLastPlayedTime(left);
      if (recentDiff) return recentDiff;

      const playtimeDiff =
        getOverviewPlaytimeInMilliseconds(right) -
        getOverviewPlaytimeInMilliseconds(left);
      if (playtimeDiff) return playtimeDiff;
    }

    if (sortBy === "playtime") {
      const playtimeDiff =
        getOverviewPlaytimeInMilliseconds(right) -
        getOverviewPlaytimeInMilliseconds(left);
      if (playtimeDiff) return playtimeDiff;
    }

    if (sortBy === "achievements") {
      const unlockedDiff =
        getProfileUnlockedAchievementCount(right) -
        getProfileUnlockedAchievementCount(left);
      if (unlockedDiff) return unlockedDiff;

      const totalDiff =
        getProfileAchievementTotal(right) - getProfileAchievementTotal(left);
      if (totalDiff) return totalDiff;
    }

    return compareOverviewTitles(left, right, language);
  });
}
