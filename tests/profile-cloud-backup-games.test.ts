import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import type { BackupRecord } from "../src/types";
import {
  createProfileHistoryFallbackGame,
  upsertProfileHistoryGame,
  withBackupRecordLastPlayed,
} from "../src/lib/profileHistoryGames";
import {
  getProfileGameRecognitionOptions,
  isRecognizedSteamProfileGame,
} from "../src/utils/profileAchievements";

function makeRecord(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    title: "REMATCH",
    lastBackupAt: "2026-08-27T21:40:00.000Z",
    lastBackupSuccess: true,
    ...overrides,
  };
}

describe("cloud backup games on the profile", () => {
  it("creates a history entry for a save that exists only in the cloud", () => {
    const fallback = createProfileHistoryFallbackGame("3145", "REMATCH");

    const games = upsertProfileHistoryGame([], fallback);
    expect(games).toHaveLength(1);
    expect(games[0].appId).toBe("3145");
    expect(games[0].title).toBe("REMATCH");
  });

  it("uses the latest backup as last activity when the game has none", () => {
    const fallback = createProfileHistoryFallbackGame("3145", "REMATCH");
    const touched = withBackupRecordLastPlayed(
      fallback,
      makeRecord(),
    );
    expect(touched.lastTimePlayed).toBe("2026-08-27T21:40:00.000Z");
  });

  it("never overwrites a last-played date the game already had", () => {
    const played = {
      ...createProfileHistoryFallbackGame("3145", "REMATCH"),
      lastTimePlayed: "2026-08-01T00:00:00.000Z",
    } as GhostBoxGame;
    expect(withBackupRecordLastPlayed(played, makeRecord())).toBe(played);

    // No dates on the record either — unchanged.
    const untouched = createProfileHistoryFallbackGame("3145", "REMATCH");
    expect(
      withBackupRecordLastPlayed(untouched, makeRecord({ lastBackupAt: "" })),
    ).toBe(untouched);
  });

  it("recognizes cloud-owned games without local Steam signals", () => {
    const fallback = createProfileHistoryFallbackGame("3145", "REMATCH");

    // Steam metrics visible: machine-local games still need signals, but a
    // game the account owns in the cloud must not be dropped.
    expect(
      isRecognizedSteamProfileGame(
        fallback,
        0,
        getProfileGameRecognitionOptions(true, true),
      ),
    ).toBe(true);
    expect(
      getProfileGameRecognitionOptions(true, false).requireSteamSignals,
    ).toBe(true);

    // Steam hidden/disconnected: signals are never required.
    expect(
      getProfileGameRecognitionOptions(false, false).requireSteamSignals,
    ).toBe(false);
    expect(
      isRecognizedSteamProfileGame(
        fallback,
        0,
        getProfileGameRecognitionOptions(false, false),
      ),
    ).toBe(true);
  });
});
