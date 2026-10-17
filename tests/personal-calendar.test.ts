import { describe, expect, it } from "vitest";
import { createSeedGame } from "../src/utils/gameSeed";
import {
  createPersonalCalendar,
  getPersonalCalendarDayKeys,
  getPersonalCalendarExpiry,
  getPersonalCalendarRecentGameIds,
  isStoredPersonalCalendarFresh,
  personalCalendarDayKey,
  planPersonalCalendar,
} from "../src/utils/personalCalendar";
import type { StoredPersonalCalendar } from "../src/utils/storage";

const days = 4;
const gamesPerDay = 2;

function game(appId: string, tags: string[] = ["Action"]) {
  return {
    ...createSeedGame({ appId, title: `Game ${appId}` }, Number(appId) || 0, ""),
    tags,
  };
}

function pool(size = 40) {
  return Array.from({ length: size }, (_, index) => game(String(index + 1)));
}

function plan(cycleStart: Date, storedCalendar: StoredPersonalCalendar | null, games = pool()) {
  return planPersonalCalendar(games, {
    days,
    gamesPerDay,
    cycleStart,
    storedCalendar,
  });
}

describe("personal calendar", () => {
  it("expires at the next local midnight", () => {
    const cycleStart = new Date(2026, 7, 21, 19);
    expect(getPersonalCalendarExpiry(cycleStart).getTime()).toBe(
      new Date(2026, 7, 22).getTime()
    );

    const { dayGameIds } = plan(new Date(2026, 7, 21), null);
    const calendar = createPersonalCalendar({
      dayGameIds,
      storedCalendar: null,
      cycleStart,
      days,
    });
    expect(calendar.cycleStart).toBe(new Date(2026, 7, 21).toISOString());
    expect(calendar.expiresAt).toBe(new Date(2026, 7, 22).toISOString());
    expect(calendar.gameIds).toHaveLength(days * gamesPerDay);
  });

  it("keeps each future day's games when the window rolls to the next day", () => {
    const today = new Date(2026, 7, 21);
    const tomorrow = new Date(2026, 7, 22);
    const first = plan(today, null);
    const stored = createPersonalCalendar({
      dayGameIds: first.dayGameIds,
      storedCalendar: null,
      cycleStart: today,
      days,
    });

    const second = plan(tomorrow, stored);

    // Days 2..4 of yesterday's window are days 1..3 today and must be untouched.
    [1, 2, 3].forEach((offset) => {
      const dayKey = personalCalendarDayKey(new Date(2026, 7, 21 + offset));
      expect(second.dayGameIds[dayKey]).toEqual(first.dayGameIds[dayKey]);
    });

    // Only the newly exposed last day gets fresh picks.
    const newDayKey = personalCalendarDayKey(new Date(2026, 7, 25));
    expect(first.dayGameIds[newDayKey]).toBeUndefined();
    expect(second.dayGameIds[newDayKey]).toHaveLength(gamesPerDay);
  });

  it("re-picks nothing when replanning the same day", () => {
    const today = new Date(2026, 7, 21);
    const first = plan(today, null);
    const stored = createPersonalCalendar({
      dayGameIds: first.dayGameIds,
      storedCalendar: null,
      cycleStart: today,
      days,
    });

    expect(plan(today, stored).dayGameIds).toEqual(first.dayGameIds);
  });

  it("refills only the slot whose game left the pool", () => {
    const today = new Date(2026, 7, 21);
    const games = pool();
    const first = planPersonalCalendar(games, {
      days,
      gamesPerDay,
      cycleStart: today,
      storedCalendar: null,
    });
    const stored = createPersonalCalendar({
      dayGameIds: first.dayGameIds,
      storedCalendar: null,
      cycleStart: today,
      days,
    });

    const droppedId = first.games[5].appId;
    const second = planPersonalCalendar(
      games.filter((item) => item.appId !== droppedId),
      { days, gamesPerDay, cycleStart: today, storedCalendar: stored }
    );

    const keptIds = first.games
      .map((item) => item.appId)
      .filter((appId) => appId !== droppedId);
    expect(second.games.map((item) => item.appId)).toEqual(
      expect.arrayContaining(keptIds)
    );
    expect(second.games).toHaveLength(days * gamesPerDay);
    expect(second.games.some((item) => item.appId === droppedId)).toBe(false);
  });

  it("never repeats a game inside the same window", () => {
    const { games } = plan(new Date(2026, 7, 21), null);
    expect(new Set(games.map((item) => item.appId)).size).toBe(games.length);
  });

  it("is stable for a date even if the catalogue pages arrive in another order", () => {
    const today = new Date(2026, 7, 21);
    const games = pool();
    const first = plan(today, null, games);
    expect(plan(today, null, games).dayGameIds).toEqual(first.dayGameIds);
    expect(plan(today, null, [...games].reverse()).dayGameIds).toEqual(first.dayGameIds);
  });

  it("rotates similarly rated games instead of sorting the same top eight every day", () => {
    const games = pool(80).map((item, index) => ({
      ...item,
      steamPositiveRatio: 0.95 - index / 1000,
      steamReviewCount: 1000,
    }));
    const selections = Array.from({ length: 12 }, (_, index) =>
      plan(new Date(2026, 7, 1 + index), null, games).games.map((item) => item.appId)
    );
    expect(new Set(selections.map((ids) => ids.join(","))).size).toBe(12);
    expect(new Set(selections.flat()).size).toBeGreaterThan(30);
  });

  it("balances styles across the window and avoids similar pairs on the same day", () => {
    const styles = ["Racing", "Strategy", "Horror", "Puzzle"];
    const games = Array.from({ length: 80 }, (_, index) => ({
      ...game(String(index + 1), [styles[index % styles.length], "Indie", "Singleplayer"]),
      steamPositiveRatio: 0.9,
    }));
    const result = plan(new Date(2026, 7, 21), null, games);
    styles.forEach((style) => {
      expect(result.games.filter((item) => item.tags.includes(style))).toHaveLength(2);
    });
    const byId = new Map(result.games.map((item) => [item.appId, item]));
    Object.values(result.dayGameIds).forEach((ids) => {
      expect(new Set(ids.map((id) => byId.get(id)!.tags[0])).size).toBe(gamesPerDay);
    });
  });

  it("does not count common Steam tags as distinct styles", () => {
    const styles = ["Racing", "Strategy", "Horror", "Puzzle", "Platformer", "Sports", "Simulation", "RPG"];
    const games = Array.from({ length: 80 }, (_, index) =>
      game(String(index + 1), [styles[index % styles.length], "Indie", "Singleplayer", "Multiplayer", "Early Access"])
    );
    const result = plan(new Date(2026, 7, 21), null, games);
    expect(new Set(result.games.map((item) => item.tags[0])).size).toBe(8);
  });

  it("does not reward missing metadata with artificial diversity", () => {
    const described = pool(32).map((item) => ({ ...item, steamPositiveRatio: 0.9 }));
    const unknown = Array.from({ length: 16 }, (_, index) => ({
      ...game(String(100 + index), []),
      steamPositiveRatio: 0.9,
    }));
    const result = plan(new Date(2026, 7, 21), null, [...unknown, ...described]);
    expect(result.games).toHaveLength(8);
    expect(result.games.every((item) => item.tags.length > 0)).toBe(true);
    expect(plan(new Date(2026, 7, 21), null, unknown).games).toHaveLength(8);
  });

  it("mixes well-rated discoveries and popular games without preferring poor reviews", () => {
    const games = pool(90).map((item, index) => ({
      ...item,
      steamPositiveRatio: index < 60 ? 0.9 : 0.2,
      steamReviewCount: index < 30 ? 1000000 : 300,
    }));
    const result = plan(new Date(2026, 7, 21), null, games);
    expect(result.games.some((item) => item.steamReviewCount === 1000000)).toBe(true);
    expect(result.games.some((item) => item.steamReviewCount === 300)).toBe(true);
    expect(result.games.every((item) => item.steamPositiveRatio === 0.9)).toBe(true);
  });

  it("normalizes legacy percentage ratings to the Steam ratio scale", () => {
    const today = new Date(2026, 7, 21);
    const games = pool();
    const ratios = games.map((item) => ({ ...item, steamPositiveRatio: 0.9 }));
    const percentages = games.map((item) => ({ ...item, rating: 90 }));
    expect(plan(today, null, percentages).dayGameIds).toEqual(plan(today, null, ratios).dayGameIds);
  });

  it("keeps a small pool unique and respects library/wishlist exclusions", () => {
    const result = planPersonalCalendar(pool(7), {
      days, gamesPerDay, cycleStart: new Date(2026, 7, 21),
      excludedGameIds: new Set(["1", "2"]),
    });
    expect(result.games).toHaveLength(5);
    expect(new Set(result.games.map((item) => item.appId)).size).toBe(5);
    expect(result.games.every((item) => !["1", "2"].includes(item.appId))).toBe(true);
    expect(Object.values(result.dayGameIds).map((ids) => ids.length)).toEqual([2, 2, 1, 0]);
  });

  it("keeps sparse assignments on their original dates", () => {
    const today = new Date(2026, 7, 21);
    const keys = getPersonalCalendarDayKeys(today, days);
    const stored = createPersonalCalendar({
      dayGameIds: { [keys[1]]: ["1", "2"], [keys[3]]: ["3"] },
      storedCalendar: null, cycleStart: today, days,
    });
    expect(plan(today, stored, pool(3)).dayGameIds).toEqual({
      [keys[0]]: [], [keys[1]]: ["1", "2"], [keys[2]]: [], [keys[3]]: ["3"],
    });
  });

  it("does not repeat assignments over weeks, including a month rollover", () => {
    let stored: StoredPersonalCalendar | null = null;
    const seen = new Set<string>();
    const games = pool(200);
    for (let offset = 0; offset < 40; offset += 1) {
      const cycleStart = new Date(2026, 7, 21 + offset);
      const result = plan(cycleStart, stored, games);
      Object.entries(result.dayGameIds).forEach(([key, ids]) => {
        if (stored?.dayGameIds[key]) {
          expect(ids).toEqual(stored.dayGameIds[key]);
        } else {
          ids.forEach((id) => {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
          });
        }
        expect(ids).toHaveLength(gamesPerDay);
      });
      stored = createPersonalCalendar({ dayGameIds: result.dayGameIds, storedCalendar: stored, cycleStart, days });
    }
    expect(seen.size).toBe(86);
  });

  it("avoids games shown in recent months", () => {
    const today = new Date(2026, 8, 1);
    const recentIds = Array.from({ length: 20 }, (_, index) => String(index + 1));
    const storedCalendar = createPersonalCalendar({
      dayGameIds: {},
      storedCalendar: {
        algorithmVersion: "daily-v4",
        weekStart: new Date(2026, 7, 31).toISOString(),
        cycleStart: new Date(2026, 7, 31).toISOString(),
        expiresAt: today.toISOString(),
        gameIds: [],
        monthGameIds: { "2026-08": recentIds },
        dayGameIds: {},
      },
      cycleStart: today,
      days,
    });

    const result = plan(today, storedCalendar);
    expect(result.games.every((item) => !recentIds.includes(item.appId))).toBe(true);
  });

  it("recycles the oldest month only after unseen candidates are exhausted", () => {
    const today = new Date(2026, 8, 1);
    const stored = createPersonalCalendar({ dayGameIds: {}, storedCalendar: null, cycleStart: today, days });
    stored.monthGameIds = { "2026-07": ["1", "2"], "2026-08": ["3", "4"], "2026-09": ["5", "6"] };
    const result = plan(today, stored, pool(8));
    expect(result.games.map((item) => item.appId).slice(0, 2).sort()).toEqual(["7", "8"]);
    expect(result.games.map((item) => item.appId).slice(2, 4).sort()).toEqual(["1", "2"]);
    expect(result.games).toHaveLength(6);
    expect(result.games.some((item) => ["5", "6"].includes(item.appId))).toBe(false);
  });

  it("preserves existing dates and history when upgrading the algorithm", () => {
    const today = new Date(2026, 7, 21);
    const first = plan(today, null);
    const stored = createPersonalCalendar({ dayGameIds: first.dayGameIds, storedCalendar: null, cycleStart: today, days });
    stored.algorithmVersion = "daily-v4";
    stored.monthGameIds["2026-07"] = ["100"];
    expect(plan(today, stored).dayGameIds).toEqual(first.dayGameIds);
    const updated = createPersonalCalendar({ dayGameIds: first.dayGameIds, storedCalendar: stored, cycleStart: today, days });
    expect(updated.algorithmVersion).not.toBe("daily-v4");
    expect(updated.monthGameIds["2026-07"]).toEqual(["100"]);
  });

  it("prunes obsolete history across the year boundary", () => {
    const today = new Date(2027, 0, 1);
    const stored = createPersonalCalendar({ dayGameIds: {}, storedCalendar: null, cycleStart: today, days });
    stored.monthGameIds = { "2026-09": ["1"], "2026-10": ["2"], "2026-11": ["3"], "2026-12": ["4"] };
    expect([...getPersonalCalendarRecentGameIds(stored, today)]).toEqual(["3", "4"]);
    const updated = createPersonalCalendar({ dayGameIds: {}, storedCalendar: stored, cycleStart: today, days });
    expect(Object.keys(updated.monthGameIds)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("rejects calendars from another algorithm version or past day", () => {
    const today = new Date(2026, 7, 21);
    const { dayGameIds } = plan(today, null);
    const calendar = createPersonalCalendar({
      dayGameIds,
      storedCalendar: null,
      cycleStart: today,
      days,
    });
    const expected = days * gamesPerDay;

    expect(
      isStoredPersonalCalendarFresh(calendar, expected, new Date(2026, 7, 21, 23).getTime())
    ).toBe(true);
    expect(
      isStoredPersonalCalendarFresh(calendar, expected, new Date(2026, 7, 22, 1).getTime())
    ).toBe(false);
    expect(
      isStoredPersonalCalendarFresh(
        { ...calendar, algorithmVersion: "monthly-v2" },
        expected,
        new Date(2026, 7, 21, 23).getTime()
      )
    ).toBe(false);
  });
});
