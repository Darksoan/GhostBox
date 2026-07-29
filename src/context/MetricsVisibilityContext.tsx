import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SteamProfile } from "../types";

const MetricsVisibilityContext = createContext<boolean>(false);

interface MetricsVisibilityProviderProps {
  steamProfile: SteamProfile | null;
  children: ReactNode;
}

/**
 * Whether personal Steam metrics (playtime, achievements) can be shown.
 * Kept as a single stable boolean so consumers like `GameCard` (memoized,
 * rendered in large grids) only re-render on login/logout, not on every
 * playtime/session update that flows through `AppDataContext`.
 */
export function MetricsVisibilityProvider({
  steamProfile,
  children,
}: MetricsVisibilityProviderProps) {
  const areMetricsUnlocked = useMemo(
    () => Boolean(steamProfile?.steamId),
    [steamProfile?.steamId],
  );

  return (
    <MetricsVisibilityContext.Provider value={areMetricsUnlocked}>
      {children}
    </MetricsVisibilityContext.Provider>
  );
}

export function useMetricsUnlocked() {
  return useContext(MetricsVisibilityContext);
}
