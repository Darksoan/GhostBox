import { describe, expect, it, vi } from "vitest";
import {
  isDegenerateSteamAccountStats,
  runSteamPlaytimeSync,
  shouldApplyPlaytimeSnapshot,
  shouldApplySteamAccountStats,
  shouldClearSteamAccountStats,
  shouldReplaceSteamAccountStats,
} from "../src/utils/steamStatsGuard";
import type { SteamAccountStats } from "../src/types";

function makeStats(overrides: Partial<SteamAccountStats> = {}): SteamAccountStats {
  return {
    steamId: "76561198000000001",
    gamesCount: 12,
    totalPlaytimeMinutes: 600,
    unlockedAchievements: 34,
    totalAchievements: 120,
    perfectGames: 1,
    averageProgress: 28,
    scannedGames: 12,
    pendingGames: 0,
    failedGames: 0,
    fetchedAt: 1_700_000_000,
    private: false,
    hasApiKey: true,
    scanInProgress: false,
    recentAchievements: [],
    ownedPlaytimes: [
      { appId: "730", playtimeForever: 600, rtimeLastPlayed: 1_700_000_000 },
    ],
    achievements: [],
    ...overrides,
  };
}

describe("shouldClearSteamAccountStats", () => {
  it("keeps cached stats on boot when the ref already matches the profile", () => {
    expect(shouldClearSteamAccountStats("76561198000000001", "76561198000000001")).toBe(
      false,
    );
  });

  it("clears stats when the Steam account actually changed", () => {
    expect(shouldClearSteamAccountStats("76561198000000002", "76561198000000001")).toBe(
      true,
    );
  });

  it("does nothing without a linked Steam id", () => {
    expect(shouldClearSteamAccountStats("", "76561198000000001")).toBe(false);
    expect(shouldClearSteamAccountStats(null, "76561198000000001")).toBe(false);
    expect(shouldClearSteamAccountStats(undefined, null)).toBe(false);
  });
});

describe("shouldApplySteamAccountStats", () => {
  const base = {
    requestedSteamId: "76561198000000001",
    statsSteamId: "76561198000000001",
    currentSteamId: "76561198000000001",
    requestAccountUserId: "user-1",
    currentAccountUserId: "user-1",
  };

  it("applies fresh stats for the current session", () => {
    expect(shouldApplySteamAccountStats(base)).toBe(true);
  });

  it("drops late responses after logout", () => {
    expect(
      shouldApplySteamAccountStats({ ...base, currentAccountUserId: null }),
    ).toBe(false);
  });

  it("drops late responses after switching GhostBox accounts", () => {
    expect(
      shouldApplySteamAccountStats({ ...base, currentAccountUserId: "user-2" }),
    ).toBe(false);
  });

  it("drops stats when the linked Steam account changed", () => {
    expect(
      shouldApplySteamAccountStats({
        ...base,
        currentSteamId: "76561198000000002",
      }),
    ).toBe(false);
  });

  it("drops responses whose payload does not match the request", () => {
    expect(
      shouldApplySteamAccountStats({ ...base, statsSteamId: "76561198000000002" }),
    ).toBe(false);
  });

  it("keeps stats after Steam disconnect (profile cleared, session alive)", () => {
    expect(
      shouldApplySteamAccountStats({ ...base, currentSteamId: null }),
    ).toBe(true);
  });
});

describe("shouldApplyPlaytimeSnapshot", () => {
  it("applies snapshots for the current session", () => {
    expect(
      shouldApplyPlaytimeSnapshot({
        requestedSteamId: "76561198000000001",
        currentSteamId: "76561198000000001",
        requestAccountUserId: "user-1",
        currentAccountUserId: "user-1",
      }),
    ).toBe(true);
  });

  it("drops snapshots after switching accounts", () => {
    expect(
      shouldApplyPlaytimeSnapshot({
        requestedSteamId: "76561198000000001",
        currentSteamId: "76561198000000001",
        requestAccountUserId: "user-1",
        currentAccountUserId: "user-2",
      }),
    ).toBe(false);
  });

  it("drops snapshots for a Steam account that is no longer linked", () => {
    expect(
      shouldApplyPlaytimeSnapshot({
        requestedSteamId: "76561198000000001",
        currentSteamId: "76561198000000002",
        requestAccountUserId: "user-1",
        currentAccountUserId: "user-1",
      }),
    ).toBe(false);
  });
});

describe("shouldReplaceSteamAccountStats", () => {
  it("replaces missing current stats with anything non-null", () => {
    expect(shouldReplaceSteamAccountStats(null, makeStats())).toBe(true);
    expect(shouldReplaceSteamAccountStats(undefined, makeStats())).toBe(true);
  });

  it("never regresses populated stats to a degenerate zero-game payload", () => {
    const degenerate = makeStats({
      gamesCount: 0,
      ownedPlaytimes: [],
      unlockedAchievements: 0,
      totalAchievements: 0,
      fetchedAt: 1_800_000_000,
    });
    expect(shouldReplaceSteamAccountStats(makeStats(), degenerate)).toBe(false);
  });

  it("accepts scan-in-progress payloads that still carry the library", () => {
    const scanning = makeStats({
      unlockedAchievements: 0,
      totalAchievements: 0,
      pendingGames: 12,
      scanInProgress: true,
      nextPollAfter: 120,
    });
    expect(shouldReplaceSteamAccountStats(makeStats(), scanning)).toBe(true);
  });

  it("accepts a degenerate payload when there is nothing populated to lose", () => {
    const degenerate = makeStats({ gamesCount: 0, ownedPlaytimes: [] });
    expect(shouldReplaceSteamAccountStats(null, degenerate)).toBe(true);
  });

  it("rejects null payloads", () => {
    expect(shouldReplaceSteamAccountStats(makeStats(), null)).toBe(false);
  });
});

describe("isDegenerateSteamAccountStats", () => {
  it("flags null and zero-game payloads", () => {
    expect(isDegenerateSteamAccountStats(null)).toBe(true);
    expect(isDegenerateSteamAccountStats(undefined)).toBe(true);
    expect(
      isDegenerateSteamAccountStats(makeStats({ gamesCount: 0, ownedPlaytimes: [] })),
    ).toBe(true);
  });

  it("does not flag payloads that carry the library even with zero achievements", () => {
    expect(
      isDegenerateSteamAccountStats(
        makeStats({ unlockedAchievements: 0, totalAchievements: 0 }),
      ),
    ).toBe(false);
  });
});

describe("runSteamPlaytimeSync", () => {
  const snapshot = {
    "730": {
      appId: "730",
      playTimeInMilliseconds: 3_600_000,
      lastTimePlayed: null,
    },
  };

  function makeDeps(overrides: Partial<Parameters<typeof runSteamPlaytimeSync>[1]> = {}) {
    return {
      syncSteamPlaytimes: vi.fn(async () => snapshot),
      refreshPlaytimes: vi.fn(async () => undefined),
      refreshOwned: vi.fn(() => undefined),
      applySnapshot: vi.fn(() => undefined),
      ...overrides,
    };
  }

  it("applies the snapshot and refreshes owned games on success", async () => {
    const deps = makeDeps();
    await runSteamPlaytimeSync("76561198000000001", deps);

    expect(deps.applySnapshot).toHaveBeenCalledWith(snapshot);
    expect(deps.refreshOwned).toHaveBeenCalledWith("76561198000000001");
    expect(deps.refreshPlaytimes).not.toHaveBeenCalled();
  });

  it("refreshes owned games even when the sync snapshot is empty", async () => {
    const deps = makeDeps({ syncSteamPlaytimes: vi.fn(async () => ({})) });
    await runSteamPlaytimeSync("76561198000000001", deps);

    expect(deps.applySnapshot).not.toHaveBeenCalled();
    expect(deps.refreshPlaytimes).toHaveBeenCalledTimes(1);
    expect(deps.refreshOwned).toHaveBeenCalledWith("76561198000000001");
  });

  it("refreshes owned games even when sync throws", async () => {
    const onSyncError = vi.fn();
    const deps = makeDeps({
      syncSteamPlaytimes: vi.fn(async () => {
        throw new Error("proxy down");
      }),
      onSyncError,
    });
    await runSteamPlaytimeSync("76561198000000001", deps);

    expect(onSyncError).toHaveBeenCalledTimes(1);
    expect(deps.refreshPlaytimes).toHaveBeenCalledTimes(1);
    expect(deps.refreshOwned).toHaveBeenCalledWith("76561198000000001");
  });

  it("skips owned refresh when the session changed mid-flight", async () => {
    const deps = makeDeps({ isStale: () => true });
    await runSteamPlaytimeSync("76561198000000001", deps);

    expect(deps.applySnapshot).not.toHaveBeenCalled();
    expect(deps.refreshPlaytimes).not.toHaveBeenCalled();
    expect(deps.refreshOwned).not.toHaveBeenCalled();
  });

  it("ignores blank steam ids", async () => {
    const deps = makeDeps();
    await runSteamPlaytimeSync("   ", deps);

    expect(deps.syncSteamPlaytimes).not.toHaveBeenCalled();
    expect(deps.refreshOwned).not.toHaveBeenCalled();
  });
});
