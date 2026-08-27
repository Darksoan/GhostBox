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
import type {
  GhostBoxAccount,
  LoginProvider,
  OAuthSignupPending,
  RecoveryTicket,
} from "../lib/ghostboxApi.types";

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
  /** Resolves to the pending-signup payload when the provider account has no
   * GhostBox account yet; `null` once a session is in place. Steam never
   * returns a payload — it cannot create an account. */
  loginWithProvider: (provider: LoginProvider) => Promise<OAuthSignupPending | null>;
  completeOAuthSignup: (ticket: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Step one of recovery: the provider proves the account. GhostBox sends no
   * email, so this is the only way back into a forgotten password. */
  startRecovery: (provider: LoginProvider) => Promise<RecoveryTicket>;
  /** Step two: sets the new password, signs every other device out, and leaves
   * this one signed in. */
  completeRecovery: (recoveryToken: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Resolves to the account as the worker now sees it, so a caller that just
   * changed something server-side can branch on the result without waiting for
   * a re-render. */
  refreshAccount: () => Promise<GhostBoxAccount | null>;
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
      return null;
    }
    if (applyAccount(me)) return me?.account ?? null;
    // null means the worker itself rejected the token (expired/revoked) —
    // drop it so the gate reverts to the login screen instead of a stuck
    // "authenticated" state pointing at a dead session.
    setAccount(null);
    setLinkedSteamId(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
    return null;
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

  const loginWithProvider = useCallback(async (provider: LoginProvider) => {
    const result = await ghostboxApi.loginWithProvider(provider);
    if ("needsSignup" in result) return result;

    setAccount(result.account);
    setStatus("authenticated");
    try {
      applyAccount(await ghostboxApi.getAccount());
    } catch {
      // Offline right after signing in: keep the session we just received.
    }
    return null;
  }, [applyAccount]);

  const completeOAuthSignup = useCallback(
    async (ticket: string, username: string, password: string) => {
      const session = await ghostboxApi.completeOAuthSignup(ticket, username, password);
      setAccount(session.account);
      setLinkedSteamId(null);
      setStatus("authenticated");
    },
    [],
  );

  const logout = useCallback(async () => {
    // Flip to anonymous first: signOutCloud wipes the account-scoped
    // localStorage, and AppDataProvider (still mounted until the gate closes)
    // has in-flight Steam fetches that would write those keys straight back.
    setAccount(null);
    setLinkedSteamId(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
  }, []);

  const startRecovery = useCallback(async (provider: LoginProvider) => {
    return ghostboxApi.startRecovery(provider);
  }, []);

  const completeRecovery = useCallback(
    async (recoveryToken: string, newPassword: string) => {
      const session = await ghostboxApi.completeRecovery(recoveryToken, newPassword);
      setAccount(session.account);
      setStatus("authenticated");
      try {
        applyAccount(await ghostboxApi.getAccount());
      } catch {
        // Offline right after recovering: keep the session we just received.
      }
    },
    [applyAccount],
  );

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
      loginWithProvider,
      completeOAuthSignup,
      logout,
      startRecovery,
      completeRecovery,
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
      loginWithProvider,
      completeOAuthSignup,
      logout,
      startRecovery,
      completeRecovery,
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
