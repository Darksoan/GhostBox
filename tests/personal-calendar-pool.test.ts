import { describe, expect, it, vi } from "vitest";
import type { GameDatabaseRequest, GameDatabaseResult } from "../src/data";
import { createSeedGame } from "../src/utils/gameSeed";
import { loadPersonalCalendarPool } from "../src/utils/personalCalendarPool";
import { createPersonalCalendar, getPersonalCalendarDayKeys, planPersonalCalendar } from "../src/utils/personalCalendar";

const cycleStart = new Date(2026, 9, 16);
const days = 4;
const gamesPerDay = 2;
const options = { cycleStart, days, gamesPerDay, storedCalendar: null, excludedGameIds: new Set<string>() };
const game = (id: number) => ({ ...createSeedGame({ appId: String(id), title: `Game ${id}` }, 0), tags: ["Action"] });
const games = (start: number, count = 120) => Array.from({ length: count }, (_, index) => game(start + index));
const result = (items: ReturnType<typeof games>, total = 1920): GameDatabaseResult => ({
  games: items, total, matched: total, limited: false, source: "test",
});
const cataloguePage = (request: GameDatabaseRequest) => result(
  games((request.sort === "popular" ? 1 : 10001) + (request.offset ?? 0))
);
const loadGame = vi.fn(async (_id: string) => null);

describe("personal calendar candidate pool", () => {
  it("samples deeper pages with an explicit daily seed and no repeated requests", async () => {
    const loadPage = vi.fn(async (request: GameDatabaseRequest) => cataloguePage(request));
    const pool = await loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    const requests = loadPage.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(4);
    expect(requests.slice(0, 2).every((request) => request.offset === 0)).toBe(true);
    expect(requests.slice(2).every((request) => request.offset! > 0)).toBe(true);
    expect(requests.every((request) => request.seed === 20261016 && request.includeFacets === false)).toBe(true);
    expect(new Set(requests.map((request) => `${request.sort}:${request.offset}`)).size).toBe(4);
    expect(pool).toHaveLength(480);
  });

  it("keeps samples stable on the same date and rotates them on other dates", async () => {
    const requestsFor = async (date: Date) => {
      const loadPage = vi.fn(async (request: GameDatabaseRequest) => cataloguePage(request));
      await loadPersonalCalendarPool({ ...options, cycleStart: date, loadPage, loadGame });
      return loadPage.mock.calls.map(([request]) => `${request.sort}:${request.offset}`);
    };
    const today = await requestsFor(cycleStart);
    expect(await requestsFor(cycleStart)).toEqual(today);
    const samples = await Promise.all(Array.from({ length: 7 }, (_, index) => requestsFor(new Date(2026, 9, 16 + index))));
    expect(new Set(samples.map((sample) => sample.join(","))).size).toBeGreaterThan(4);
  });

  it("counts unseen candidates, not games already in the calendar history", async () => {
    let page = 0;
    const loadPage = vi.fn(async (_request: GameDatabaseRequest) => result(games(++page <= 4 ? 1 : 1001)));
    const storedCalendar = createPersonalCalendar({ dayGameIds: {}, storedCalendar: null, cycleStart, days });
    storedCalendar.monthGameIds = { "2026-09": games(1).map((item) => item.appId) };
    const pool = await loadPersonalCalendarPool({ ...options, storedCalendar, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(6);
    const planned = planPersonalCalendar(pool, { ...options, storedCalendar });
    expect(planned.games).toHaveLength(8);
    expect(planned.games.every((item) => Number(item.appId) >= 1001)).toBe(true);
  });

  it("starts both sources while wishlist exclusions are pending and tops up afterward", async () => {
    let resolveExclusions!: (value: Set<string>) => void;
    const excludedGameIds = new Promise<Set<string>>((resolve) => { resolveExclusions = resolve; });
    let page = 0;
    const loadPage = vi.fn(async (_request: GameDatabaseRequest) => result(games(++page <= 4 ? 1 : 1001)));
    const pending = loadPersonalCalendarPool({ ...options, excludedGameIds, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(2);
    resolveExclusions(new Set(games(1).map((item) => item.appId)));
    const pool = await pending;
    expect(loadPage).toHaveBeenCalledTimes(6);
    expect(pool.filter((item) => Number(item.appId) >= 1001)).toHaveLength(120);
  });

  it("bounds network work even when every candidate is excluded", async () => {
    const loadPage = vi.fn(async (request: GameDatabaseRequest) => cataloguePage(request));
    const excludedGameIds = new Set(games(1, 20000).map((item) => item.appId));
    await loadPersonalCalendarPool({ ...options, excludedGameIds, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(8);
    const requests = loadPage.mock.calls.map(([request]) => request);
    expect(new Set(requests.map((request) => `${request.sort}:${request.offset}`)).size).toBe(8);
    expect(requests.every((request) => request.offset! < 1920)).toBe(true);
  });

  it("stops at the end of a small catalogue and deduplicates overlapping sources", async () => {
    const loadPage = vi.fn(async (_request: GameDatabaseRequest) => result(games(1, 30), 30));
    const pool = await loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(pool).toHaveLength(30);
  });

  it("does not let duplicate ids, demos, or placeholder titles satisfy the target", async () => {
    let page = 0;
    const loadPage = vi.fn(async (_request: GameDatabaseRequest) => {
      page += 1;
      if (page > 4) return result(games(1001));
      return result(Array.from({ length: 120 }, (_, index) => ({
        ...game(index % 2 ? 1 : 2),
        ...(index % 2 ? { appType: "demo" } : { title: "Steam App 2" }),
      })));
    });
    const pool = await loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(6);
    expect(pool).toHaveLength(120);
    expect(pool.every((item) => Number(item.appId) >= 1001)).toBe(true);
  });

  it("stops on empty pages even when the backend reports a larger catalogue", async () => {
    const loadPage = vi.fn(async (_request: GameDatabaseRequest) => result([], 100000));
    const pool = await loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(pool).toEqual([]);
  });

  it("merges overlapping pages consistently even if the recent source answers first", async () => {
    let finishPopular!: (value: GameDatabaseResult) => void;
    const popular = new Promise<GameDatabaseResult>((resolve) => { finishPopular = resolve; });
    const loadPage = vi.fn((request: GameDatabaseRequest) => request.sort === "popular"
      ? popular
      : Promise.resolve(result(games(1, 30).map((item) => ({ ...item, tags: ["Racing"] })), 30)));
    const pending = loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    await Promise.resolve();
    finishPopular(result(games(1, 30), 30));
    const pool = await pending;
    expect(pool.every((item) => item.tags[0] === "Action")).toBe(true);
  });

  it("keeps the surviving source usable if the other request fails", async () => {
    const loadPage = vi.fn(async (request: GameDatabaseRequest) => {
      if (request.sort === "popular") throw new Error("unavailable");
      return result(games(1, 30), 30);
    });
    const pool = await loadPersonalCalendarPool({ ...options, loadPage, loadGame });
    expect(pool).toHaveLength(30);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("rehydrates only missing scheduled games in the current date window", async () => {
    const keys = getPersonalCalendarDayKeys(cycleStart, days);
    const storedCalendar = createPersonalCalendar({
      dayGameIds: { [keys[0]]: ["90001", "1"], [keys[1]]: ["90002"], [keys[3]]: ["90003"] },
      storedCalendar: null, cycleStart, days,
    });
    storedCalendar.dayGameIds["2026-10-15"] = ["90004"];
    const excludedGameIds = new Set(["90003"]);
    const loadPage = vi.fn(async (request: GameDatabaseRequest) => cataloguePage(request));
    const loadScheduledGame = vi.fn(async (id: string) => game(Number(id)));
    const pool = await loadPersonalCalendarPool({ ...options, storedCalendar, excludedGameIds, loadPage, loadGame: loadScheduledGame });
    expect(loadScheduledGame.mock.calls.map(([id]) => id).sort()).toEqual(["90001", "90002"]);
    const planned = planPersonalCalendar(pool, { ...options, storedCalendar, excludedGameIds });
    expect(planned.dayGameIds[keys[0]]).toEqual(["90001", "1"]);
    expect(planned.dayGameIds[keys[1]][0]).toBe("90002");
    expect(planned.games.some((item) => item.appId === "90003")).toBe(false);
  });

  it("refills an unavailable or mismatched scheduled game without losing other picks", async () => {
    const [key] = getPersonalCalendarDayKeys(cycleStart, days);
    const storedCalendar = createPersonalCalendar({
      dayGameIds: { [key]: ["90001", "90002"] }, storedCalendar: null, cycleStart, days,
    });
    const loadPage = vi.fn(async (request: GameDatabaseRequest) => cataloguePage(request));
    const loadScheduledGame = vi.fn(async (id: string) => id === "90001" ? game(90001) : game(99999));
    const pool = await loadPersonalCalendarPool({ ...options, storedCalendar, loadPage, loadGame: loadScheduledGame });
    const planned = planPersonalCalendar(pool, { ...options, storedCalendar });
    expect(planned.dayGameIds[key][0]).toBe("90001");
    expect(planned.games).toHaveLength(8);
    expect(planned.games.some((item) => ["90002", "99999"].includes(item.appId))).toBe(false);
  });
});
