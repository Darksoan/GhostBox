import { createContext, useContext, useMemo, type ReactNode } from "react";

const MetricsVisibilityContext = createContext<boolean>(false);

interface MetricsVisibilityProviderProps {
  isAuthenticated: boolean;
  children: ReactNode;
}

/**
 * Whether personal metrics (playtime, achievements) can be shown.
 * Kept as a single stable boolean so consumers like `GameCard` (memoized,
 * rendered in large grids) only re-render on login/logout, not on every
 * playtime/session update that flows through `AppDataContext`.
 */
export function MetricsVisibilityProvider({
  isAuthenticated,
  children,
}: MetricsVisibilityProviderProps) {
  const areMetricsUnlocked = useMemo(
    () => isAuthenticated,
    [isAuthenticated],
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
