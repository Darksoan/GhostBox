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
  AccountConnection,
  CloudSessionResult,
  GhostBoxAccount,
  LoginProvider,
  MergePreviewResult,
  ProviderSignupRequired,
} from "../lib/ghostboxApi.types";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  account: GhostBoxAccount | null;
  connections: AccountConnection[];
  linkedSteamId: string | null;
  authenticatedVia: LoginProvider | null;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  /** Signs in through the provider. When the provider owns no account yet,
   * the result is the signup payload (nothing is stored) so the UI can show
   * the one-step signup confirmation instead. */
  loginWithProvider: (provider: LoginProvider) => Promise<CloudSessionResult | ProviderSignupRequired>;
  /** Completes a Discord signup after the browser flow (ticket + username). */
  signupWithProvider: (ticket: string, username: string, displayName?: string) => Promise<void>;
  /** Completes a Steam signup reusing the still-unspent callback URL. */
  signupWithSteam: (
    callbackUrl: string,
    username: string,
    displayName?: string | null,
    avatarUrl?: string | null,
  ) => Promise<void>;
  /** Shows what a confirmed merge would do, spending nothing. */
  previewAccountMerge: (ticket?: string, callbackUrl?: string) => Promise<MergePreviewResult>;
  /** Confirms the merge: the other account is absorbed and deleted. */
  confirmAccountMerge: (ticket?: string, callbackUrl?: string) => Promise<void>;
  /** Deletes the account and everything it owns. */
  deleteAccount: () => Promise<void>;
  logout: () => Promise<void>;
  /** Resolves to the account as the worker now sees it, so a caller that just
   * changed something server-side can branch on the result without waiting for
   * a re-render. */
  refreshAccount: () => Promise<GhostBoxAccount | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applySessionResult(
  result: CloudSessionResult,
  setAccount: (account: GhostBoxAccount) => void,
  setAuthenticatedVia: (provider: LoginProvider) => void,
  setStatus: (status: AuthStatus) => void,
) {
  setAccount(result.account);
  setAuthenticatedVia(result.steamId ? "steam" : "discord");
  setStatus("authenticated");
}

function isSessionResult(
  result: CloudSessionResult | ProviderSignupRequired,
): result is CloudSessionResult {
  return (result as CloudSessionResult).account !== undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<GhostBoxAccount | null>(null);
  const [connections, setConnections] = useState<AccountConnection[]>([]);
  const [linkedSteamId, setLinkedSteamId] = useState<string | null>(null);
  const [authenticatedVia, setAuthenticatedVia] = useState<LoginProvider | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setIsAuthModalOpen(false), []);

  const applyAccount = useCallback(
    (me: Awaited<ReturnType<typeof ghostboxApi.getAccount>>) => {
      if (!me?.account) return false;
      const nextConnections = Array.isArray(me.connections) ? me.connections : [];
      setAccount(me.account);
      setConnections(nextConnections);
      setLinkedSteamId(
        nextConnections.find((connection) => connection.provider === "steam")
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
    setConnections([]);
    setLinkedSteamId(null);
    setAuthenticatedVia(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
    return null;
  }, [applyAccount]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await ghostboxApi.getCloudSession();
      if (cancelled) return;
      if (!session?.token || !session.account) {
        setStatus("anonymous");
        return;
      }
      // Paint instantly from the locally persisted account, then confirm
      // against the worker in the background.
      setAccount(session.account);
      setConnections([]);
      setLinkedSteamId(session.steamId ?? null);
      setAuthenticatedVia(null);
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
        setConnections([]);
        setLinkedSteamId(null);
        setAuthenticatedVia(null);
        setStatus("anonymous");
        await ghostboxApi.signOutCloud();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAccount]);

  const loginWithProvider = useCallback(
    async (provider: LoginProvider) => {
      const result = await ghostboxApi.loginWithProvider(provider);
      if (!isSessionResult(result)) return result;
      setAccount(result.account);
      setConnections([]);
      setLinkedSteamId(result.steamId ?? null);
      setAuthenticatedVia(provider);
      setStatus("authenticated");
      try {
        applyAccount(await ghostboxApi.getAccount());
      } catch {
        // Offline right after signing in: keep the session we just received.
      }
      return result;
    },
    [applyAccount],
  );

  const signupWithProvider = useCallback(
    async (ticket: string, username: string, displayName?: string) => {
      const session = await ghostboxApi.signupWithProvider(ticket, username, displayName);
      if (!session?.account) throw new Error("A sessão não retornou uma conta válida.");
      applySessionResult(session, setAccount, setAuthenticatedVia, setStatus);
      setConnections([]);
      setLinkedSteamId(session.steamId ?? null);
      try {
        applyAccount(await ghostboxApi.getAccount());
      } catch {
        // Offline right after signing up: keep the session we just received.
      }
    },
    [applyAccount],
  );

  const signupWithSteam = useCallback(
    async (callbackUrl: string, username: string, displayName?: string | null, avatarUrl?: string | null) => {
      const session = await ghostboxApi.signupWithSteam(callbackUrl, username, displayName, avatarUrl);
      if (!session?.account) throw new Error("A sessão não retornou uma conta válida.");
      setAccount(session.account);
      setConnections([]);
      setLinkedSteamId(session.steamId ?? null);
      setAuthenticatedVia("steam");
      setStatus("authenticated");
      try {
        applyAccount(await ghostboxApi.getAccount());
      } catch {
        // Offline right after signing up: keep the session we just received.
      }
    },
    [applyAccount],
  );

  const previewAccountMerge = useCallback((ticket?: string, callbackUrl?: string) => {
    return ghostboxApi.previewAccountMerge(ticket, callbackUrl);
  }, []);

  const confirmAccountMerge = useCallback(
    async (ticket?: string, callbackUrl?: string) => {
      const session = await ghostboxApi.confirmAccountMerge(ticket, callbackUrl);
      if (!session?.account) throw new Error("A união não retornou uma conta válida.");
      setAccount(session.account);
      setAuthenticatedVia(null);
      setStatus("authenticated");
      try {
        applyAccount(await ghostboxApi.getAccount());
      } catch {
        // Offline right after merging: keep the session we just received.
      }
    },
    [applyAccount],
  );

  const deleteAccount = useCallback(async () => {
    await ghostboxApi.deleteAccount();
    setAccount(null);
    setConnections([]);
    setLinkedSteamId(null);
    setAuthenticatedVia(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
  }, []);

  const logout = useCallback(async () => {
    // Flip to anonymous first: signOutCloud wipes the account-scoped
    // localStorage, and AppDataProvider (still mounted until the gate closes)
    // has in-flight Steam fetches that would write those keys straight back.
    setAccount(null);
    setConnections([]);
    setLinkedSteamId(null);
    setAuthenticatedVia(null);
    setStatus("anonymous");
    await ghostboxApi.signOutCloud();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      connections,
      linkedSteamId,
      authenticatedVia,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      loginWithProvider,
      signupWithProvider,
      signupWithSteam,
      previewAccountMerge,
      confirmAccountMerge,
      deleteAccount,
      logout,
      refreshAccount,
    }),
    [
      status,
      account,
      connections,
      linkedSteamId,
      authenticatedVia,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      loginWithProvider,
      signupWithProvider,
      signupWithSteam,
      previewAccountMerge,
      confirmAccountMerge,
      deleteAccount,
      logout,
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
