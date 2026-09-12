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
  GhostBoxAccount,
  LoginProvider,
  RecoveryTicket,
} from "../lib/ghostboxApi.types";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  account: GhostBoxAccount | null;
  connections: AccountConnection[];
  linkedSteamId: string | null;
  authenticatedVia: LoginProvider | "password" | null;
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
  /** Signs in through the linked provider. Accounts are created with email and
   * password only, so a provider with no GhostBox account attached rejects
   * with `provider_not_linked` / `steam_not_linked`. */
  loginWithProvider: (provider: LoginProvider) => Promise<void>;
  logout: () => Promise<void>;
  /** Step one of recovery via Steam: the OpenID callback proves the account
   * and the worker answers with a token that can only set a password. */
  startSteamRecovery: () => Promise<RecoveryTicket>;
  /** Step one of recovery via Discord: the bot DMs a one-shot PIN to the
   * Discord linked to the account the identifier names. The answer is uniform
   * whether or not the identifier names an account. */
  startDiscordRecovery: (identifier: string) => Promise<{ ok: boolean }>;
  /** Step two of the Discord recovery: trades the PIN for the recovery token. */
  confirmDiscordRecovery: (identifier: string, code: string) => Promise<RecoveryTicket>;
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
  const [connections, setConnections] = useState<AccountConnection[]>([]);
  const [linkedSteamId, setLinkedSteamId] = useState<string | null>(null);
  const [authenticatedVia, setAuthenticatedVia] = useState<
    LoginProvider | "password" | null
  >(null);
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

  const register = useCallback(
    async (email: string, username: string, password: string, displayName?: string) => {
      const session = await ghostboxApi.registerAccount(email, username, password, displayName);
      if (!session?.account) throw new Error("A sessão não retornou uma conta válida.");
      setAccount(session.account);
      setConnections([]);
      setLinkedSteamId(null);
      setAuthenticatedVia("password");
      setStatus("authenticated");
    },
    []
  );

  const login = useCallback(async (identifier: string, password: string) => {
    const session = await ghostboxApi.loginAccount(identifier, password);
    if (!session?.account) throw new Error("A sessão não retornou uma conta válida.");
    setAccount(session.account);
    setConnections([]);
    setLinkedSteamId(session.steamId ?? null);
    setAuthenticatedVia("password");
    setStatus("authenticated");
    try {
      applyAccount(await ghostboxApi.getAccount());
    } catch {
      // Offline login keeps locally persisted Steam data available.
    }
  }, [applyAccount]);

  const loginWithProvider = useCallback(async (provider: LoginProvider) => {
    const result = await ghostboxApi.loginWithProvider(provider);
    if (!result?.account) throw new Error("A sessão não retornou uma conta válida.");
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
  }, [applyAccount]);

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

  const startSteamRecovery = useCallback(() => ghostboxApi.startSteamRecovery(), []);

  const startDiscordRecovery = useCallback((identifier: string) => {
    return ghostboxApi.startDiscordRecovery(identifier);
  }, []);

  const confirmDiscordRecovery = useCallback((identifier: string, code: string) => {
    return ghostboxApi.confirmDiscordRecovery(identifier, code);
  }, []);

  const completeRecovery = useCallback(
    async (recoveryToken: string, newPassword: string) => {
      const session = await ghostboxApi.completeRecovery(recoveryToken, newPassword);
      if (!session?.account) throw new Error("A sessão não retornou uma conta válida.");
      setAccount(session.account);
      setConnections([]);
      setLinkedSteamId(session.steamId ?? null);
      setAuthenticatedVia(null);
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
      connections,
      linkedSteamId,
      authenticatedVia,
      isAuthModalOpen,
      openAuthModal,
      closeAuthModal,
      register,
      login,
      loginWithProvider,
      logout,
      startSteamRecovery,
      startDiscordRecovery,
      confirmDiscordRecovery,
      completeRecovery,
      changePassword,
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
      register,
      login,
      loginWithProvider,
      logout,
      startSteamRecovery,
      startDiscordRecovery,
      confirmDiscordRecovery,
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
