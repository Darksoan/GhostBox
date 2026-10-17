import type { GhostBoxGame } from "../data";
import type { StoredPersonalCalendar } from "./storage";
import { isSteamTitlePlaceholder } from "./steamTitles";
import { gameTraitAppId, getGameTraitSet, normalizeGameTraitKey } from "./gameTraits";
import { filterOutSteamDemos } from "./steamAppType";
import { rotationHash } from "./homeRotation";

const personalCalendarAlgorithmVersion = "daily-v5";
const personalCalendarHistoryMonths = 3;

// These describe availability/business model, not a distinct style of game.
const genericCalendarTraits = new Set([
  "singleplayer", "single-player", "multiplayer", "co-op", "online co-op",
  "local co-op", "indie", "casual", "early access", "free to play",
  "free-to-play", "controller support", "full controller support",
]);

type CalendarCandidate = {
  game: GhostBoxGame;
  key: string;
  traits: Map<string, number>;
  qualityScore: number;
  exposureGroup: "popular" | "discovery" | null;
};

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

export function getPersonalCalendarDayKeys(cycleStart: Date, days: number) {
  const start = atLocalStartOfDay(cycleStart);
  return Array.from({ length: days }, (_, index) =>
    personalCalendarDayKey(addDays(start, index))
  );
}

export function personalCalendarRotationSeed(date: Date) {
  return Number(personalCalendarDayKey(atLocalStartOfDay(date)).replace(/-/g, ""));
}

function oldestPersonalCalendarMonth(cycleStart: Date) {
  const historyStart = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), 1);
  historyStart.setMonth(historyStart.getMonth() - (personalCalendarHistoryMonths - 1));
  return monthKeyForDate(historyStart);
}

export function getPersonalCalendarRecentGameIds(
  calendar: StoredPersonalCalendar | null,
  cycleStart: Date
) {
  const oldestMonthKey = oldestPersonalCalendarMonth(cycleStart);
  return new Set(
    Object.entries(calendar?.monthGameIds ?? {})
      .filter(([monthKey]) => monthKey >= oldestMonthKey)
      .flatMap(([, ids]) => ids)
  );
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

  return filterOutSteamDemos(games).filter((game) => {
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

function getCalendarGameQuality(game: GhostBoxGame) {
  const rawQuality = game.steamPositiveRatio ?? (game.rating > 1 ? game.rating / 100 : game.rating);
  return Number.isFinite(rawQuality) ? Math.min(1, Math.max(0, rawQuality)) : 0;
}

function calendarCandidate(game: GhostBoxGame): CalendarCandidate {
  const genres = new Set(game.genres.map(normalizeGameTraitKey));
  const traits = new Map(
    [...getGameTraitSet(game)]
      .filter((trait) => !genericCalendarTraits.has(trait))
      .map((trait) => [trait, genres.has(trait) ? 1.5 : 1] as const)
  );
  const reviews = Math.max(0, game.recommendations ?? 0, game.steamReviewCount ?? 0);
  const popularity = Math.min(Math.log10(reviews + 1) / 6, 1);
  const quality = getCalendarGameQuality(game);
  return {
    game,
    key: personalCalendarGameKey(game),
    traits,
    // Review volume must not bury well-rated, lesser-known discoveries.
    qualityScore: quality * 3 + popularity * 0.4,
    exposureGroup: quality >= 0.7 && reviews > 0
      ? reviews >= 10000 ? "popular" : "discovery"
      : null,
  };
}

function calendarSimilarity(candidate: CalendarCandidate, selected: CalendarCandidate) {
  // Unknown metadata must not earn a perfect diversity score. It remains a
  // fallback, not an endless supply of apparently unrelated games.
  if (!candidate.traits.size) return 1;
  if (!selected.traits.size) return 0.5;

  let intersection = 0;
  let union = 0;
  const keys = new Set([...candidate.traits.keys(), ...selected.traits.keys()]);
  keys.forEach((key) => {
    const left = candidate.traits.get(key) ?? 0;
    const right = selected.traits.get(key) ?? 0;
    intersection += Math.min(left, right);
    union += Math.max(left, right);
  });
  return intersection / union;
}

function getCalendarCandidateScore(
  candidate: CalendarCandidate,
  selected: CalendarCandidate[],
  dayGames: CalendarCandidate[],
  seed: number,
  dayKey: string,
  balanceExposure: boolean
) {
  const overlap = selected.reduce((score, game) => score + calendarSimilarity(candidate, game), 0);
  const dayOverlap = dayGames.reduce((score, game) => score + calendarSimilarity(candidate, game), 0);
  const rotation = rotationHash(seed, `personal-calendar:${dayKey}:${dayGames.length}:${candidate.key}`) / 0x100000000;
  // Balance visibility only when both groups have well-rated candidates;
  // never fill a discovery quota with poorly reviewed or unclassified games.
  const exposureOverlap = balanceExposure && candidate.exposureGroup
    ? selected.filter((game) => game.exposureGroup === candidate.exposureGroup).length * 0.3
      + dayGames.filter((game) => game.exposureGroup === candidate.exposureGroup).length * 0.5
    : 0;
  return candidate.qualityScore + rotation * 1.5 - overlap * 2 - dayOverlap * 2
    - exposureOverlap - (candidate.traits.size ? 0 : 2);
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
  const seed = personalCalendarRotationSeed(start);
  const candidates = getUniquePersonalCalendarPool(games)
    .filter((game) => !excludedGameIds.has(personalCalendarGameKey(game)))
    .map(calendarCandidate);
  const gameByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const balanceExposure = candidates.some((candidate) => candidate.exposureGroup === "popular")
    && candidates.some((candidate) => candidate.exposureGroup === "discovery");

  const dayKeys = getPersonalCalendarDayKeys(start, days);
  const dayDates = Array.from({ length: days }, (_, index) => addDays(start, index));
  const usedKeys = new Set<string>();
  const dayGames = new Map<string, CalendarCandidate[]>();
  const recentUsedIds = getPersonalCalendarRecentGameIds(storedCalendar, start);
  const lastShownMonth = new Map<string, string>();
  Object.entries(storedCalendar?.monthGameIds ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([month, ids]) => {
      ids.forEach((id) => lastShownMonth.set(id, month));
    });

  // Pass 1 — keep every still-valid game a day already owns.
  dayKeys.forEach((dayKey) => {
    const storedIds = storedCalendar?.dayGameIds[dayKey] ?? [];
    const retained: CalendarCandidate[] = [];
    for (const gameId of storedIds) {
      if (retained.length >= gamesPerDay) break;
      if (usedKeys.has(gameId)) continue;
      const game = gameByKey.get(gameId);
      if (!game) continue;
      usedKeys.add(gameId);
      retained.push(game);
    }
    dayGames.set(dayKey, retained);
  });

  // Pass 2 — fill only the empty slots left over.
  const selectedGames = () => dayKeys.flatMap((dayKey) => dayGames.get(dayKey) ?? []);

  dayKeys.forEach((dayKey, dayIndex) => {
    const monthKey = monthKeyForDate(dayDates[dayIndex]);
    const monthUsedIds = new Set(storedCalendar?.monthGameIds[monthKey] ?? []);
    const dayList = dayGames.get(dayKey) ?? [];

    while (dayList.length < gamesPerDay) {
      const picked = selectedGames();
      const rank = (historyIds: Set<string>, recycling = false) => candidates
          .flatMap((candidate) => {
            if (usedKeys.has(candidate.key) || historyIds.has(candidate.key)) return [];

            return [{
              candidate,
              lastShown: recycling ? lastShownMonth.get(candidate.key) ?? "" : "",
              score: getCalendarCandidateScore(candidate, picked, dayList, seed, dayKey, balanceExposure),
            }];
          })
          .sort(
            (left, right) =>
              left.lastShown.localeCompare(right.lastShown) ||
              right.score - left.score ||
              left.candidate.key.localeCompare(right.candidate.key)
          );
      // Prefer the full rolling history; if the pool is exhausted, recycle only
      // games from older months and still never repeat inside the current month.
      let ranked = rank(recentUsedIds);
      if (!ranked.length) ranked = rank(monthUsedIds, true);

      const next = ranked[0];
      if (!next) break;

      usedKeys.add(next.candidate.key);
      dayList.push(next.candidate);
    }

    dayGames.set(dayKey, dayList);
  });

  const dayGameIds: Record<string, string[]> = {};
  dayKeys.forEach((dayKey) => {
    dayGameIds[dayKey] = (dayGames.get(dayKey) ?? []).map((candidate) => candidate.key);
  });

  return { games: selectedGames().map((candidate) => candidate.game), dayGameIds };
}

export function createPersonalCalendar({
  dayGameIds,
  storedCalendar,
  cycleStart,
  days,
}: CreatePersonalCalendarOptions): StoredPersonalCalendar {
  const cycleStartDate = atLocalStartOfDay(cycleStart);
  const dayKeys = getPersonalCalendarDayKeys(cycleStartDate, days);
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

  const oldestMonthKey = oldestPersonalCalendarMonth(cycleStartDate);
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
