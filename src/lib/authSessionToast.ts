import type { AuthStatus } from "../context/AuthContext";

export type SessionToastEvent = "signed-in" | "signed-out";

/**
 * Decides whether an auth status change is worth a toast.
 *
 * Anything leaving "loading" is the app resolving the stored session on boot,
 * not the user acting — announcing it would greet them on every launch.
 */
export function resolveSessionToastEvent(
  previous: AuthStatus,
  next: AuthStatus,
): SessionToastEvent | null {
  if (previous === next || previous === "loading") return null;
  if (next === "authenticated") return "signed-in";
  if (next === "anonymous" && previous === "authenticated") return "signed-out";
  return null;
}
