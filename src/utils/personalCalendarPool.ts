import type { GameDatabaseRequest, GameDatabaseResult, GhostBoxGame } from "../data";
import type { StoredPersonalCalendar } from "./storage";
import {
  getPersonalCalendarDayKeys,
  getPersonalCalendarRecentGameIds,
  getUniquePersonalCalendarPool,
  personalCalendarGameKey,
  personalCalendarRotationSeed,
} from "./personalCalendar";
import { shuffledRotation } from "./homeRotation";

const pageSize = 120;
// Four rounds maximum (eight catalogue requests). Always sample two rounds so
// the top of the rankings isn't the calendar's only source of recommendations.
const minimumRounds = 2;
const maximumRounds = 4;
// Stay within the catalogue's ~2k ranked rotation pool, not its uncurated tail.
const samplingPages = 16;
const sorts = ["popular", "recentlyAdded"] as const;
type PoolSort = typeof sorts[number];

type LoadPersonalCalendarPoolOptions = {
  days: number;
  gamesPerDay: number;
  cycleStart: Date;
  storedCalendar: StoredPersonalCalendar | null;
  // The first catalogue pages start while the wishlist exclusions are loading.
  excludedGameIds: ReadonlySet<string> | Promise<ReadonlySet<string>>;
  loadPage: (request: GameDatabaseRequest) => Promise<GameDatabaseResult>;
  loadGame: (appId: string) => Promise<GhostBoxGame | null>;
};

export async function loadPersonalCalendarPool({
  days,
  gamesPerDay,
  cycleStart,
  storedCalendar,
  excludedGameIds,
  loadPage,
  loadGame,
}: LoadPersonalCalendarPoolOptions) {
  const seed = personalCalendarRotationSeed(cycleStart);
  const games: GhostBoxGame[] = [];
  const totals = new Map<PoolSort, number>();
  const visited = new Map<PoolSort, Set<number>>(sorts.map((sort) => [sort, new Set()]));

  async function loadNextPages() {
    const requests = sorts.flatMap((sort) => {
      const seen = visited.get(sort)!;
      const pageCount = Math.min(samplingPages, Math.ceil((totals.get(sort) ?? 0) / pageSize));
      const pages = shuffledRotation(
        Array.from({ length: pageCount }, (_, index) => index),
        { seed, salt: `personal-calendar-pool:${sort}` }
      );
      const page = seen.size ? pages.find((index) => !seen.has(index)) : 0;
      if (page === undefined) return [];
      seen.add(page);

      return [loadPage({ query: "", limit: pageSize, offset: page * pageSize, sort, seed, includeFacets: false })
        .then((result) => ({ sort, page, result }))
        .catch(() => ({ sort, page, result: null }))];
    });
    const results = await Promise.all(requests);
    // Merge in source order, not network completion order: duplicates can
    // carry different metadata and must resolve consistently on every load.
    results.forEach(({ sort, page, result }) => {
      if (!result) {
        totals.set(sort, 0);
        return;
      }
      games.push(...result.games);
      let total = result.matched || result.total || result.games.length;
      if (result.games.length < pageSize) total = Math.min(total, page * pageSize + result.games.length);
      totals.set(sort, total);
    });
    return requests.length > 0;
  }

  const [, exclusions] = await Promise.all([loadNextPages(), excludedGameIds]);
  const scheduledIds = new Set(
    getPersonalCalendarDayKeys(cycleStart, days)
      .flatMap((dayKey) => (storedCalendar?.dayGameIds[dayKey] ?? []).slice(0, gamesPerDay))
      .filter((id) => !exclusions.has(id))
  );
  const recentIds = getPersonalCalendarRecentGameIds(storedCalendar, cycleStart);
  // Rehydrate scheduled games alongside the remaining catalogue requests. A
  // rotated page is not an availability check and must not replace a day.
  const loadedIds = new Set(getUniquePersonalCalendarPool(games).map(personalCalendarGameKey));
  const retainedPromise = Promise.all(
    [...scheduledIds].filter((id) => !loadedIds.has(id)).map(async (id) => {
      const game = await loadGame(id).catch(() => null);
      return game && personalCalendarGameKey(game) === id ? [game] : [];
    })
  );
  const target = days * gamesPerDay * 15;
  const eligibleCount = () => getUniquePersonalCalendarPool(games).filter((game) => {
    const key = personalCalendarGameKey(game);
    return !exclusions.has(key) && !recentIds.has(key) && !scheduledIds.has(key);
  }).length;

  for (let round = 1; round < maximumRounds; round += 1) {
    if (round >= minimumRounds && eligibleCount() >= target) break;
    if (!await loadNextPages()) break;
  }

  const retained = await retainedPromise;
  return getUniquePersonalCalendarPool([...retained.flat(), ...games]);
}
