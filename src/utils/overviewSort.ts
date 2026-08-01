import type { GhostBoxGame } from "../data";
import type { OverviewSortBy } from "./storage";
import { getProfileUnlockedAchievementCount } from "./profileAchievements";
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
  const decoratedGames = games.map((game) => {
    const unlocked = getProfileUnlockedAchievementCount(game);
    const total = Math.max(
      game.achievementList?.length ?? 0,
      game.achievements?.total ?? 0,
      unlocked,
    );

    return {
      game,
      unlocked,
      total,
      playtime: getOverviewPlaytimeInMilliseconds(game),
      lastPlayed: getOverviewLastPlayedTime(game),
    };
  });

  const filteredGames = sortBy === "perfect"
    ? decoratedGames.filter(({ total, unlocked }) => total > 0 && unlocked >= total)
    : decoratedGames;

  return [...filteredGames].sort((left, right) => {
    if (sortBy === "recent") {
      const recentDiff = right.lastPlayed - left.lastPlayed;
      if (recentDiff) return recentDiff;

      const playtimeDiff = right.playtime - left.playtime;
      if (playtimeDiff) return playtimeDiff;
    }

    if (sortBy === "playtime") {
      const playtimeDiff = right.playtime - left.playtime;
      if (playtimeDiff) return playtimeDiff;
    }

    if (sortBy === "achievements") {
      const unlockedDiff = right.unlocked - left.unlocked;
      if (unlockedDiff) return unlockedDiff;

      const totalDiff = right.total - left.total;
      if (totalDiff) return totalDiff;
    }

    if (sortBy === "perfect") {
      const playtimeDiff = right.playtime - left.playtime;
      if (playtimeDiff) return playtimeDiff;
    }

    return compareOverviewTitles(left.game, right.game, language);
  }).map(({ game }) => game);
}
