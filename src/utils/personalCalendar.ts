import type { GhostBoxGame } from "../data";
import type { StoredPersonalCalendar } from "./storage";
import { isSteamTitlePlaceholder } from "./steamTitles";
import { gameTraitAppId, getGameTraitSet } from "./gameTraits";

const personalCalendarAlgorithmVersion = "daily-v4";
const personalCalendarHistoryMonths = 3;

const personalCalendarWeekdayLabels = {
  pt: ["DOM.", "SEG.", "TER.", "QUA.", "QUI.", "SEX.", "SÁB."],
  en: ["SUN.", "MON.", "TUE.", "WED.", "THU.", "FRI.", "SAT."],
} as const;

type PlanPersonalCalendarOptions = {
  days: number;
  gamesPerDay: number;
  cycleStart: Date;
  storedCalendar?: StoredPersonalCalendar | null;
  excludedGameIds?: Set<string>;
};

type CreatePersonalCalendarOptions = {
  dayGameIds: Record<string, string[]>;
  storedCalendar: StoredPersonalCalendar | null;
  cycleStart: Date;
  days: number;
};

function atLocalStartOfDay(date: Date) {
  const next = Number.isFinite(date.getTime()) ? new Date(date) : new Date();
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthKeyForDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function personalCalendarDayKey(date: Date) {
  return `${monthKeyForDate(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

export function personalCalendarGameKey(game: GhostBoxGame) {
  return gameTraitAppId(game);
}

export function getPersonalCalendarCycleStart(date = new Date()) {
  return atLocalStartOfDay(date);
}

// The calendar rolls at local midnight, so the window always starts on "today"
// and every future day keeps whatever games it was already assigned.
export function getPersonalCalendarExpiry(cycleStart: Date) {
  return atLocalStartOfDay(addDays(atLocalStartOfDay(cycleStart), 1));
}

export function getPersonalCalendarDates(
  language: "pt" | "en",
  cycleStart: string | Date,
  days: number
) {
  const parsedStart = typeof cycleStart === "string" ? new Date(cycleStart) : cycleStart;
  const start = Number.isFinite(parsedStart?.getTime())
    ? parsedStart
    : getPersonalCalendarCycleStart();
  const weekdayLabels = personalCalendarWeekdayLabels[language];

  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${weekdayLabels[date.getDay()]} ${day}/${month}`;
  });
}

export function getUniquePersonalCalendarPool(games: GhostBoxGame[]) {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = personalCalendarGameKey(game);
    if (!key || seen.has(key) || isSteamTitlePlaceholder(game.title, game.appId)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function isStoredPersonalCalendarFresh(
  calendar: StoredPersonalCalendar | null,
  expectedGameCount: number,
  now = Date.now()
): calendar is StoredPersonalCalendar {
  return Boolean(
    calendar &&
      calendar.algorithmVersion === personalCalendarAlgorithmVersion &&
      calendar.gameIds.length === expectedGameCount &&
      Number.isFinite(Date.parse(calendar.cycleStart)) &&
      Date.parse(calendar.expiresAt) > now
  );
}

function shufflePersonalCalendarGames(games: GhostBoxGame[]) {
  const shuffled = [...games];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}

function getPersonalCalendarOverlapScore(
  game: GhostBoxGame,
  selectedGames: GhostBoxGame[]
) {
  const traits = getGameTraitSet(game);
  if (!traits.size) return 0;

  return selectedGames.reduce((score, selectedGame) => {
    const selectedTraits = getGameTraitSet(selectedGame);
    let overlap = 0;
    traits.forEach((trait) => {
      if (selectedTraits.has(trait)) overlap += 1;
    });
    return score + overlap;
  }, 0);
}

function getCalendarGameQualityScore(game: GhostBoxGame) {
  const popularity = Math.log10(
    (game.recommendations ?? game.steamReviewCount ?? game.popularityScore ?? 0) + 1
  );
  const quality = game.steamPositiveRatio ?? game.rating ?? 0;
  return quality * 10 + popularity;
}

/**
 * Assigns games per calendar *date* instead of per window slot. A day that was
 * already filled keeps its games while it stays inside the window, so nothing
 * is swapped before that day is actually reached — only days with empty (or
 * now-unavailable) slots get new picks.
 */
export function planPersonalCalendar(
  games: GhostBoxGame[],
  {
    days,
    gamesPerDay,
    cycleStart,
    storedCalendar = null,
    excludedGameIds = new Set<string>(),
  }: PlanPersonalCalendarOptions
) {
  const start = atLocalStartOfDay(cycleStart);
  const pool = getUniquePersonalCalendarPool(games);
  const gameByKey = new Map(pool.map((game) => [personalCalendarGameKey(game), game]));
  const candidates = shufflePersonalCalendarGames(
    pool.filter((game) => !excludedGameIds.has(personalCalendarGameKey(game)))
  );

  const dayKeys = Array.from({ length: days }, (_, index) =>
    personalCalendarDayKey(addDays(start, index))
  );
  const dayDates = Array.from({ length: days }, (_, index) => addDays(start, index));
  const usedKeys = new Set<string>();
  const dayGames = new Map<string, GhostBoxGame[]>();

  // Pass 1 — keep every still-valid game a day already owns.
  dayKeys.forEach((dayKey) => {
    const storedIds = storedCalendar?.dayGameIds[dayKey] ?? [];
    const retained = storedIds.flatMap((gameId) => {
      if (usedKeys.has(gameId) || excludedGameIds.has(gameId)) return [];
      const game = gameByKey.get(gameId);
      if (!game) return [];
      usedKeys.add(gameId);
      return [game];
    });
    dayGames.set(dayKey, retained.slice(0, gamesPerDay));
  });

  // Pass 2 — fill only the empty slots left over.
  const selectedGames = () => dayKeys.flatMap((dayKey) => dayGames.get(dayKey) ?? []);

  dayKeys.forEach((dayKey, dayIndex) => {
    const monthKey = monthKeyForDate(dayDates[dayIndex]);
    const recentUsedIds = new Set(
      Object.values(storedCalendar?.monthGameIds ?? {}).flat()
    );
    const monthUsedIds = new Set(storedCalendar?.monthGameIds[monthKey] ?? []);
    const dayList = dayGames.get(dayKey) ?? [];

    while (dayList.length < gamesPerDay) {
      const picked = selectedGames();
      const rank = (historyIds: Set<string>) => candidates
          .flatMap((game, index) => {
            const key = personalCalendarGameKey(game);
            if (usedKeys.has(key) || historyIds.has(key)) return [];

            return [{
              game,
              index,
              overlapScore: getPersonalCalendarOverlapScore(game, picked),
              qualityScore: getCalendarGameQualityScore(game),
            }];
          })
          .sort(
            (left, right) =>
              left.overlapScore - right.overlapScore ||
              right.qualityScore - left.qualityScore ||
              left.index - right.index
          );
      // Prefer the full rolling history; if the pool is exhausted, recycle only
      // games from older months and still never repeat inside the current month.
      let ranked = rank(recentUsedIds);
      if (!ranked.length) ranked = rank(monthUsedIds);

      const next = ranked[0];
      if (!next) break;

      usedKeys.add(personalCalendarGameKey(next.game));
      dayList.push(next.game);
      candidates.splice(next.index, 1);
    }

    dayGames.set(dayKey, dayList);
  });

  const dayGameIds: Record<string, string[]> = {};
  dayKeys.forEach((dayKey) => {
    dayGameIds[dayKey] = (dayGames.get(dayKey) ?? []).map(personalCalendarGameKey);
  });

  return { games: selectedGames(), dayGameIds };
}

export function createPersonalCalendar({
  dayGameIds,
  storedCalendar,
  cycleStart,
  days,
}: CreatePersonalCalendarOptions): StoredPersonalCalendar {
  const cycleStartDate = atLocalStartOfDay(cycleStart);
  const dayKeys = Array.from({ length: days }, (_, index) =>
    personalCalendarDayKey(addDays(cycleStartDate, index))
  );
  const windowMonthKeys = new Set(
    Array.from({ length: days }, (_, index) =>
      monthKeyForDate(addDays(cycleStartDate, index))
    )
  );

  // Drop days that already fell out of the window so storage stays bounded.
  const prunedDayGameIds: Record<string, string[]> = {};
  dayKeys.forEach((dayKey) => {
    const ids = dayGameIds[dayKey] ?? [];
    if (ids.length) prunedDayGameIds[dayKey] = [...ids];
  });

  const historyStart = new Date(cycleStartDate.getFullYear(), cycleStartDate.getMonth(), 1);
  historyStart.setMonth(historyStart.getMonth() - (personalCalendarHistoryMonths - 1));
  const oldestMonthKey = monthKeyForDate(historyStart);
  const sortedWindowMonthKeys = [...windowMonthKeys].sort();
  const newestMonthKey =
    sortedWindowMonthKeys[sortedWindowMonthKeys.length - 1] ??
    monthKeyForDate(cycleStartDate);
  const monthGameIds: Record<string, string[]> = {};
  Object.entries(storedCalendar?.monthGameIds ?? {}).forEach(([monthKey, ids]) => {
    if (monthKey >= oldestMonthKey && monthKey <= newestMonthKey) {
      monthGameIds[monthKey] = [...ids];
    }
  });
  windowMonthKeys.forEach((monthKey) => {
    monthGameIds[monthKey] ??= [];
  });

  dayKeys.forEach((dayKey, index) => {
    const monthKey = monthKeyForDate(addDays(cycleStartDate, index));
    monthGameIds[monthKey] = [
      ...new Set([...(monthGameIds[monthKey] ?? []), ...(prunedDayGameIds[dayKey] ?? [])]),
    ];
  });

  return {
    algorithmVersion: personalCalendarAlgorithmVersion,
    weekStart: cycleStartDate.toISOString(),
    cycleStart: cycleStartDate.toISOString(),
    expiresAt: getPersonalCalendarExpiry(cycleStartDate).toISOString(),
    gameIds: dayKeys.flatMap((dayKey) => prunedDayGameIds[dayKey] ?? []),
    monthGameIds,
    dayGameIds: prunedDayGameIds,
  };
}
