import type { GhostBoxGame } from "../data";
import type { LibrarySortBy } from "../utils/storage";

function getLibraryLastPlayedTime(game: GhostBoxGame) {
  const lastPlayedTime = Date.parse(game.lastTimePlayed ?? "");
  return Number.isFinite(lastPlayedTime) ? lastPlayedTime : 0;
}

function getLibraryPlaytimeInMilliseconds(game: GhostBoxGame) {
  const trackedPlaytime = Number.isFinite(game.playTimeInMilliseconds)
    ? game.playTimeInMilliseconds ?? 0
    : 0;
  const hourPlaytime = Number.isFinite(game.hours)
    ? game.hours * 3_600_000
    : 0;

  return Math.max(trackedPlaytime, hourPlaytime);
}

export function sortLibraryGames(
  games: GhostBoxGame[],
  sortBy: LibrarySortBy,
  language: "pt" | "en"
) {
  return [...games].sort((left, right) => {
    if (sortBy === "recent") {
      const recentDiff =
        getLibraryLastPlayedTime(right) - getLibraryLastPlayedTime(left);
      if (recentDiff) return recentDiff;
    }

    if (sortBy === "playtime") {
      const leftPlaytime = getLibraryPlaytimeInMilliseconds(left);
      const rightPlaytime = getLibraryPlaytimeInMilliseconds(right);
      const playtimeDiff = rightPlaytime - leftPlaytime;
      if (playtimeDiff) return playtimeDiff;
    }

    return left.title.localeCompare(right.title, language === "pt" ? "pt-BR" : "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}
