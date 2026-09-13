import { describe, expect, it, vi } from "vitest";
import {
  runSteamPlaytimeSync,
  shouldApplyPlaytimeSnapshot,
  shouldApplySteamAccountStats,
  shouldClearSteamAccountStats,
} from "../src/utils/steamStatsGuard";

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
