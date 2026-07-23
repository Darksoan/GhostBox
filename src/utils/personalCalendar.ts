import type { GhostBoxGame } from "../data";
import type { StoredPersonalCalendar } from "./storage";
import { isSteamTitlePlaceholder } from "./steamTitles";

export const personalCalendarAlgorithmVersion = "monthly-v2";

export const personalCalendarWeekdayLabels = {
  pt: ["DOM.", "SEG.", "TER.", "QUA.", "QUI.", "SEX.", "SÁB."],
  en: ["SUN.", "MON.", "TUE.", "WED.", "THU.", "FRI.", "SAT."],
} as const;

type PickPersonalCalendarGamesOptions = {
  gameCount: number;
  gamesPerDay: number;
  cycleStart: Date;
  monthGameIds?: Record<string, string[]>;
  excludedGameIds?: Set<string>;
};

type CreatePersonalCalendarOptions = {
  selectedGames: GhostBoxGame[];
  storedCalendar: StoredPersonalCalendar | null;
  cycleStart: Date;
  refreshMs: number;
  gamesPerDay: number;
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

function normalizeCalendarTrait(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    acao: "Action",
    ação: "Action",
    action: "Action",
    aventura: "Adventure",
    adventure: "Adventure",
    historia: "Story Rich",
    história: "Story Rich",
    story: "Story Rich",
    "story rich": "Story Rich",
    terror: "Horror",
    horror: "Horror",
    corrida: "Racing",
    racing: "Racing",
    esportes: "Sports",
    sports: "Sports",
    estrategia: "Strategy",
    estratégia: "Strategy",
    strategy: "Strategy",
    exploracao: "Exploration",
    exploração: "Exploration",
    exploration: "Exploration",
  };

  return aliases[normalized.toLowerCase()] ?? normalized;
}

export function personalCalendarGameKey(game: GhostBoxGame) {
  const appId = (game.appId || game.id.replace(/^steam-/, "")).trim();
  return /^\d+$/.test(appId) ? appId : "";
}

export function getPersonalCalendarCycleStart(date = new Date()) {
  return atLocalStartOfDay(date);
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

function getPersonalCalendarTraits(game: GhostBoxGame) {
  return new Set(
    [...game.genres, ...game.tags]
      .map((value) => normalizeCalendarTrait(value).toLowerCase())
      .filter(Boolean)
  );
}

function getPersonalCalendarOverlapScore(
  game: GhostBoxGame,
  selectedGames: GhostBoxGame[]
) {
  const traits = getPersonalCalendarTraits(game);
  if (!traits.size) return 0;

  return selectedGames.reduce((score, selectedGame) => {
    const selectedTraits = getPersonalCalendarTraits(selectedGame);
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

export function pickPersonalCalendarGames(
  games: GhostBoxGame[],
  {
    gameCount,
    gamesPerDay,
    cycleStart,
    monthGameIds = {},
    excludedGameIds = new Set<string>(),
  }: PickPersonalCalendarGamesOptions
) {
  const selectedGames: GhostBoxGame[] = [];
  const selectedIdsByMonth = new Map<string, Set<string>>();
  const selectedIds = new Set<string>();
  const candidates = shufflePersonalCalendarGames(
    getUniquePersonalCalendarPool(games).filter(
      (game) => !excludedGameIds.has(personalCalendarGameKey(game))
    )
  );

  for (let slotIndex = 0; slotIndex < gameCount; slotIndex += 1) {
    const date = addDays(cycleStart, Math.floor(slotIndex / gamesPerDay));
    const monthKey = monthKeyForDate(date);
    const monthUsedIds = new Set(monthGameIds[monthKey] ?? []);
    const selectedMonthIds = selectedIdsByMonth.get(monthKey) ?? new Set<string>();
    const rankedCandidates = candidates
      .flatMap((game, index) => {
        const key = personalCalendarGameKey(game);
        if (selectedIds.has(key) || selectedMonthIds.has(key) || monthUsedIds.has(key)) {
          return [];
        }

        return [
          {
            game,
            index,
            overlapScore: getPersonalCalendarOverlapScore(game, selectedGames),
            qualityScore: getCalendarGameQualityScore(game),
          },
        ];
      })
      .sort(
        (left, right) =>
          left.overlapScore - right.overlapScore ||
          right.qualityScore - left.qualityScore ||
          left.index - right.index
      );

    const nextCandidate = rankedCandidates[0];
    if (!nextCandidate) break;

    const key = personalCalendarGameKey(nextCandidate.game);
    selectedGames.push(nextCandidate.game);
    selectedIds.add(key);
    selectedMonthIds.add(key);
    selectedIdsByMonth.set(monthKey, selectedMonthIds);
    candidates.splice(nextCandidate.index, 1);
  }

  return selectedGames;
}

export function createPersonalCalendar({
  selectedGames,
  storedCalendar,
  cycleStart,
  refreshMs,
  gamesPerDay,
}: CreatePersonalCalendarOptions): StoredPersonalCalendar {
  const cycleStartDate = atLocalStartOfDay(cycleStart);
  const selectedGameIds = selectedGames.map(personalCalendarGameKey);
  const monthGameIds: Record<string, string[]> = {};

  selectedGameIds.forEach((gameId, index) => {
    const monthKey = monthKeyForDate(addDays(cycleStartDate, Math.floor(index / gamesPerDay)));
    monthGameIds[monthKey] = [
      ...(monthGameIds[monthKey] ?? []),
      gameId,
    ];
  });

  Object.keys(monthGameIds).forEach((monthKey) => {
    const existingIds = storedCalendar?.monthGameIds[monthKey] ?? [];
    monthGameIds[monthKey] = [
      ...new Set([...existingIds, ...monthGameIds[monthKey]]),
    ];
  });

  return {
    algorithmVersion: personalCalendarAlgorithmVersion,
    weekStart: cycleStartDate.toISOString(),
    cycleStart: cycleStartDate.toISOString(),
    expiresAt: new Date(cycleStartDate.getTime() + refreshMs).toISOString(),
    gameIds: selectedGameIds,
    monthGameIds,
  };
}
