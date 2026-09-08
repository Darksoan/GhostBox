import { describe, expect, it } from "vitest";
import { createSeedGame } from "../src/utils/gameSeed";
import {
  createPersonalCalendar,
  getPersonalCalendarExpiry,
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
