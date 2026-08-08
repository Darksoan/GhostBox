import type { ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { AuthScreen } from "./AuthScreen";
import "./AuthScreen.scss";

/**
 * The app below stays mounted at all times. When there is no account the login
 * modal only opens on demand (e.g. the sidebar profile action) sitting on top
 * of the app with a subtle backdrop; clicking outside the card dismisses it and
 * the app keeps navigating.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, isAuthModalOpen } = useAuth();

  return (
    <>
      {children}
      {status !== "authenticated" && isAuthModalOpen ? <AuthScreen /> : null}
    </>
  );
}