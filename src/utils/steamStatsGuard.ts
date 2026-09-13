import type { GamePlaytimeSnapshot } from "../lib/ghostboxApi.types";

function trimId(value: string | null | undefined) {
  return (value ?? "").trim();
}

/**
 * Whether a Steam profile change should drop the cached account stats.
 * Pure so the boot path (ref seeded from storage) can be unit-tested:
 * a matching ref must NOT clear, otherwise cached playtimes flash to zero.
 */
export function shouldClearSteamAccountStats(
  currentSteamId: string | null | undefined,
  refSteamId: string | null | undefined,
): boolean {
  const steamId = trimId(currentSteamId);
  if (!steamId) return false;
  return trimId(refSteamId) !== steamId;
}

export type SteamStatsStaleCheck = {
  requestedSteamId: string;
  statsSteamId: string;
  currentSteamId: string | null | undefined;
  requestAccountUserId: string | null;
  currentAccountUserId: string | null;
};

/**
 * Whether an async `getSteamAccountStats` response is still safe to apply.
 * Drops late responses after logout (no session), account switch, Steam
 * switch, or ID mismatch — otherwise a slow request repaints the signed-out
 * UI (or the next account) with the previous account's playtimes.
 */
export function shouldApplySteamAccountStats(
  check: SteamStatsStaleCheck,
): boolean {
  const requested = trimId(check.requestedSteamId);
  const statsId = trimId(check.statsSteamId);
  if (!requested || !statsId) return false;
  if (statsId !== requested) return false;
  // Account-scoped cache: never restore it without an active session.
  if (!check.currentAccountUserId) return false;
  // Authenticated request that no longer matches the session → logout/switch.
  if (
    check.requestAccountUserId !== null &&
    check.currentAccountUserId !== check.requestAccountUserId
  ) {
    return false;
  }
  const current = trimId(check.currentSteamId);
  // Empty current profile covers disconnect (stats intentionally kept);
  // a different linked Steam account must not receive these stats.
  if (current && current !== statsId) return false;
  return true;
}

export type PlaytimeStaleCheck = {
  requestedSteamId?: string | null;
  currentSteamId?: string | null;
  requestAccountUserId: string | null;
  currentAccountUserId: string | null;
};

/**
 * Whether an async playtime snapshot is still safe to apply.
 * Local snapshots are device data (usable offline), so unlike account stats
 * they do NOT require a session — only drop authenticated requests whose
 * session changed, or snapshots for a Steam account that is no longer linked.
 */
export function shouldApplyPlaytimeSnapshot(
  check: PlaytimeStaleCheck,
): boolean {
  if (
    check.requestAccountUserId !== null &&
    check.currentAccountUserId !== check.requestAccountUserId
  ) {
    return false;
  }
  const requested = trimId(check.requestedSteamId);
  const current = trimId(check.currentSteamId);
  if (requested && current && current !== requested) return false;
  return true;
}

export type SteamPlaytimeSyncDeps = {
  syncSteamPlaytimes: (
    steamId: string,
  ) => Promise<GamePlaytimeSnapshot | null | undefined>;
  refreshPlaytimes: () => Promise<void>;
  refreshOwned: (steamId: string) => void;
  applySnapshot: (snapshot: GamePlaytimeSnapshot) => void;
  /** Return true when the session/Steam link changed mid-flight. */
  isStale?: () => boolean;
  onSyncError?: (error: unknown) => void;
};

/**
 * Shared Steam playtime sync flow: the owned library (`ownedPlaytimes`)
 * must be refreshed on EVERY path — success with data, empty snapshot, or
 * sync failure — otherwise a fresh login/connection with 0h games or an
 * empty sync leaves every playtime at zero.
 */
export async function runSteamPlaytimeSync(
  steamId: string | null | undefined,
  deps: SteamPlaytimeSyncDeps,
): Promise<void> {
  const id = trimId(steamId);
  if (!id) return;
  try {
    const snapshot = await deps.syncSteamPlaytimes(id);
    if (deps.isStale?.()) return;
    if (snapshot && Object.keys(snapshot).length > 0) {
      deps.applySnapshot(snapshot);
    } else {
      await deps.refreshPlaytimes();
      if (deps.isStale?.()) return;
    }
    deps.refreshOwned(id);
  } catch (error) {
    deps.onSyncError?.(error);
    if (deps.isStale?.()) return;
    await deps.refreshPlaytimes().catch(() => undefined);
    if (deps.isStale?.()) return;
    deps.refreshOwned(id);
  }
}
