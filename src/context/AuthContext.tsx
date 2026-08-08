import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ghostboxApi } from "../lib/ghostboxApi";
import type { GhostBoxAccount } from "../lib/ghostboxApi.types";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  account: GhostBoxAccount | null;
  linkedSteamId: string | null;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  register: (
    email: string,
    username: string,
    password: string,
    displayName?: string
  ) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (identifier: string) => Promise<void>;
  resendVerificationEmail: () => Promise<{ ok: boolean; emailVerified: boolean }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<GhostBoxAccount | null>(null);
  const [linkedSteamId, setLinkedSteamId] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setIsAuthModalOpen(false), []);

  const applyAccount = useCallback(
    (me: Awaited<ReturnType<typeof ghostboxApi.getAccount>>) => {
      if (!me?.account) return false;
      setAccount(me.account);
      setLinkedSteamId(
        me.connections.find((connection) => connection.provider === "steam")
          ?.providerId ?? null,
      );
      setStatus("authenticated");
      return true;
    },
    [],
  );

  const refreshAccount = useCallback(async () => {
    let me: Awaited<ReturnType<typeof ghostboxApi.getAccount>>;
    try {
      me = await ghostboxApi.getAccount();
    } catch {
      // Could not reach the worker (offline, outage). The session may well
      // still be valid, so keep it — signing out here would lock the user out
      // of the whole app over a network blip.
      return;
    }
    if (applyAccount(me)) return;
    // null means the worker itself rejected the token (expired/revoked) —
    // drop it so the gate reverts to the login screen instead of a stuck
    // "authenticated" state pointing at a dead session.
    setAccount(null);
    setLinkedSteamId(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
  }, [applyAccount]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await ghostboxApi.getCloudSession();
      if (cancelled) return;
      if (!session?.token) {
        setStatus("anonymous");
        return;
      }
      // Paint instantly from the locally persisted account, then confirm
      // against the worker in the background.
      setAccount(session.account);
      setStatus("authenticated");
      let me: Awaited<ReturnType<typeof ghostboxApi.getAccount>>;
      try {
        me = await ghostboxApi.getAccount();
      } catch {
        // Offline / worker unreachable: stay on the locally persisted account.
        return;
      }
      if (cancelled) return;
      if (!applyAccount(me)) {
        setAccount(null);
        setLinkedSteamId(null);
        setStatus("anonymous");
        await ghostboxApi.signOutCloud();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAccount]);

  const register = useCallback(
    async (email: string, username: string, password: string, displayName?: string) => {
      const session = await ghostboxApi.registerAccount(email, username, password, displayName);
      setAccount(session.account);
      setLinkedSteamId(null);
      setStatus("authenticated");
    },
    []
  );

  const login = useCallback(async (identifier: string, password: string) => {
    const session = await ghostboxApi.loginAccount(identifier, password);
    setAccount(session.account);
    setStatus("authenticated");
    try {
      applyAccount(await ghostboxApi.getAccount());
    } catch {
      // Offline login keeps locally persisted Steam data available.
    }
  }, [applyAccount]);

  const logout = useCallback(async () => {
    // Flip to anonymous first: signOutCloud wipes the account-scoped
    // localStorage, and AppDataProvider (still mounted until the gate closes)
    // has in-flight Steam fetches that would write those keys straight back.
    setAccount(null);
    setLinkedSteamId(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
  }, []);

  const requestPasswordReset = useCallback(async (identifier: string) => {
    await ghostboxApi.requestPasswordReset(identifier);
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    const result = await ghostboxApi.resendVerificationEmail();
    setAccount((current) =>
      current ? { ...current, emailVerified: result.emailVerified } : current
    );
    return result;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await ghostboxApi.changeAccountPassword(currentPassword, newPassword);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      linkedSteamId,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      register,
      login,
      logout,
      requestPasswordReset,
      resendVerificationEmail,
      changePassword,
      refreshAccount,
    }),
    [
      status,
      account,
      linkedSteamId,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      register,
      login,
      logout,
      requestPasswordReset,
      resendVerificationEmail,
      changePassword,
      refreshAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
