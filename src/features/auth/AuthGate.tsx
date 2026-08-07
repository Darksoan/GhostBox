import type { ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { AuthScreen } from "./AuthScreen";
import "./AuthScreen.scss";

/**
 * Everything below this point (AppDataProvider, App, PageRouter) only mounts
 * once there is an authenticated GhostBox account — there is no logged-out
 * browsing mode. Kept as a sibling component (not an early return inside
 * App) so App's own hooks never run before an account exists.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-screen__brand">GhostBox</div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <AuthScreen />;
  }

  return <>{children}</>;
}
