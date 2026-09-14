import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { GhostBoxGame } from "../data";
import {
  addGameViaLuaTools,
  registerSteamLibraryGame,
  removeGameViaLuaTools,
} from "../data";
import type {
  BackupSettings,
  StartupPage,
  StartupSettings,
  SteamAccountStats,
  SteamLibraryScanResult,
  SteamProfile,
  UserCollection,
} from "../types";
import { ghostboxApi } from "../lib/ghostboxApi";
import { pushAppNotification } from "../lib/appNotifications";
import { isBlockedSteamDemo } from "../utils/steamAppType";
import type {
  CloudSave,
  GamePlaytimeSnapshot,
  SteamPathSelectionResult,
} from "../lib/ghostboxApi.types";
import {
  applyCloudProfileToLocal,
  buildCloudProfileSnapshot,
  isCloudSnapshotNewer,
} from "../lib/cloudProfile";
import {
  haveCollectionGamesChanged,
  rehydrateUserCollectionGames,
} from "../lib/collectionGames";
import {
  formatSteamLoginError,
  isSteamConnected,
  mergeSteamProfile,
} from "../lib/steamProfile";
import { getLatestChangedBackupRecord } from "../lib/backupNotifications";
import { isHiddenLibraryGame } from "../utils/filters";
import {
  runSteamPlaytimeSync,
  shouldApplyPlaytimeSnapshot,
  shouldApplySteamAccountStats,
  shouldClearSteamAccountStats,
} from "../utils/steamStatsGuard";
import {
  buildPremiumBackupNudgeNotification,
  hasSeenPremiumBackupNudge,
  markPremiumBackupNudgeSeen,
} from "../utils/premiumNudge";
import { deleteDownloadTaskFiles, readDownloadTasks } from "../lib/downloadManager";
import { preloadGamePortraitSources } from "../utils/image";
import {
  isSteamTitlePlaceholder,
  normalizeSteamGameTitles,
} from "../utils/steamTitles";
import { UninstallConfirmModal } from "../components/modals/UninstallConfirmModal";

import {
  applyAchievementDetailsToGames,
  mergeSteamAchievementsIntoGame,
  mergeSteamAchievementsIntoGames,
} from "../utils/steamAchievementMerge";
import {
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
  readStoredUserCollections,
  readStoredSteamProfile,
  readStoredSteamAccountStats,
  readStoredStartupPage,
  readStoredShowSteamGames,
  readStoredShowSteamLibraryGames,
  readStoredHiddenProfileGameIds,
  readStoredCloudProfileUpdatedAt,
  readStoredAutoRestoredCloudSaves,
  writeStoredAutoRestoredCloudSaves,
  writeStoredFavoriteGames,
  writeStoredProfileHistoryGames,
  writeStoredUserCollections,
  writeStoredSteamProfile,
  writeStoredSteamAccountStats,
  writeStoredStartupPage,
  writeStoredShowSteamGames,
  writeStoredShowSteamLibraryGames,
  writeStoredHiddenProfileGameIds,
  writeStoredCloudProfileUpdatedAt,
} from "../utils/storage";
import {
  loadGameAchievementDetailsCached,
  loadGameDetailsCached,
} from "../utils/gameCache";
import {
  createProfileHistoryFallbackGame,
  getBackupRecordLatestKey,
  mergeGameDetailsPreservingAchievements,
  mergeBackupAchievementsIntoGame,
  withBackupRecordLastPlayed,
  upsertProfileHistoryGame,
} from "../lib/profileHistoryGames";
import { useOverlay } from "./OverlayContext";
import { useSettings } from "./settings";
import { useAuth } from "./AuthContext";

type InitialLoadStep =
  | "backupRoot"
  | "morrenusApiKey"
  | "playtimes"
  | "startupSettings"
  | "steamLibrary"
  | "steamProfile";

const initialLoadSteps: InitialLoadStep[] = [
  "startupSettings",
  "steamProfile",
  "morrenusApiKey",
];

const initialLoadStepSet = new Set<InitialLoadStep>(initialLoadSteps);

function cloudSaveTimestamp(save: CloudSave): number {
  const parsed = Date.parse(save.updatedAt || save.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

const defaultBackupSettings: BackupSettings = {
  outputPath: "",
  automaticBackupsForLibrary: false,
  automaticBackups: {},
  backupRecords: {},
};

function upsertLibraryGameByAppId(
  games: GhostBoxGame[],
  nextGame: GhostBoxGame,
) {
  return [nextGame, ...games.filter((game) => game.appId !== nextGame.appId)];
}

function removeLibraryGameByAppId(games: GhostBoxGame[], appId: string) {
  return games.filter((game) => game.appId !== appId);
}

/**
 * Remove marcas de terceiros das mensagens exibidas no launcher.
 * Os comandos Tauri (`luatools_*`) e o campo `api: "LuaTools"` são mantidos —
 * aqui só passa o texto que chega em `showToast` / notificações.
 */
function sanitizeDependencyMessage(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value
    .replace(
      /LuaTools e BetterSteamTools já estão prontos\./gi,
      "As dependências já estão prontas.",
    )
    .replace(
      /LuaTools e BetterSteamTools foram instalados com sucesso\./gi,
      "As dependências foram instaladas com sucesso.",
    )
    .replace(
      /A instalação automática do LuaTools está disponível apenas no Windows\./gi,
      "A instalação automática das dependências está disponível apenas no Windows.",
    )
    .replace(
      /Não foi possível localizar LOCALAPPDATA para instalar LuaTools\./gi,
      "Não foi possível localizar a pasta de instalação das dependências.",
    )
    .replace(
      /O pacote LuaTools não continha LuaTools\.exe\./gi,
      "O pacote de dependências estava incompleto.",
    )
    .replace(
      /Release do LuaTools não contém pacote instalável\./gi,
      "A versão disponível não contém pacote instalável.",
    )
    .replace(
      /O pacote BetterSteamTools não continha .+\./gi,
      "O pacote de dependências estava incompleto.",
    )
    .replace(
      /Release do BetterSteamTools não contém pacote Release\./gi,
      "A versão disponível não contém pacote instalável.",
    )
    .replace(
      /Não foi possível preparar o LuaTools/gi,
      "Não foi possível preparar as dependências",
    )
    .replace(/\bBetterSteamTools\b/gi, "dependências")
    .replace(/\bLuaTools\.exe\b/gi, "dependências")
    .replace(/\bLuaTools\b/gi, "dependências");
}

async function resolveCloudGames(
  gameIds: string[],
  knownGames: GhostBoxGame[],
) {
  const gamesById = new Map(knownGames.map((game) => [game.id, game]));
  const missingIds = gameIds.filter((gameId) => !gamesById.has(gameId));
  const batchSize = 8;

  for (let index = 0; index < missingIds.length; index += batchSize) {
    const loaded = await Promise.all(
      missingIds
        .slice(index, index + batchSize)
        // A game that no longer resolves must not sink the whole restore:
        // the caller also depends on this for the profile images.
        .map((gameId) => loadGameDetailsCached(gameId).catch(() => null)),
    );
    for (const game of loaded) {
      if (game) gamesById.set(game.id, game);
    }
  }

  return { gamesById, games: Array.from(gamesById.values()) };
}

function resolvePlaytimeAppId(game: GhostBoxGame) {
  const appId = (game.appId || "").trim();
  if (/^\d+$/.test(appId)) return appId;
  const fromId = game.id.replace(/^steam-/, "").trim();
  return /^\d+$/.test(fromId) ? fromId : appId;
}

function applyPlaytimeToGame(
  game: GhostBoxGame,
  snapshot: GamePlaytimeSnapshot,
): GhostBoxGame {
  const appId = resolvePlaytimeAppId(game);
  const playtime = snapshot[appId] ?? snapshot[game.appId];
  if (!playtime) {
    return { ...game, sessionActive: false };
  }

  return {
    ...game,
    playTimeInMilliseconds: playtime.playTimeInMilliseconds,
    lastTimePlayed: playtime.lastTimePlayed ?? game.lastTimePlayed,
    lastSessionRecordedAt:
      playtime.lastSessionRecordedAt ?? game.lastSessionRecordedAt,
    lastSessionDurationInMilliseconds:
      playtime.lastSessionDurationInMilliseconds ??
      game.lastSessionDurationInMilliseconds,
    sessionActive: playtime.sessionActive === true,
  };
}

function applyPlaytimeSnapshotToGames(
  games: GhostBoxGame[],
  snapshot: GamePlaytimeSnapshot,
) {
  let changed = false;
  const hasSteamData = Object.keys(snapshot).length > 0;

  const nextGames = games.map((game) => {
    const appId = resolvePlaytimeAppId(game);
    const playtime = snapshot[appId] ?? snapshot[game.appId];

    if (!playtime) {
      if (!hasSteamData) {
        if (game.sessionActive === false) return game;
        changed = true;
        return { ...game, sessionActive: false };
      }
      const alreadyCleared =
        (game.playTimeInMilliseconds ?? 0) === 0 &&
        game.sessionActive === false;
      if (alreadyCleared) return game;
      changed = true;
      return {
        ...game,
        playTimeInMilliseconds: 0,
        sessionActive: false,
      };
    }

    const nextSessionActive = playtime.sessionActive === true;
    const isSame =
      game.playTimeInMilliseconds === playtime.playTimeInMilliseconds &&
      game.lastTimePlayed === playtime.lastTimePlayed &&
      game.lastSessionRecordedAt === playtime.lastSessionRecordedAt &&
      game.lastSessionDurationInMilliseconds ===
        playtime.lastSessionDurationInMilliseconds &&
      game.sessionActive === nextSessionActive;

    if (isSame) return game;

    changed = true;
    return {
      ...game,
      playTimeInMilliseconds: playtime.playTimeInMilliseconds,
      lastTimePlayed: playtime.lastTimePlayed ?? game.lastTimePlayed,
      lastSessionRecordedAt:
        playtime.lastSessionRecordedAt ?? game.lastSessionRecordedAt,
      lastSessionDurationInMilliseconds:
        playtime.lastSessionDurationInMilliseconds ??
        game.lastSessionDurationInMilliseconds,
      sessionActive: nextSessionActive,
    };
  });

  return changed ? nextGames : games;
}

function collectActiveSessionAppIds(snapshot: GamePlaytimeSnapshot) {
  return new Set(
    Object.values(snapshot)
      .filter((entry) => entry.sessionActive === true)
      .map((entry) => entry.appId),
  );
}

interface AppDataContextValue {
  isInitialLoading: boolean;
  initialLoadingProgress: number;
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  userCollections: UserCollection[];
  steamProfile: SteamProfile | null;
  isCloudProfileRestoring: boolean;
  isSteamSigningIn: boolean;
  isScanningSteamLibrary: boolean;
  addingGameId: string | null;
  removingGameId: string | null;
  launchingGameId: string | null;
  activeSessionAppIds: Set<string>;
  favoriteGameIds: Set<string>;
  addedLibraryGameAppIds: Set<string>;
  availableLibraryGameAppIds: Set<string>;
  playableGameAppIds: Set<string>;
  installedSteamGameAppIds: Set<string>;
  backupSettings: BackupSettings | null;
  morrenusApiKey: string;
  startupSettings: StartupSettings | null;
  initialPage: StartupPage;
  steamPathInput: string;
  showSteamGames: boolean;
  showSteamLibraryGames: boolean;
  hiddenProfileGameIds: Set<string>;
  steamAccountStats: SteamAccountStats | null;
  /** App ids the account has a cloud save for — the GhostBox-owned game set. */
  cloudSaveAppIds: Set<string>;
  profileHistoryGames: GhostBoxGame[];
  profileFavoriteGames: GhostBoxGame[];
  profileAddedLibraryGames: GhostBoxGame[];
  handleGameDetailsLoaded: (details: GhostBoxGame) => void;
  /**
   * Recheck leve do hover da capa: busca os detalhes de conquistas do jogo,
   * funde com as conquistas da conta e espalha pelas listas locais para o
   * badge atualizar sem abrir o modal. Dedupe por appId + versão das stats.
   */
  refreshGameAchievements: (game: GhostBoxGame) => void;
  toggleFavoriteGame: (game: GhostBoxGame) => void;
  queueGame: (game: GhostBoxGame) => Promise<void>;
  removeQueuedGame: (game: GhostBoxGame) => Promise<void>;
  /** Shows confirmation modal; also offers to delete local files when available. */
  requestRemoveGame: (game: GhostBoxGame) => void;
  /** Removes from library AND deletes local install files (GhostBox CDN only). */
  uninstallGame: (game: GhostBoxGame) => Promise<void>;

  handlePlayGame: (game: GhostBoxGame) => Promise<void>;
  setCustomExeGame: (
    game: GhostBoxGame,
    customExePath: string,
    launchArguments?: string,
    options?: { showSuccessToast?: boolean },
  ) => Promise<GhostBoxGame | null>;
  addGameToUserCollection: (game: GhostBoxGame, collectionId: string) => void;
  removeGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
  deleteCollection: (collectionId: string) => void;
  createUserCollection: (name: string) => void;
  openCreateUserCollectionModal: () => void;
  handleConnectSteam: () => Promise<void>;
  handleDisconnectSteam: () => Promise<void>;
  handleRestartSteam: () => Promise<void>;
  handleUpdateProfile: (
    displayName: string,
    avatarUrl: string,
    bannerUrl: string,
    bannerPosition: NonNullable<SteamProfile["bannerPosition"]>,
  ) => Promise<void>;
  setBackupSettings: (settings: BackupSettings | null) => void;
  setMorrenusApiKey: (key: string) => void;
  setInitialPage: Dispatch<SetStateAction<StartupPage>>;
  setSteamPathInput: (path: string) => void;
  setShowSteamGames: (value: boolean) => void;
  setShowSteamLibraryGames: (value: boolean) => void;
  setProfileGameHidden: (appId: string, hidden: boolean) => void;
  handleStartupSettingsChange: (
    settings: Partial<StartupSettings>,
  ) => Promise<void>;
  handleMorrenusApiKeySave: (key: string) => Promise<void>;
  handleSelectSteamPath: () => Promise<void>;
  /** `false` quando o path não serve — o modal deve continuar aberto. */
  handleSubmitSteamPath: (steamPath: string) => Promise<boolean>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(
  undefined,
);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { showToast, showAchievementToast, setCollectionModalOpen } = useOverlay();
  const { appearance, notifications, t } = useSettings();
  const { account, linkedSteamId, refreshAccount } = useAuth();
  const accountUserId = account?.userId ?? null;

  const [favoriteGames, setFavoriteGames] = useState<GhostBoxGame[]>(() =>
    readStoredFavoriteGames(),
  );
  const [addedLibraryGames, setAddedLibraryGames] = useState<GhostBoxGame[]>(
    [],
  );
  const [scannedLibraryGames, setScannedLibraryGames] = useState<GhostBoxGame[]>(
    [],
  );
  const [userCollections, setUserCollections] = useState<UserCollection[]>(() =>
    readStoredUserCollections(),
  );
  const [steamProfile, setSteamProfile] = useState<SteamProfile | null>(() =>
    readStoredSteamProfile(),
  );
  const [isCloudProfileRestoring, setIsCloudProfileRestoring] = useState(() =>
    Boolean(readStoredSteamProfile()?.steamId),
  );
  const [isSteamSigningIn, setIsSteamSigningIn] = useState(false);
  const [isScanningSteamLibrary, setIsScanningSteamLibrary] = useState(false);
  const [addingGameId, setAddingGameId] = useState<string | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [launchingGameId, setLaunchingGameId] = useState<string | null>(null);
  const [activeSessionAppIds, setActiveSessionAppIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [addedLibraryGameAppIds, setAddedLibraryGameAppIds] = useState<
    Set<string>
  >(() => new Set());
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(
    defaultBackupSettings,
  );
  const [morrenusApiKey, setMorrenusApiKey] = useState("");
  const [startupSettings, setStartupSettings] =
    useState<StartupSettings | null>(null);
  const [initialPage, setInitialPage] = useState<StartupPage>(
    () => readStoredStartupPage() ?? "home",
  );
  const [steamPathInput, setSteamPathInput] = useState(
    "C:\\Program Files (x86)\\Steam",
  );
  const [showSteamGames, _setShowSteamGames] = useState<boolean>(() =>
    readStoredShowSteamGames(),
  );

  const setShowSteamGames = useCallback((value: boolean) => {
    _setShowSteamGames(value);
    writeStoredShowSteamGames(value);
  }, []);
  const [showSteamLibraryGames, _setShowSteamLibraryGames] = useState<boolean>(
    () => readStoredShowSteamLibraryGames(),
  );

  const setShowSteamLibraryGames = useCallback((value: boolean) => {
    _setShowSteamLibraryGames(value);
    writeStoredShowSteamLibraryGames(value);
  }, []);
  const [hiddenProfileGameIds, setHiddenProfileGameIds] = useState<Set<string>>(
    () => new Set(readStoredHiddenProfileGameIds()),
  );
  const [steamAccountStats, setSteamAccountStats] =
    useState<SteamAccountStats | null>(() => readStoredSteamAccountStats());
  // Inicializa o ref com o mesmo valor do storage: começar como `null`
  // fazia o efeito de troca de conta apagar o cache válido no boot,
  // zerando o tempo de jogo até o próximo fetch (que pode falhar).
  const steamAccountStatsRef =
    useRef<SteamAccountStats | null>(steamAccountStats);
  const [cloudSaveAppIds, setCloudSaveAppIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const backupSettingsRef = useRef<BackupSettings | null>(
    defaultBackupSettings,
  );
  const steamProfileRequestSequenceRef = useRef(0);
  const gamePlaytimesRef = useRef<GamePlaytimeSnapshot>({});
  const cloudProfileSyncTimerRef = useRef<number | null>(null);
  const cloudProfileSyncInFlightRef = useRef(false);
  const cloudProfilePendingUploadRef = useRef(false);
  const cloudProfileRestoreInFlightRef = useRef(false);
  const cloudProfileRestoreRetryTimerRef = useRef<number | null>(null);
  const appliedProfileBackupKeysRef = useRef<Map<string, string>>(new Map());
  // appId -> cloud save id already auto-restored on this machine.
  const autoRestoredCloudSaveIdsRef = useRef<Record<string, string>>(
    readStoredAutoRestoredCloudSaves(),
  );
  const autoRestoreInFlightAppIdsRef = useRef<Set<string>>(new Set());
  const skipCloudProfileUploadCountRef = useRef(0);
  const cloudProfileLocalUpdatedAtRef = useRef<string | null>(
    readStoredCloudProfileUpdatedAt(),
  );
  const steamProfileRef = useRef<SteamProfile | null>(steamProfile);
  const userCollectionsRef = useRef<UserCollection[]>(userCollections);
  const favoriteGamesRef = useRef<GhostBoxGame[]>(favoriteGames);
  const addedLibraryGamesRef = useRef<GhostBoxGame[]>(addedLibraryGames);
  const [profileHistoryGames, setProfileHistoryGames] = useState<
    GhostBoxGame[]
  >(() => readStoredProfileHistoryGames());
  const profileHistoryGamesRef = useRef<GhostBoxGame[]>(profileHistoryGames);
  const cloudProfileBootstrappedRef = useRef(false);
  // The cloud profile is keyed by the GhostBox account, not by Steam, so the
  // "already restored" marker is the account id. Steam is only a source of
  // metrics and library data on top of it.
  const cloudProfileRestoredUserIdRef = useRef<string | null>(null);
  const accountUserIdRef = useRef<string | null>(accountUserId);
  const cloudProfileFavoriteGameIdsRef = useRef<string[]>([]);
  const hiddenProfileGameIdsRef = useRef(hiddenProfileGameIds);
  const [cloudProfileRestoreRetryTick, setCloudProfileRestoreRetryTick] =
    useState(0);
  const [completedInitialLoadSteps, setCompletedInitialLoadSteps] = useState<
    Set<InitialLoadStep>
  >(() => new Set());

  const markInitialLoadStepComplete = useCallback((step: InitialLoadStep) => {
    if (!initialLoadStepSet.has(step)) return;

    setCompletedInitialLoadSteps((current) => {
      if (current.has(step)) return current;
      return new Set(current).add(step);
    });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCompletedInitialLoadSteps((current) => {
        if (current.size >= initialLoadSteps.length) return current;
        const next = new Set(current);
        for (const step of initialLoadSteps) next.add(step);
        return next;
      });
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, []);

  const initialLoadingProgress = Math.round(
    (completedInitialLoadSteps.size / initialLoadSteps.length) * 100,
  );
  const isInitialLoading =
    completedInitialLoadSteps.size < initialLoadSteps.length;

  const mergeGamePlaytime = useCallback((game: GhostBoxGame): GhostBoxGame => {
    return applyPlaytimeToGame(game, gamePlaytimesRef.current);
  }, []);

  const refreshSteamOwnedLibraryGames = useCallback(
    async (steamId?: string | null) => {
      const id = steamId?.trim();
      if (!id) return;
      const requestAccountUserId = accountUserIdRef.current;

      const stats = await ghostboxApi.getSteamAccountStats(id).catch(() => null);
      if (!stats) return;
      // Late responses must not repaint a signed-out UI or the next account
      // with the previous account's playtimes (logout/switch/disconnect race).
      if (
        !shouldApplySteamAccountStats({
          requestedSteamId: id,
          statsSteamId: stats.steamId,
          currentSteamId: steamProfileRef.current?.steamId,
          requestAccountUserId,
          currentAccountUserId: accountUserIdRef.current,
        })
      ) {
        return;
      }
      if (
        !steamAccountStatsRef.current ||
        stats.steamId !== steamAccountStatsRef.current.steamId ||
        stats.fetchedAt >= steamAccountStatsRef.current.fetchedAt
      ) {
        steamAccountStatsRef.current = stats;
        setSteamAccountStats(stats);
        writeStoredSteamAccountStats(stats);
      }
    },
    [],
  );

  const refreshGamePlaytimes = useCallback(async () => {
    const requestAccountUserId = accountUserIdRef.current;
    let snapshot: GamePlaytimeSnapshot;
    try {
      snapshot = await ghostboxApi.getGamePlaytimes();
    } catch (error) {
      console.warn(
        "[GhostBox] Failed to load cached playtimes; keeping existing snapshot.",
        error,
      );
      snapshot = gamePlaytimesRef.current;
    }
    if (
      !shouldApplyPlaytimeSnapshot({
        requestAccountUserId,
        currentAccountUserId: accountUserIdRef.current,
      })
    ) {
      return;
    }
    gamePlaytimesRef.current = snapshot;
    setActiveSessionAppIds(collectActiveSessionAppIds(snapshot));
    setFavoriteGames((current) =>
      applyPlaytimeSnapshotToGames(current, snapshot),
    );
    setAddedLibraryGames((current) =>
      applyPlaytimeSnapshotToGames(current, snapshot),
    );
    setProfileHistoryGames((current) =>
      applyPlaytimeSnapshotToGames(current, snapshot),
    );
  }, []);

  const syncPlaytimesFromSteam = useCallback(
    async (steamId?: string | null) => {
      const id = steamId?.trim();
      if (!id) return;
      const requestAccountUserId = accountUserIdRef.current;
      const isStale = () =>
        !shouldApplyPlaytimeSnapshot({
          requestedSteamId: id,
          currentSteamId: steamProfileRef.current?.steamId,
          requestAccountUserId,
          currentAccountUserId: accountUserIdRef.current,
        });
      await runSteamPlaytimeSync(id, {
        syncSteamPlaytimes: (targetId) =>
          ghostboxApi.syncSteamPlaytimes(targetId),
        refreshPlaytimes: () => refreshGamePlaytimes(),
        refreshOwned: (targetId) => {
          void refreshSteamOwnedLibraryGames(targetId);
        },
        applySnapshot: (snapshot) => {
          gamePlaytimesRef.current = snapshot;
          setActiveSessionAppIds(collectActiveSessionAppIds(snapshot));
          setFavoriteGames((current) =>
            applyPlaytimeSnapshotToGames(current, snapshot),
          );
          setAddedLibraryGames((current) =>
            applyPlaytimeSnapshotToGames(current, snapshot),
          );
          setProfileHistoryGames((current) =>
            applyPlaytimeSnapshotToGames(current, snapshot),
          );
        },
        isStale,
        onSyncError: (error) => {
          console.warn(
            "[GhostBox] Steam playtime sync failed; showing last cached playtimes instead.",
            error,
          );
        },
      });
    },
    [refreshGamePlaytimes, refreshSteamOwnedLibraryGames],
  );

  useEffect(() => {
    return ghostboxApi.onGamePlaytimesChanged((snapshot) => {
      gamePlaytimesRef.current = snapshot;
      setActiveSessionAppIds(collectActiveSessionAppIds(snapshot));
      setFavoriteGames((current) =>
        applyPlaytimeSnapshotToGames(current, snapshot),
      );
      setAddedLibraryGames((current) =>
        applyPlaytimeSnapshotToGames(current, snapshot),
      );
      setProfileHistoryGames((current) =>
        applyPlaytimeSnapshotToGames(current, snapshot),
      );
    });
  }, []);

  useEffect(() => {
    backupSettingsRef.current = backupSettings;
  }, [backupSettings]);

  const previousAccountUserIdRef = useRef<string | null>(accountUserId);

  useEffect(() => {
    const previousAccountUserId = previousAccountUserIdRef.current;
    accountUserIdRef.current = accountUserId;
    previousAccountUserIdRef.current = accountUserId;
    // First run (null -> id) is the app booting into a stored session: the
    // local data belongs to that account and must survive.
    if (!previousAccountUserId || previousAccountUserId === accountUserId) {
      return;
    }

    // Signing out wipes the account-scoped localStorage, but this provider
    // stays mounted the whole time. Without dropping the in-memory copy too,
    // the next sign-in still sees the previous account's profile and cloud
    // bookkeeping, so the restore concludes the local data is already current
    // and never brings the avatar and banner back down.
    skipCloudProfileUploadCountRef.current = 2;
    // Invalidate any Steam profile request still in flight (connect, linked
    // restore, boot hydration): without this its write lands after the wipe
    // below and repaints the signed-out sidebar with the previous profile.
    steamProfileRequestSequenceRef.current += 1;
    steamProfileRef.current = null;
    setSteamProfile(null);
    setFavoriteGames([]);
    setUserCollections([]);
    setProfileHistoryGames([]);
    steamAccountStatsRef.current = null;
    setSteamAccountStats(null);
    cloudProfileFavoriteGameIdsRef.current = [];
    cloudProfileLocalUpdatedAtRef.current = null;
    cloudProfilePendingUploadRef.current = false;
    cloudProfileRestoredUserIdRef.current = null;
  }, [accountUserId]);

  useEffect(() => {
    steamProfileRef.current = steamProfile;
    if (
      shouldClearSteamAccountStats(
        steamProfile?.steamId,
        steamAccountStatsRef.current?.steamId,
      )
    ) {
      setSteamAccountStats(null);
      steamAccountStatsRef.current = null;
      writeStoredSteamAccountStats(null);
    }
  }, [steamProfile]);

  // Guarda do recheck de conquistas no hover: um request por appId por vez
  // (hover/focus disparam juntos) e um refresh por versão das stats da conta.
  const achievementHoverInFlightRef = useRef(new Set<string>());
  const achievementHoverRefreshedRef = useRef(new Set<string>());

  useEffect(() => {
    steamAccountStatsRef.current = steamAccountStats;
    // Stats novas podem trazer desbloqueios que o último refresh não viu.
    achievementHoverRefreshedRef.current.clear();
  }, [steamAccountStats]);

  useEffect(() => {
    const steamId = steamProfile?.steamId?.trim();
    if (!steamId) return;

    let cancelled = false;
    let pollTimer: number | undefined;
    const applyStats = (stats: SteamAccountStats) => {
      if (cancelled) return;
      const current = steamAccountStatsRef.current;
      if (
        current?.steamId === stats.steamId &&
        current.fetchedAt > stats.fetchedAt
      ) {
        return;
      }
      steamAccountStatsRef.current = stats;
      setSteamAccountStats(stats);
      writeStoredSteamAccountStats(stats);
    };

    const schedulePoll = (
      stats?: SteamAccountStats | null,
      retryDelaySeconds?: number,
    ) => {
      if (cancelled) return;
      const needsPoll =
        retryDelaySeconds !== undefined ||
        !stats ||
        stats.scanInProgress ||
        stats.pendingGames > 0 ||
        (stats.nextPollAfter ?? 0) > 0;
      if (!needsPoll) {
        if (pollTimer !== undefined) window.clearTimeout(pollTimer);
        pollTimer = undefined;
        return;
      }
      const requestedDelay =
        ((retryDelaySeconds ?? stats?.nextPollAfter) || 60) * 1_000;
      const delay = Math.max(30_000, Math.min(requestedDelay, 24 * 60 * 60_000));
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => {
        pollTimer = undefined;
        void refreshStats();
      }, delay);
    };

    const refreshStats = () =>
      ghostboxApi
        .getSteamAccountStats(steamId)
        .then((stats) => {
          if (stats) applyStats(stats);
          schedulePoll(stats);
        })
        .catch(() => schedulePoll(steamAccountStatsRef.current, 5 * 60));

    void refreshStats();

    const unlisten = ghostboxApi.onSteamAccountStatsUpdated((stats) => {
      if (stats.steamId === steamId) {
        applyStats(stats);
        schedulePoll(stats);
      }
    });

    return () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      unlisten();
    };
  }, [steamProfile?.steamId]);

  useEffect(() => {
    userCollectionsRef.current = userCollections;
  }, [userCollections]);

  useEffect(() => {
    favoriteGamesRef.current = favoriteGames;
  }, [favoriteGames]);

  useEffect(() => {
    addedLibraryGamesRef.current = addedLibraryGames;
  }, [addedLibraryGames]);

  useEffect(() => {
    profileHistoryGamesRef.current = profileHistoryGames;
  }, [profileHistoryGames]);

  const applyBackupAchievementsToProfileHistory = useCallback(
    async (game: GhostBoxGame, backupPath?: string | null) => {
      // Local details may not exist (backup made on another machine, moved
      // outputPath, deleted file) — `backup_get_details` returns null then.
      // The game still belongs to the profile because its save lives in the
      // cloud, so it must enter the history even without achievements to merge.
      const backupDetails = await ghostboxApi
        .getBackupDetails(game.appId, backupPath)
        .catch(() => null);

      const trackedGame = backupDetails?.achievements.length
        ? mergeBackupAchievementsIntoGame(game, backupDetails)
        : game;

      setProfileHistoryGames((current) =>
        upsertProfileHistoryGame(current, trackedGame),
      );
    },
    [],
  );

  const rehydrateCollectionGames = useCallback(
    (
      collections: UserCollection[],
      extraGames: GhostBoxGame[] = [],
    ): UserCollection[] => {
      return rehydrateUserCollectionGames(collections, [
        ...favoriteGamesRef.current,
        ...addedLibraryGamesRef.current,
        ...profileHistoryGamesRef.current,
        ...extraGames,
      ]);
    },
    [],
  );

  const markCloudProfileLocalUpdated = useCallback(
    (iso = new Date().toISOString()) => {
      cloudProfileLocalUpdatedAtRef.current = iso;
      writeStoredCloudProfileUpdatedAt(iso);
      return iso;
    },
    [],
  );

  const hasPremiumCloudProfileAccess = useCallback(async () => {
    const session = await ghostboxApi.getCloudSession();
    if (!session?.token) return false;

    return ghostboxApi.isPremiumUser();
  }, []);

  const pushCloudProfileSnapshot = useCallback(async () => {
    if (cloudProfileSyncInFlightRef.current) {
      cloudProfilePendingUploadRef.current = true;
      return;
    }
    if (cloudProfileRestoreInFlightRef.current) {
      cloudProfilePendingUploadRef.current = true;
      return;
    }
    // Account, not Steam: the worker keys the snapshot by user_id, so an
    // account with no Steam connected still has a profile worth syncing.
    if (!accountUserIdRef.current) return;
    const profile = steamProfileRef.current;

    cloudProfileSyncInFlightRef.current = true;
    try {
      if (!(await hasPremiumCloudProfileAccess())) return;

      const updatedAt =
        cloudProfileLocalUpdatedAtRef.current || markCloudProfileLocalUpdated();
      let cloudProfile = profile;
      if (cloudProfile && /^data:/i.test(cloudProfile.avatarUrl || "")) {
        const uploaded = await ghostboxApi.uploadProfileImage(
          cloudProfile.avatarUrl || "",
          "avatar",
        );
        if (!uploaded) return;
        cloudProfile = { ...cloudProfile, avatarUrl: uploaded };
      }
      if (cloudProfile && /^data:/i.test(cloudProfile.bannerUrl || "")) {
        const uploaded = await ghostboxApi.uploadProfileImage(
          cloudProfile.bannerUrl || "",
          "banner",
        );
        if (!uploaded) return;
        cloudProfile = { ...cloudProfile, bannerUrl: uploaded };
      }
      const snapshot = buildCloudProfileSnapshot({
        updatedAt,
        steamProfile: cloudProfile,
        favoriteGames: favoriteGamesRef.current,
        favoriteGameIds: cloudProfileFavoriteGameIdsRef.current,
        hiddenProfileGameIds: [...hiddenProfileGameIdsRef.current],
        userCollections: userCollectionsRef.current,
      });
      const saved = await ghostboxApi.saveCloudProfileSnapshot(snapshot);
      if (saved?.updatedAt) {
        cloudProfileLocalUpdatedAtRef.current = saved.updatedAt;
        writeStoredCloudProfileUpdatedAt(saved.updatedAt);
      }
    } catch {
    } finally {
      cloudProfileSyncInFlightRef.current = false;
      if (
        cloudProfilePendingUploadRef.current &&
        !cloudProfileRestoreInFlightRef.current
      ) {
        cloudProfilePendingUploadRef.current = false;
        window.setTimeout(() => void pushCloudProfileSnapshot(), 0);
      }
    }
  }, [hasPremiumCloudProfileAccess, markCloudProfileLocalUpdated]);

  const scheduleCloudProfileSync = useCallback(() => {
    if (skipCloudProfileUploadCountRef.current > 0) {
      skipCloudProfileUploadCountRef.current -= 1;
      return;
    }
    if (!accountUserIdRef.current) return;
    if (cloudProfileRestoreInFlightRef.current) {
      cloudProfilePendingUploadRef.current = true;
      return;
    }
    markCloudProfileLocalUpdated();
    if (cloudProfileSyncTimerRef.current !== null) {
      window.clearTimeout(cloudProfileSyncTimerRef.current);
    }
    cloudProfileSyncTimerRef.current = window.setTimeout(() => {
      cloudProfileSyncTimerRef.current = null;
      void pushCloudProfileSnapshot();
    }, 1500);
  }, [markCloudProfileLocalUpdated, pushCloudProfileSnapshot]);

  const setProfileGameHidden = useCallback(
    (appId: string, hidden: boolean) => {
      const normalized = appId.trim();
      if (!normalized) return;
      const current = hiddenProfileGameIdsRef.current;
      if (current.has(normalized) === hidden) return;

      const next = new Set(current);
      if (hidden) next.add(normalized);
      else next.delete(normalized);
      hiddenProfileGameIdsRef.current = next;
      setHiddenProfileGameIds(next);
      writeStoredHiddenProfileGameIds(next);
      scheduleCloudProfileSync();
    },
    [scheduleCloudProfileSync],
  );

  const restoreCloudProfileFromRemote = useCallback(async (): Promise<boolean> => {
    if (cloudProfileRestoreInFlightRef.current) return false;
    const accountId = accountUserIdRef.current;
    if (!accountId) {
      setIsCloudProfileRestoring(false);
      return false;
    }
    cloudProfileRestoreInFlightRef.current = true;
    let shouldFlushPendingUpload = false;
    try {
      if (!(await hasPremiumCloudProfileAccess())) return false;
      setIsCloudProfileRestoring(true);

      // A failed request is not an empty cloud profile. Returning false here
      // keeps the account unmarked so the caller retries; treating the failure
      // as "nothing stored" would mark it restored and upload the local state
      // over the account's real avatar and banner.
      let remote: Awaited<ReturnType<typeof ghostboxApi.getCloudProfileSnapshot>>;
      try {
        remote = await ghostboxApi.getCloudProfileSnapshot();
      } catch {
        return false;
      }
      // The account can sign out while the snapshot is in flight; applying it
      // afterwards would repaint the signed-out UI with the old profile.
      if (accountUserIdRef.current !== accountId) return false;
      if (!remote) {
        cloudProfileRestoredUserIdRef.current = accountId;
        cloudProfilePendingUploadRef.current = true;
        shouldFlushPendingUpload = true;
        return true;
      }

      // Read after the awaits: a Steam profile restored meanwhile carries the
      // steamId that applyCloudProfileToLocal has to keep.
      const currentProfile = steamProfileRef.current;
      const localUpdatedAt = cloudProfileLocalUpdatedAtRef.current;
      const localHasData =
        Boolean(currentProfile?.bannerUrl) ||
        favoriteGamesRef.current.length > 0 ||
        userCollectionsRef.current.length > 0 ||
        hiddenProfileGameIdsRef.current.size > 0;

      if (
        localHasData &&
        !isCloudSnapshotNewer(remote.updatedAt, localUpdatedAt)
      ) {
        if (isCloudSnapshotNewer(localUpdatedAt, remote.updatedAt)) {
          cloudProfilePendingUploadRef.current = true;
          shouldFlushPendingUpload = true;
        }
        cloudProfileRestoredUserIdRef.current = accountId;
        return true;
      }

      const applied = applyCloudProfileToLocal({
        currentProfile,
        snapshot: remote,
      });
      skipCloudProfileUploadCountRef.current = 2;
      const restoredHiddenIds = new Set(applied.hiddenProfileGameIds);
      hiddenProfileGameIdsRef.current = restoredHiddenIds;
      setHiddenProfileGameIds(restoredHiddenIds);
      writeStoredHiddenProfileGameIds(restoredHiddenIds);
      // Avatar, banner and display name are applied before the game list is
      // resolved: they are what the user looks for right after signing in, and
      // resolving the cloud games needs a network round trip per unknown game.
      if (applied.steamProfile) {
        steamProfileRef.current = applied.steamProfile;
        setSteamProfile(applied.steamProfile);
        writeStoredSteamProfile(applied.steamProfile);
        await ghostboxApi
          .saveSteamProfile(applied.steamProfile)
          .catch(() => undefined);
      }

      const cloudGameIds = Array.from(
        new Set([
          ...applied.favoriteGameIds,
          ...applied.userCollections.flatMap(
            (collection) => collection.gameIds,
          ),
        ]),
      );
      const { gamesById, games } = await resolveCloudGames(cloudGameIds, [
        ...favoriteGamesRef.current,
        ...addedLibraryGamesRef.current,
        ...profileHistoryGamesRef.current,
      ]);
      const favoriteGames = applied.favoriteGameIds.flatMap((gameId) => {
        const game = gamesById.get(gameId);
        return game ? [game] : [];
      });

      cloudProfileFavoriteGameIdsRef.current = applied.favoriteGameIds.filter(
        (gameId) => !gamesById.has(gameId),
      );
      setFavoriteGames(favoriteGames);
      writeStoredFavoriteGames(favoriteGames);
      setUserCollections(
        rehydrateCollectionGames(applied.userCollections, games),
      );
      writeStoredUserCollections(applied.userCollections);
      cloudProfileLocalUpdatedAtRef.current = remote.updatedAt;
      writeStoredCloudProfileUpdatedAt(remote.updatedAt);
      cloudProfilePendingUploadRef.current = false;
      cloudProfileRestoredUserIdRef.current = accountId;
      return true;
    } catch {
      return false;
    } finally {
      cloudProfileRestoreInFlightRef.current = false;
      setIsCloudProfileRestoring(false);
      if (shouldFlushPendingUpload && cloudProfilePendingUploadRef.current) {
        cloudProfilePendingUploadRef.current = false;
        window.setTimeout(() => void pushCloudProfileSnapshot(), 0);
      }
    }
  }, [hasPremiumCloudProfileAccess, pushCloudProfileSnapshot, rehydrateCollectionGames]);

  const queueBackupToast = useCallback(
    (_appId: string, record: BackupSettings["backupRecords"][string]) => {
      const shouldNotify =
        record.lastBackupSuccess !== false
          ? notifications.backupSuccessEnabled
          : notifications.backupErrorEnabled;
      if (!shouldNotify) return;

      const isSuccess = record.lastBackupSuccess !== false;
      const title = isSuccess
        ? `${record.title} salvo com sucesso!`
        : "Falha no backup";
      const message = isSuccess
        ? ""
        : record.lastBackupError || `${record.title} não pôde ser salvo.`;
      const createdAt = Date.parse(record.lastBackupAt);

      pushAppNotification({
        id: `backup:${record.title}:${record.lastBackupAt}:${isSuccess ? "success" : "error"}`,
        type: "backup",
        severity: isSuccess ? "success" : "error",
        title,
        message,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        game: { title: record.title },
      });
    },
    [
      notifications.backupErrorEnabled,
      notifications.backupSuccessEnabled,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    void ghostboxApi
      .getBackupSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        backupSettingsRef.current = settings;
        setBackupSettings(settings);
      })
      .finally(() => {
        if (!cancelled) markInitialLoadStepComplete("backupRoot");
      });

    const unsubscribe = ghostboxApi.onBackupSettingsChanged((settings) => {
      if (cancelled) return;

      const changed = getLatestChangedBackupRecord(
        backupSettingsRef.current,
        settings,
      );
      backupSettingsRef.current = settings;
      setBackupSettings(settings);
      if (changed) queueBackupToast(changed.appId, changed.record);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [markInitialLoadStepComplete, queueBackupToast]);

  // The cloud save list is the authoritative "games owned by this GhostBox
  // account" set. Backup records change whenever a save is pushed, so they
  // double as the refresh trigger.
  useEffect(() => {
    if (!accountUserId) {
      setCloudSaveAppIds((current) => (current.size ? new Set<string>() : current));
      return;
    }

    let cancelled = false;

    void ghostboxApi
      .listCloudSaves()
      .then((saves) => {
        if (cancelled) return;
        const nextAppIds = new Set(saves.map((save) => save.appId));
        setCloudSaveAppIds((current) =>
          current.size === nextAppIds.size &&
          [...nextAppIds].every((appId) => current.has(appId))
            ? current
            : nextAppIds,
        );

        // Fresh install / bundle login: the machine holds no local backup
        // records, so the `backupSettings` -> `profileHistoryGames` bridge below
        // never fires. A game that only lives in the cloud must still enter
        // `profileHistoryGames`, otherwise `ProfilePage` (which only renders
        // games from `addedLibraryGames` / `favoriteGames` / history) shows a
        // bare local library instead of the account's real saves.
        if (saves.length > 0) {
          const latestByAppId = new Map<string, CloudSave>();
          for (const save of saves) {
            if (!save.appId) continue;
            const existing = latestByAppId.get(save.appId);
            if (
              !existing ||
              cloudSaveTimestamp(save) > cloudSaveTimestamp(existing)
            ) {
              latestByAppId.set(save.appId, save);
            }
          }

          const knownAppIds = new Set<string>([
            ...profileHistoryGamesRef.current.map((game) => game.appId),
            ...addedLibraryGamesRef.current.map((game) => game.appId),
            ...favoriteGamesRef.current.map((game) => game.appId),
          ]);

          let nextHistory = profileHistoryGamesRef.current;
          let changed = false;

          for (const [appId, save] of latestByAppId) {
            if (knownAppIds.has(appId)) continue;

            const rawTitle = (save.gameTitle || "").trim();
            const title =
              rawTitle && !isSteamTitlePlaceholder(rawTitle, appId)
                ? rawTitle
                : appId;
            const fallback = createProfileHistoryFallbackGame(appId, title);
            const withTime: GhostBoxGame = fallback.lastTimePlayed
              ? fallback
              : {
                  ...fallback,
                  lastTimePlayed: save.updatedAt || save.createdAt || null,
                };

            const manifestCount =
              save.manifest?.profileProgress?.achievementCount;
            const seededGame =
              typeof manifestCount === "number" && manifestCount > 0
                ? {
                    ...withTime,
                    achievements: {
                      unlocked: withTime.achievements.unlocked,
                      total: Math.max(
                        withTime.achievements.total,
                        manifestCount,
                      ),
                      progress: withTime.achievements.progress,
                    },
                  }
                : withTime;

            nextHistory = upsertProfileHistoryGame(nextHistory, seededGame);
            knownAppIds.add(appId);
            changed = true;
          }

          if (changed && !cancelled) {
            setProfileHistoryGames(nextHistory);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [accountUserId, backupSettings]);

  useEffect(() => {
    const records = backupSettings?.backupRecords ?? {};
    const recordEntries = Object.entries(records);
    if (!recordEntries.length) return;

    let cancelled = false;

    void (async () => {
      const knownGames = [
        ...profileHistoryGamesRef.current,
        ...addedLibraryGamesRef.current,
        ...favoriteGamesRef.current,
      ];

      for (const [appId, record] of recordEntries) {
        if (cancelled) return;
        const latestKey = getBackupRecordLatestKey(record);
        if (appliedProfileBackupKeysRef.current.get(appId) === latestKey) {
          continue;
        }

        appliedProfileBackupKeysRef.current.set(appId, latestKey);
        const game =
          knownGames.find((item) => item.appId === appId) ??
          createProfileHistoryFallbackGame(appId, record.title || appId);

        // The latest backup counts as recent activity when the game has no
        // local last-played date (fresh install, saves only in the cloud).
        await applyBackupAchievementsToProfileHistory(
          withBackupRecordLastPlayed(game, record),
        ).catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyBackupAchievementsToProfileHistory, backupSettings]);

  useEffect(() => {
    writeStoredFavoriteGames(favoriteGames);
    const resolvedFavoriteIds = new Set(favoriteGames.map((game) => game.id));
    cloudProfileFavoriteGameIdsRef.current =
      cloudProfileFavoriteGameIdsRef.current.filter(
        (gameId) => !resolvedFavoriteIds.has(gameId),
      );
    if (
      !cloudProfileBootstrappedRef.current
    )
      return;
    if (skipCloudProfileUploadCountRef.current > 0) {
      skipCloudProfileUploadCountRef.current -= 1;
      return;
    }
    scheduleCloudProfileSync();
  }, [favoriteGames, scheduleCloudProfileSync]);

  useEffect(() => {
    writeStoredUserCollections(userCollections);
    if (!cloudProfileBootstrappedRef.current) {
      cloudProfileBootstrappedRef.current = true;
      return;
    }
    scheduleCloudProfileSync();
  }, [scheduleCloudProfileSync, userCollections]);

  useEffect(() => {
    const userId = accountUserId?.trim();
    if (!userId) {
      setIsCloudProfileRestoring(false);
      if (cloudProfileRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
        cloudProfileRestoreRetryTimerRef.current = null;
      }
      return;
    }
    if (cloudProfileRestoredUserIdRef.current === userId) return;
    void restoreCloudProfileFromRemote().then((restored) => {
      if (
        restored ||
        accountUserIdRef.current !== userId ||
        cloudProfileRestoredUserIdRef.current === userId
      ) {
        return;
      }

      if (cloudProfileRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
      }
      cloudProfileRestoreRetryTimerRef.current = window.setTimeout(() => {
        cloudProfileRestoreRetryTimerRef.current = null;
        setCloudProfileRestoreRetryTick((tick) => tick + 1);
      }, 15_000);
    });

    return () => {
      if (cloudProfileRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
        cloudProfileRestoreRetryTimerRef.current = null;
      }
    };
  }, [accountUserId, cloudProfileRestoreRetryTick, restoreCloudProfileFromRemote]);

  useEffect(() => {
    setUserCollections((current) => {
      if (current.length === 0) return current;
      const next = rehydrateCollectionGames(current);
      return haveCollectionGamesChanged(current, next) ? next : current;
    });
  }, [
    addedLibraryGames,
    favoriteGames,
    profileHistoryGames,
    rehydrateCollectionGames,
  ]);

  useEffect(() => {
    writeStoredStartupPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    writeStoredProfileHistoryGames(profileHistoryGames);
  }, [profileHistoryGames]);

  useEffect(() => {
    const completedDownloadAppIds = new Set(
      readDownloadTasks()
        .filter((task) => task.status === "completed")
        .map((task) => task.appId),
    );

    void ghostboxApi.setTrayLibraryGames(
      addedLibraryGames.map((game) => ({
        ...game,
        trayInstalled:
          game.status === "installed" ||
          game.librarySource === "steam-installed" ||
          game.librarySource === "plugin" ||
          game.librarySource === "registered" ||
          Boolean(game.customExePath) ||
          completedDownloadAppIds.has(game.appId),
      })),
    );
  }, [addedLibraryGames]);

  useEffect(() => {
    const achievementUnlockedTitle =
      appearance.language === "en"
        ? "Achievement unlocked"
        : "Conquista desbloqueada";

    const findAchievementDetail = (appId: string, name: string) => {
      const pools = [
        ...favoriteGamesRef.current,
        ...addedLibraryGamesRef.current,
        ...profileHistoryGamesRef.current,
      ];
      for (const game of pools) {
        if (game.appId !== appId) continue;
        const list = game.achievementList;
        if (!list?.length) continue;
        const found = list.find((entry) => entry.name === name || entry.title === name);
        if (found) return found;
      }
      return null;
    };

    return ghostboxApi.onLocalAchievementsUnlocked((payload) => {
      if (!notifications.achievementsEnabled) return;

      for (const [index, achievementName] of payload.achievements.entries()) {
        const message = `${payload.title}: ${achievementName}`;
        const detail = findAchievementDetail(payload.appId, achievementName);
        const toastTitle = detail?.title?.trim() || achievementName;
        const toastDescription = detail?.description?.trim() || payload.title;
        const iconUrl = detail?.icon || detail?.iconGray || undefined;

        pushAppNotification({
          id: `achievement:${payload.title}:${achievementName}:${Date.now()}:${index}`,
          type: "achievement",
          severity: "success",
          title: achievementUnlockedTitle,
          message,
          createdAt: Date.now(),
          game: { appId: payload.appId, title: payload.title },
        });

        showAchievementToast({
          appId: payload.appId,
          gameTitle: payload.title,
          title: toastTitle,
          description: toastDescription,
          iconUrl,
        });
      }
    });
  }, [
    appearance.language,
    notifications.achievementsEnabled,
    showAchievementToast,
  ]);

  // Nudge único do evento Tauri `premium-backup-nudge`: o backend emite quando
  // um usuário FREE fecha uma partida (backups são exclusivos do Premium). A
  // flag em localStorage (`ghostbox:premium-nudge:v1`) garante UM único push;
  // o CTA navega para a aba Assinatura via lib/appNavigation.ts.
  useEffect(() => {
    return ghostboxApi.onPremiumBackupNudge(() => {
      // Defensivo: o backend só emite para contas FREE, mas se o cache local
      // já souber que a conta é Premium, não empurra o aviso informativo.
      if (ghostboxApi.getCachedIsPremium() === true) return;
      if (hasSeenPremiumBackupNudge(window.localStorage)) return;
      markPremiumBackupNudgeSeen(window.localStorage);

      pushAppNotification(
        buildPremiumBackupNudgeNotification({
          title: t("premium.backupNudge.title"),
          message: t("premium.backupNudge.message"),
          actionLabel: t("premium.backupNudge.cta"),
        }),
      );
    });
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    void ghostboxApi
      .getStartupSettings()
      .then((settings) => {
        if (!cancelled && settings) setStartupSettings(settings);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) markInitialLoadStepComplete("startupSettings");
      });

    return () => {
      cancelled = true;
    };
  }, [markInitialLoadStepComplete]);

  useEffect(() => {
    const steamId = linkedSteamId?.trim();
    if (!steamId) return;

    let cancelled = false;
    const restoreLinkedAccount = async () => {
      const current = steamProfileRef.current;
      if (current?.steamId === steamId) {
        void syncPlaytimesFromSteam(steamId);
        return;
      }

      const requestId = ++steamProfileRequestSequenceRef.current;
      try {
        const profile = await ghostboxApi.restoreSteamAccount(steamId);
        if (cancelled || steamProfileRequestSequenceRef.current !== requestId) return;
        if (!accountUserIdRef.current) {
          // The session ended while the restore was in flight, and Rust
          // already re-wrote steam-profile.json before resolving: undo it so
          // the signed-out state stays clean.
          void ghostboxApi.clearLocalSteamProfile().catch(() => undefined);
          return;
        }
        // The Steam summary carries no banner and only the Steam avatar, and
        // this restore races the cloud-profile restore on sign-in. Writing it
        // raw overwrote the account's avatar and banner — in state, in
        // localStorage and, through steam_restore_account, on disk. Merge, then
        // push the merged profile back so the stored copy keeps them too.
        const merged =
          mergeSteamProfile(profile, steamProfileRef.current) ?? profile;
        steamProfileRef.current = merged;
        setSteamProfile(merged);
        writeStoredSteamProfile(merged);
        if (merged !== profile) {
          void ghostboxApi.saveSteamProfile(merged).catch(() => undefined);
        }
        void syncPlaytimesFromSteam(steamId);
      } catch (error) {
        console.warn("Failed to restore linked Steam account", error);
      }
    };

    void restoreLinkedAccount();
    return () => {
      cancelled = true;
    };
  }, [linkedSteamId, syncPlaytimesFromSteam]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++steamProfileRequestSequenceRef.current;

    const hydrate = async () => {
      // steam-profile.json is account-scoped: with no session it is a leftover
      // from a signed-out account (crashed logout, failed wipe), and painting
      // it would put a profile on the login screen.
      let session: Awaited<ReturnType<typeof ghostboxApi.getCloudSession>> = null;
      try {
        session = await ghostboxApi.getCloudSession();
      } catch {
        session = null;
      }
      if (cancelled || steamProfileRequestSequenceRef.current !== requestId) return;

      if (!session?.token) {
        // Drop whatever the initial useState read from localStorage too.
        steamProfileRef.current = null;
        setSteamProfile(null);
        writeStoredSteamProfile(null);
        markInitialLoadStepComplete("steamProfile");
        return;
      }

      try {
        const profile = await ghostboxApi.getSteamProfile();
        if (cancelled || steamProfileRequestSequenceRef.current !== requestId)
          return;

        const merged = mergeSteamProfile(profile, steamProfileRef.current);
        if (merged) {
          setIsCloudProfileRestoring(true);
          steamProfileRef.current = merged;
          writeStoredSteamProfile(merged);
        }
        setSteamProfile(merged);
      } catch {
        // A failed hydration is not a signed-out account; keep going without
        // the disk profile rather than blocking the initial load.
      } finally {
        if (
          !cancelled &&
          steamProfileRequestSequenceRef.current === requestId
        ) {
          markInitialLoadStepComplete("steamProfile");
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [markInitialLoadStepComplete]);

  useEffect(() => {
    let cancelled = false;

    void ghostboxApi
      .getMorrenusApiKey()
      .then((key) => {
        if (!cancelled && typeof key === "string") setMorrenusApiKey(key);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) markInitialLoadStepComplete("morrenusApiKey");
      });

    return () => {
      cancelled = true;
    };
  }, [markInitialLoadStepComplete]);

  const favoriteGameIds = useMemo(
    () => new Set(favoriteGames.map((game) => game.id)),
    [favoriteGames],
  );

  const availableLibraryGameAppIds = useMemo(
    () => new Set(addedLibraryGames.map((game) => game.appId)),
    [addedLibraryGames],
  );

  const playableGameAppIds = useMemo(
    () =>
      new Set(
        addedLibraryGames
          .filter((game) => game.librarySource !== "steam-owned")
          .map((game) => game.appId),
      ),
    [addedLibraryGames],
  );

  const installedSteamGameAppIds = useMemo(
    () =>
      new Set(
        addedLibraryGames
          .filter(
            (game) =>
              game.status === "installed" ||
              game.librarySource === "steam-installed",
          )
          .flatMap((game) => [
            game.appId,
            game.id,
            game.appId ? `steam-${game.appId}` : "",
          ])
          .filter(Boolean),
      ),
    [addedLibraryGames],
  );

  const profileFavoriteGames = useMemo(
    () =>
      normalizeSteamGameTitles(favoriteGames, [
        ...addedLibraryGames,
        ...profileHistoryGames,
      ]),
    [addedLibraryGames, favoriteGames, profileHistoryGames],
  );
  const profileAddedLibraryGames = useMemo(
    () =>
      normalizeSteamGameTitles(addedLibraryGames, [
        ...favoriteGames,
        ...profileHistoryGames,
      ]),
    [addedLibraryGames, favoriteGames, profileHistoryGames],
  );
  const profileHistoryGamesWithPlaytime = useMemo(
    () =>
      mergeSteamAchievementsIntoGames(
        normalizeSteamGameTitles(profileHistoryGames, [
          ...addedLibraryGames,
          ...favoriteGames,
        ]).map(mergeGamePlaytime),
        steamAccountStats,
      ),
    [
      addedLibraryGames,
      favoriteGames,
      mergeGamePlaytime,
      profileHistoryGames,
      steamAccountStats,
    ],
  );

  useEffect(() => {
    if (!profileHistoryGames.length) return;
    const normalizedGames = normalizeSteamGameTitles(profileHistoryGames, [
      ...addedLibraryGames,
      ...favoriteGames,
    ]);
    const changed = normalizedGames.some(
      (game, index) => game.title !== profileHistoryGames[index]?.title,
    );
    if (changed) setProfileHistoryGames(normalizedGames);
  }, [addedLibraryGames, favoriteGames, profileHistoryGames]);

  const ensureLuaToolsDependencies = useCallback(() => {
    void ghostboxApi.ensureLuaToolsDependencies().catch(() => undefined);
  }, []);

  useEffect(() => {
    return ghostboxApi.onLuaToolsDependenciesFinished((event) => {
      const title =
        sanitizeDependencyMessage(event?.title) || "Dependências";
      const message = sanitizeDependencyMessage(event?.message);
      const error = sanitizeDependencyMessage(event?.error);
      showToast(
        title,
        error ? `${message} ${error}` : message,
        event.success ? "success" : "error",
      );
    });
  }, [showToast]);

  const applySteamLibraryScanResult = useCallback(
    (result: SteamLibraryScanResult) => {
      if (result.status !== "ok") return;

      const games = normalizeSteamGameTitles(
        result.games.filter((game) => !isHiddenLibraryGame(game)),
        [...favoriteGamesRef.current, ...profileHistoryGamesRef.current],
      );
      setSteamPathInput(result.steamPath);
      setScannedLibraryGames(games);
      if (
        games.some(
          (game) => "luaToolsManifests" in game || "luaToolsManifestFiles" in game,
        )
      ) {
        ensureLuaToolsDependencies();
      }
    },
    [ensureLuaToolsDependencies],
  );

  useEffect(() => {
    // Never auto-list Steam account owned games in the library grid.
    // Keep playtime/achievements via stats merge only for games already local
    // (installed, registered, or LuaTools).
    const games = mergeSteamAchievementsIntoGames(
      scannedLibraryGames,
      steamAccountStats,
    ).map(mergeGamePlaytime);
    setAddedLibraryGames(games);
    setAddedLibraryGameAppIds(
      new Set(
        games
          .filter((game) => game.librarySource !== "steam-owned")
          .map((game) => game.appId),
      ),
    );
  }, [mergeGamePlaytime, scannedLibraryGames, steamAccountStats]);

  const toggleFavoriteGame = useCallback(
    (game: GhostBoxGame) => {
      const isFavorite = favoriteGameIds.has(game.id);
      if (!isFavorite) preloadGamePortraitSources(game);

      setFavoriteGames((current) =>
        isFavorite
          ? current.filter((item) => item.id !== game.id)
          : [...current.filter((item) => item.id !== game.id), game],
      );
      showToast(
        isFavorite ? "Removido dos favoritos" : "Adicionado aos favoritos",
        isFavorite
          ? `${game.title} saiu dos favoritos.`
          : `${game.title} foi salvo nos favoritos.`,
      );
      pushAppNotification({
        id: `favorite:${game.appId}:${Date.now()}:${isFavorite ? "removed" : "added"}`,
        type: "favorite",
        severity: isFavorite ? "info" : "success",
        title: isFavorite
          ? appearance.language === "en"
            ? "Removed from favorites"
            : "Removido dos favoritos"
          : appearance.language === "en"
            ? "Added to favorites"
            : "Adicionado aos favoritos",
        message: isFavorite
          ? appearance.language === "en"
            ? `${game.title} was removed from favorites.`
            : `${game.title} saiu dos favoritos.`
          : appearance.language === "en"
            ? `${game.title} was saved to favorites.`
            : `${game.title} foi salvo nos favoritos.`,
        createdAt: Date.now(),
        game: {
          appId: game.appId,
          title: game.title,
          coverUrl: game.coverUrl,
          headerUrl: game.heroUrl,
        },
      });
    },
    [appearance.language, favoriteGameIds, showToast],
  );

  // Cloud restore is fully automatic: re-adding or launching a game pulls the
  // newest cloud save for that appId, once per save id per machine.
  const autoRestoreCloudBackup = useCallback(
    async (game: GhostBoxGame) => {
      const appId = game.appId;
      if (!appId) return;
      if (autoRestoreInFlightAppIdsRef.current.has(appId)) return;

      autoRestoreInFlightAppIdsRef.current.add(appId);
      try {
        if (!(await hasPremiumCloudProfileAccess())) return;

        const saves = await ghostboxApi.listCloudSaves(appId);
        const latestSave = saves.reduce<CloudSave | null>((latest, save) => {
          if (!latest) return save;
          return cloudSaveTimestamp(save) > cloudSaveTimestamp(latest)
            ? save
            : latest;
        }, null);
        if (!latestSave) return;
        if (autoRestoredCloudSaveIdsRef.current[appId] === latestSave.id) return;

        const result = await ghostboxApi.restoreCloudSave(game, latestSave.id);
        if (!result?.success) return;

        autoRestoredCloudSaveIdsRef.current = {
          ...autoRestoredCloudSaveIdsRef.current,
          [appId]: latestSave.id,
        };
        writeStoredAutoRestoredCloudSaves(autoRestoredCloudSaveIdsRef.current);

        const title =
          appearance.language === "en"
            ? "Cloud backup restored"
            : "Backup em nuvem restaurado";
        const message =
          appearance.language === "en"
            ? `${game.title} was restored from the latest cloud backup.`
            : `${game.title} foi restaurado a partir do backup em nuvem mais recente.`;

        pushAppNotification({
          id: `backup:auto-restore:${appId}:${latestSave.id}`,
          type: "backup",
          severity: "success",
          title,
          message,
          createdAt: Date.now(),
          game: {
            appId: game.appId,
            title: game.title,
            coverUrl: game.coverUrl,
            headerUrl: game.heroUrl,
          },
        });
      } catch (error) {
        // Auto-restore is best-effort: never block adding or launching a game.
        // Still log it — a silent catch here hid expired cloud sessions.
        console.warn("Cloud auto-restore failed", appId, error);
      } finally {
        autoRestoreInFlightAppIdsRef.current.delete(appId);
      }
    },
    [appearance.language, hasPremiumCloudProfileAccess],
  );

  const queueGame = useCallback(
    async (game: GhostBoxGame) => {
      // Demos nunca entram em downloads/fila: fonte de verdade é o tipo, sem
      // regex de título e sem apagar nada persistido.
      if (isBlockedSteamDemo(game)) return;
      if (
        addingGameId ||
        removingGameId ||
        availableLibraryGameAppIds.has(game.appId)
      ) {
        return;
      }

      setAddingGameId(game.id);
      try {
        const steamPlaytimeEntry = gamePlaytimesRef.current[game.appId] as
          (GamePlaytimeSnapshot[string] & { source?: string }) | undefined;
        const isKnownSteamOwnedGame = steamPlaytimeEntry?.source === "steam";
        const steamOwnedPlaytimes =
          steamAccountStatsRef.current?.ownedPlaytimes ?? [];
        const isSteamOwnedGame =
          isKnownSteamOwnedGame ||
          steamOwnedPlaytimes.some((playtime) => playtime.appId === game.appId);

        const result = isSteamOwnedGame
          ? await registerSteamLibraryGame(game)
          : await addGameViaLuaTools(game);
        if (!result.success) {
          const errorMessage =
            sanitizeDependencyMessage(result.error) ||
            "Não foi possível adicionar o jogo à Biblioteca.";
          showToast("Falha ao adicionar", errorMessage, "error");
          pushAppNotification({
            id: `library:add:error:${game.appId}:${Date.now()}`,
            type: "library",
            severity: "error",
            title: appearance.language === "en" ? "Could not add game" : "Falha ao adicionar jogo",
            message: appearance.language === "en"
              ? `${game.title} could not be added to the Library. ${errorMessage}`
              : `${game.title} não pôde ser adicionado à Biblioteca. ${errorMessage}`,
            createdAt: Date.now(),
            game: {
              appId: game.appId,
              title: game.title,
              coverUrl: game.coverUrl,
              headerUrl: game.heroUrl,
            },
          });
          return;
        }
        if (isHiddenLibraryGame(result.libraryGame)) return;
        if (!isSteamOwnedGame) {
          ensureLuaToolsDependencies();
        }

        const libraryGame = mergeGamePlaytime({
          ...result.libraryGame,
          // Registered Steam games must not look like auto-listed owned stubs.
          librarySource: isSteamOwnedGame
            ? "registered"
            : result.libraryGame.librarySource === "steam-owned"
              ? "registered"
              : result.libraryGame.librarySource,
        });

        setScannedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, libraryGame),
        );
        setAddedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, libraryGame),
        );
        setAddedLibraryGameAppIds((current) =>
          new Set(current).add(libraryGame.appId),
        );
        showToast(
          "Jogo adicionado",
          isSteamOwnedGame
            ? `${libraryGame.title} foi reconhecido na Biblioteca.`
            : `${libraryGame.title} foi adicionado à Biblioteca.`,
        );
        pushAppNotification({
          id: `library:add:success:${libraryGame.appId}:${Date.now()}`,
          type: "library",
          severity: "success",
          title: appearance.language === "en" ? "Game added" : "Jogo adicionado",
          message: appearance.language === "en"
            ? `${libraryGame.title} was added to the Library.`
            : `${libraryGame.title} foi adicionado à Biblioteca.`,
          createdAt: Date.now(),
          game: {
            appId: libraryGame.appId,
            title: libraryGame.title,
            coverUrl: libraryGame.coverUrl,
            headerUrl: libraryGame.heroUrl,
          },
        });

        void autoRestoreCloudBackup(libraryGame);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? sanitizeDependencyMessage(error.message) ||
              "Não foi possível adicionar o jogo à Biblioteca."
            : typeof error === "string"
              ? sanitizeDependencyMessage(error) ||
                "Não foi possível adicionar o jogo à Biblioteca."
              : "Não foi possível adicionar o jogo à Biblioteca.";
        showToast(
          "Falha ao adicionar",
          errorMessage,
          "error",
        );
        pushAppNotification({
          id: `library:add:error:${game.appId}:${Date.now()}`,
          type: "library",
          severity: "error",
          title: appearance.language === "en" ? "Could not add game" : "Falha ao adicionar jogo",
          message: appearance.language === "en"
            ? `${game.title} could not be added to the Library. ${errorMessage}`
            : `${game.title} não pôde ser adicionado à Biblioteca. ${errorMessage}`,
          createdAt: Date.now(),
          game: {
            appId: game.appId,
            title: game.title,
            coverUrl: game.coverUrl,
            headerUrl: game.heroUrl,
          },
        });
      } finally {
        setAddingGameId(null);
      }
    },
    [
      addingGameId,
      appearance.language,
      autoRestoreCloudBackup,
      availableLibraryGameAppIds,
      mergeGamePlaytime,
      removingGameId,
      showToast,
      ensureLuaToolsDependencies,
    ],
  );

  const removeQueuedGame = useCallback(
    async (game: GhostBoxGame) => {
      if (addingGameId || removingGameId) return;
      setRemovingGameId(game.id);

      try {
        const result = await removeGameViaLuaTools(game);
        if (!result.success) {
          const errorMessage =
            sanitizeDependencyMessage(result.error) ||
            "Não foi possível remover o jogo.";
          showToast("Falha ao remover", errorMessage, "error");
          pushAppNotification({
            id: `library:remove:error:${game.appId}:${Date.now()}`,
            type: "library",
            severity: "error",
            title: appearance.language === "en" ? "Could not remove game" : "Falha ao remover jogo",
            message: appearance.language === "en"
              ? `${game.title} could not be removed from the Library. ${errorMessage}`
              : `${game.title} não pôde ser removido da Biblioteca. ${errorMessage}`,
            createdAt: Date.now(),
            game: {
              appId: game.appId,
              title: game.title,
              coverUrl: game.coverUrl,
              headerUrl: game.heroUrl,
            },
          });
          return;
        }

        setScannedLibraryGames((current) =>
          removeLibraryGameByAppId(current, result.appId),
        );
        setAddedLibraryGames((current) =>
          removeLibraryGameByAppId(current, result.appId),
        );
        setAddedLibraryGameAppIds((current) => {
          const next = new Set(current);
          next.delete(result.appId);
          return next;
        });

        // Removing wipes local saves, so the same cloud save must be restorable
        // again when the game comes back.
        if (autoRestoredCloudSaveIdsRef.current[result.appId]) {
          const { [result.appId]: _removed, ...rest } =
            autoRestoredCloudSaveIdsRef.current;
          autoRestoredCloudSaveIdsRef.current = rest;
          writeStoredAutoRestoredCloudSaves(rest);
        }

        const historyGame = mergeGamePlaytime(game);
        setProfileHistoryGames((current) =>
          upsertProfileHistoryGame(current, historyGame),
        );
        void applyBackupAchievementsToProfileHistory(historyGame).catch(
          () => undefined,
        );
        void loadGameAchievementDetailsCached(game.id)
          .then((details) => {
            if (!details) return;
            setProfileHistoryGames((current) =>
              upsertProfileHistoryGame(current, {
                ...historyGame,
                achievements: details.achievements,
                achievementList: details.achievementList,
              }),
            );
          })
          .catch(() => undefined);

        showToast("Jogo removido", `${game.title} foi removido da Biblioteca.`);
        pushAppNotification({
          id: `library:remove:success:${game.appId}:${Date.now()}`,
          type: "library",
          severity: "info",
          title: appearance.language === "en" ? "Game removed" : "Jogo removido",
          message: appearance.language === "en"
            ? `${game.title} was removed from the Library.`
            : `${game.title} foi removido da Biblioteca.`,
          createdAt: Date.now(),
          game: {
            appId: game.appId,
            title: game.title,
            coverUrl: game.coverUrl,
            headerUrl: game.heroUrl,
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? sanitizeDependencyMessage(error.message) ||
              "Não foi possível remover o jogo."
            : typeof error === "string"
              ? sanitizeDependencyMessage(error) ||
                "Não foi possível remover o jogo."
              : "Não foi possível remover o jogo.";
        showToast(
          "Falha ao remover",
          errorMessage,
          "error",
        );
        pushAppNotification({
          id: `library:remove:error:${game.appId}:${Date.now()}`,
          type: "library",
          severity: "error",
          title: appearance.language === "en" ? "Could not remove game" : "Falha ao remover jogo",
          message: appearance.language === "en"
            ? `${game.title} could not be removed from the Library. ${errorMessage}`
            : `${game.title} não pôde ser removido da Biblioteca. ${errorMessage}`,
          createdAt: Date.now(),
          game: {
            appId: game.appId,
            title: game.title,
            coverUrl: game.coverUrl,
            headerUrl: game.heroUrl,
          },
        });
      } finally {
        setRemovingGameId(null);
      }
    },
    [
      addingGameId,
      appearance.language,
      applyBackupAchievementsToProfileHistory,
      mergeGamePlaytime,
      removingGameId,
      showToast,
    ],
  );

  const [removeConfirmGame, setRemoveConfirmGame] = useState<GhostBoxGame | null>(null);

  const requestRemoveGame = useCallback((game: GhostBoxGame) => {
    setRemoveConfirmGame(game);
  }, []);

  const uninstallGame = useCallback(
    async (game: GhostBoxGame) => {
      const appId = game.appId || game.id.replace(/^steam-/, "");
      const task = readDownloadTasks().find(
        (t) => t.appId === appId && t.status === "completed",
      );
      if (task) {
        // GhostBox-downloaded: remove library entry + delete local files.
        await removeQueuedGame(game);
        try {
          await deleteDownloadTaskFiles(task.id);
        } catch {
          // File deletion failure is non-fatal; library entry already removed.
        }
      } else {
        // Steam-installed: delegate to Steam's own uninstall dialog.
        await ghostboxApi.openExternalUrl(`steam://uninstall/${appId}`);
      }
    },
    [removeQueuedGame],
  );

  const handleGameDetailsLoaded = useCallback((details: GhostBoxGame) => {
    setProfileHistoryGames((current) => {
      const existingGame = current.find((game) => game.appId === details.appId);
      if (!existingGame) return current;

      return upsertProfileHistoryGame(
        current,
        mergeGameDetailsPreservingAchievements(existingGame, details),
      );
    });
  }, []);

  const refreshGameAchievements = useCallback((game: GhostBoxGame) => {
    const appId = game.appId?.trim() ?? "";
    if (!appId) return;
    if (achievementHoverInFlightRef.current.has(appId)) return;

    const stats = steamAccountStatsRef.current;
    const refreshKey = `${appId}::${stats?.steamId ?? ""}:${stats?.fetchedAt ?? 0}`;
    if (achievementHoverRefreshedRef.current.has(refreshKey)) return;
    achievementHoverInFlightRef.current.add(appId);

    void loadGameAchievementDetailsCached(game.appId || game.id)
      .then((details) => {
        if (!details) return;
        const matches = (candidate: GhostBoxGame) =>
          candidate.appId === appId || candidate.id === game.id;
        const applyWithAccount = (games: GhostBoxGame[]) => {
          if (!games.some(matches)) return games;
          const merged = applyAchievementDetailsToGames(games, details);
          const target = merged === games ? games : merged;
          if (!stats) return target;
          return target.map((candidate) =>
            matches(candidate)
              ? mergeSteamAchievementsIntoGame(candidate, stats)
              : candidate,
          );
        };
        setAddedLibraryGames((current) => applyWithAccount(current));
        setFavoriteGames((current) => applyWithAccount(current));
        setProfileHistoryGames((current) => {
          if (!current.some(matches)) return current;
          return current.map((candidate) =>
            matches(candidate)
              ? mergeSteamAchievementsIntoGame(
                  mergeGameDetailsPreservingAchievements(candidate, details),
                  stats,
                )
              : candidate,
          );
        });
        achievementHoverRefreshedRef.current.add(refreshKey);
      })
      .catch(() => undefined)
      .finally(() => {
        achievementHoverInFlightRef.current.delete(appId);
      });
  }, []);

  const handlePlayGame = useCallback(
    async (game: GhostBoxGame) => {
      if (isBlockedSteamDemo(game)) return;
      setLaunchingGameId(game.id);
      try {
        // Saves must be back in place before Steam opens the game.
        await autoRestoreCloudBackup(game);
        const result = await ghostboxApi.launchGame(game);
        if (result && !result.success) {
          showToast(
            "Falha ao iniciar",
            result.error ?? "Não foi possível iniciar o jogo.",
            "error",
          );
        }
        if (result?.success) {
          setProfileHistoryGames((current) =>
            upsertProfileHistoryGame(current, {
              ...game,
              lastTimePlayed: new Date().toISOString(),
            }),
          );
          await refreshGamePlaytimes();
        }
      } finally {
        setLaunchingGameId((current) => (current === game.id ? null : current));
      }
    },
    [autoRestoreCloudBackup, refreshGamePlaytimes, showToast],
  );

  // Override de launch: associa um .exe personalizado a um jogo e o persiste
  // em disco. O bypass do fluxo LuaTools/Steam-register é intencional: este
  // comando grava direto em `ghostbox-library.json`. Retorna o jogo atualizado
  // ou null em falha (toast já mostrado).
  const setCustomExeGame = useCallback(
    async (
      game: GhostBoxGame,
      customExePath: string,
      launchArguments = "",
      options?: { showSuccessToast?: boolean },
    ): Promise<GhostBoxGame | null> => {
      const trimmed = customExePath.trim();
      const trimmedArguments = launchArguments.trim();
      try {
        const result = await ghostboxApi.setCustomExe(
          game,
          trimmed,
          trimmedArguments,
        );
        if (!result.success) {
          showToast(
            appearance.language === "en" ? "Could not set executable" : "Falha ao definir executável",
            result.error || (appearance.language === "en" ? "Unknown error." : "Erro desconhecido."),
            "error",
          );
          return null;
        }
        const libraryGame = mergeGamePlaytime({
          ...result.libraryGame,
          librarySource: result.libraryGame.librarySource ?? "registered",
          customExePath: trimmed || undefined,
          launchArguments: trimmedArguments || undefined,
        });

        setScannedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, libraryGame),
        );
        setAddedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, libraryGame),
        );
        setAddedLibraryGameAppIds((current) =>
          new Set(current).add(libraryGame.appId),
        );
        if (options?.showSuccessToast !== false) {
          showToast(
            appearance.language === "en" ? "Executable set" : "Executável definido",
            trimmed
              ? appearance.language === "en"
                ? `${libraryGame.title} will launch from ${trimmed}.`
                : `${libraryGame.title} iniciará a partir de ${trimmed}.`
              : appearance.language === "en"
                ? `${libraryGame.title} will launch via Steam again.`
                : `${libraryGame.title} voltará a iniciar pela Steam.`,
          );
        }
        return libraryGame;
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : (appearance.language === "en"
            ? "Could not set the custom executable."
            : "Não foi possível definir o executável personalizado.");
        showToast(
          appearance.language === "en" ? "Could not set executable" : "Falha ao definir executável",
          errorMessage,
          "error",
        );
        return null;
      }
    },
    [appearance.language, showToast],
  );

  const addGameToUserCollection = useCallback(
    (game: GhostBoxGame, collectionId: string) => {
      setUserCollections((current) =>
        current.map((collection) =>
          collection.id === collectionId &&
          !collection.gameIds.includes(game.id)
            ? {
                ...collection,
                gameIds: [...collection.gameIds, game.id],
                games: [...(collection.games ?? []), game],
              }
            : collection,
        ),
      );
      const collectionName =
        userCollections.find((collection) => collection.id === collectionId)?.name ??
        "coleção";
      pushAppNotification({
        id: `collection:add:${collectionId}:${game.id}:${Date.now()}`,
        type: "collection",
        severity: "success",
        title: appearance.language === "en"
          ? "Added to collection"
          : "Adicionado à coleção",
        message: appearance.language === "en"
          ? `${game.title} was added to the ${collectionName} collection.`
          : `${game.title} foi adicionado à coleção ${collectionName}.`,
        createdAt: Date.now(),
        game: {
          appId: game.appId,
          title: game.title,
          coverUrl: game.coverUrl,
          headerUrl: game.heroUrl,
        },
      });
    },
    [appearance.language, pushAppNotification, userCollections],
  );

  const removeGameFromCollection = useCallback(
    (game: GhostBoxGame, collectionId: string) => {
      setUserCollections((current) =>
        current.map((collection) =>
          collection.id === collectionId
            ? {
                ...collection,
                gameIds: collection.gameIds.filter((id) => id !== game.id),
                games: (collection.games ?? []).filter(
                  (item) => item.id !== game.id,
                ),
              }
            : collection,
        ),
      );
      const collectionName =
        userCollections.find((collection) => collection.id === collectionId)?.name ??
        "coleção";
      pushAppNotification({
        id: `collection:remove:${collectionId}:${game.id}:${Date.now()}`,
        type: "collection",
        severity: "info",
        title: appearance.language === "en"
          ? "Removed from collection"
          : "Removido da coleção",
        message: appearance.language === "en"
          ? `${game.title} was removed from the ${collectionName} collection.`
          : `${game.title} foi removido da coleção ${collectionName}.`,
        createdAt: Date.now(),
        game: {
          appId: game.appId,
          title: game.title,
          coverUrl: game.coverUrl,
          headerUrl: game.heroUrl,
        },
      });
    },
    [appearance.language, pushAppNotification, userCollections],
  );

  const deleteCollection = useCallback((collectionId: string) => {
    setUserCollections((current) =>
      current.filter((collection) => collection.id !== collectionId),
    );
  }, []);

  const createUserCollection = useCallback(
    (collectionName: string) => {
      const trimmed = collectionName.trim();
      if (!trimmed) return;

      const reserved = new Set([
        "biblioteca",
        "favoritos",
        ...userCollections.map((c) => c.name.toLowerCase()),
      ]);
      if (reserved.has(trimmed.toLowerCase())) {
        showToast("Coleção existente", `A coleção ${trimmed} já existe.`, "error");
        return;
      }

      setUserCollections((current) => [
        ...current,
        {
          id: `collection-${Date.now().toString(36)}`,
          name: trimmed,
          gameIds: [],
          games: [],
        },
      ]);
      setCollectionModalOpen(false);
      showToast("Coleção criada", `${trimmed} foi adicionada ao perfil.`);
      pushAppNotification({
        id: `collection:create:${trimmed}:${Date.now()}`,
        type: "collection",
        severity: "success",
        title: appearance.language === "en"
          ? "Collection created"
          : "Coleção criada",
        message: appearance.language === "en"
          ? `${trimmed} was added to your profile.`
          : `${trimmed} foi adicionada ao perfil.`,
        createdAt: Date.now(),
      });
    },
    [appearance.language, pushAppNotification, setCollectionModalOpen, showToast, userCollections],
  );

  const openCreateUserCollectionModal = useCallback(() => {
    setCollectionModalOpen(true);
  }, [setCollectionModalOpen]);

  const handleConnectSteam = useCallback(async () => {
    if (isSteamSigningIn) return;
    // Must test the steamId, not the object: after a cloud-profile restore
    // there is a profile with an empty steamId, and bailing on that made the
    // "Connect Steam" button a no-op for account-only users.
    if (isSteamConnected(steamProfile)) return;

    const requestId = ++steamProfileRequestSequenceRef.current;
    setIsSteamSigningIn(true);
    showToast(
      appearance.language === "en" ? "Waiting for Steam" : "Aguardando Steam",
      appearance.language === "en"
        ? "Complete the connection in your browser."
        : "Conclua a conexão no navegador aberto.",
    );

    try {
      const profile = await ghostboxApi.connectSteamAccount();
      if (steamProfileRequestSequenceRef.current !== requestId) {
        // The request was invalidated (sign-out) after Rust may have already
        // persisted the profile: undo that write.
        if (!accountUserIdRef.current) {
          void ghostboxApi.clearLocalSteamProfile().catch(() => undefined);
        }
        return;
      }

      setIsCloudProfileRestoring(true);
      steamProfileRef.current = profile;
      setSteamProfile(profile);
      writeStoredSteamProfile(profile);
      await refreshAccount();
      void syncPlaytimesFromSteam(profile?.steamId);
      void restoreCloudProfileFromRemote();
      showToast(
        appearance.language === "en" ? "Steam connected" : "Steam conectada",
        appearance.language === "en"
          ? `Connected as ${profile.displayName}.`
          : `Conectado como ${profile.displayName}.`,
      );
    } catch (error) {
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      showToast(
        appearance.language === "en"
          ? "Steam connection failed"
          : "Conexão com a Steam falhou",
        formatSteamLoginError(error, appearance.language),
        "error",
      );
    } finally {
      if (steamProfileRequestSequenceRef.current === requestId) {
        setIsSteamSigningIn(false);
      }
    }
  }, [
    appearance.language,
    isSteamSigningIn,
    restoreCloudProfileFromRemote,
    showToast,
    steamProfile,
    syncPlaytimesFromSteam,
    refreshAccount,
  ]);

  // Disconnecting Steam only drops the Steam connection and its local profile
  // cache — the GhostBox account session stays alive, and so does its cloud
  // profile. The cloud bookkeeping (updatedAt, restored marker, unresolved
  // favorites) is account-scoped now and deliberately survives: wiping the
  // local updatedAt here would let the next upload overwrite the account's
  // cloud snapshot with the freshly emptied local state. Signing out of the
  // account is what clears all of it, via clearStoredAccountData().
  const handleDisconnectSteam = useCallback(async () => {
    ++steamProfileRequestSequenceRef.current;
    await ghostboxApi.disconnectSteamAccount();
    setSteamProfile(null);
    writeStoredSteamProfile(null);
    await refreshAccount();

    // Game history and last fetched metrics remain account-scoped and usable
    // offline. A later Steam connection replaces them only with newer data.

    if (cloudProfileRestoreRetryTimerRef.current !== null) {
      window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
      cloudProfileRestoreRetryTimerRef.current = null;
    }
  }, [refreshAccount]);

  const handleRestartSteam = useCallback(async () => {
    const result = await ghostboxApi.restartSteam();
    if (result?.success) {
      showToast("Steam reiniciada", "Steam foi reiniciada com sucesso.");
      return;
    }

    showToast(
      "Falha ao abrir Steam",
      result?.error ?? "Não foi possível localizar ou abrir a Steam.",
      "error",
    );
  }, [showToast]);

  const handleUpdateProfile = useCallback(
    async (
      displayName: string,
      avatarUrl: string,
      bannerUrl: string,
      bannerPosition: NonNullable<SteamProfile["bannerPosition"]>,
    ) => {
      // Steam is optional, and the profile being edited is the GhostBox
      // account's. With no Steam connected there is nothing to spread from, so
      // start from an empty shell — bailing out here left the edit and cover
      // buttons silently dead for account-only users.
      const currentProfile: SteamProfile = steamProfile ?? {
        steamId: "",
        displayName: "",
        avatarUrl: "",
        profileUrl: "",
      };

      const previousBannerUrl = currentProfile.bannerUrl;
      const currentBannerPosition = {
        x: Math.min(100, Math.max(0, Math.round(currentProfile.bannerPosition?.x ?? 50))),
        y: Math.min(100, Math.max(0, Math.round(currentProfile.bannerPosition?.y ?? 50))),
        scale: Math.min(
          3,
          Math.max(1, Number((currentProfile.bannerPosition?.scale ?? 1).toFixed(2))),
        ),
      };
      const bannerChanged =
        (previousBannerUrl ?? "") !== bannerUrl ||
        currentBannerPosition.x !== bannerPosition.x ||
        currentBannerPosition.y !== bannerPosition.y ||
        (currentBannerPosition.scale ?? 1) !== (bannerPosition.scale ?? 1);
      const canUseCloudImages = await hasPremiumCloudProfileAccess();
      if (bannerChanged && !canUseCloudImages) {
        showToast(
          appearance.language === "en" ? "Premium feature" : "Recurso Premium",
          appearance.language === "en"
            ? "Changing the profile banner is available with Premium."
            : "A alteração da capa do perfil está disponível no Premium.",
          "error",
        );
        return;
      }

      const optimisticProfile: SteamProfile = {
        ...currentProfile,
        displayName,
        avatarUrl,
        bannerUrl,
        bannerPosition,
      };
      setSteamProfile(optimisticProfile);
      let persistedAvatarUrl = avatarUrl;
      let persistedBannerUrl = bannerUrl;
      try {
        if (canUseCloudImages) {
          if (/^data:/i.test(persistedAvatarUrl)) {
            persistedAvatarUrl =
              (await ghostboxApi.uploadProfileImage(
                persistedAvatarUrl,
                "avatar",
              )) || "";
            if (!persistedAvatarUrl) throw new Error("avatar upload failed");
          }
          if (/^data:/i.test(persistedBannerUrl)) {
            persistedBannerUrl =
              (await ghostboxApi.uploadProfileImage(
                persistedBannerUrl,
                "banner",
              )) || "";
            if (!persistedBannerUrl) throw new Error("banner upload failed");
          } else if (!persistedBannerUrl && previousBannerUrl) {
            if (!(await ghostboxApi.deleteProfileBanner()))
              throw new Error("banner delete failed");
          }
        }
      } catch (error) {
        const rawMessage =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "";
        const message = rawMessage.trim()
          ? rawMessage
          : "Não foi possível enviar as imagens para a nuvem.";
        setSteamProfile(steamProfile);
        showToast("Falha ao salvar perfil", message, "error");
        return;
      }

      const nextProfile: SteamProfile = {
        ...currentProfile,
        displayName,
        avatarUrl: persistedAvatarUrl,
        bannerUrl: persistedBannerUrl,
        bannerPosition,
      };

      setSteamProfile(nextProfile);
      writeStoredSteamProfile(nextProfile);
      await ghostboxApi.saveSteamProfile(nextProfile);
      scheduleCloudProfileSync();
    },
    [
      hasPremiumCloudProfileAccess,
      appearance.language,
      scheduleCloudProfileSync,
      showToast,
      steamProfile,
    ],
  );

  const handleStartupSettingsChange = useCallback(
    async (settings: Partial<StartupSettings>) => {
      const next = await ghostboxApi.setStartupSettings(settings);
      if (next) setStartupSettings(next);
    },
    [],
  );

  const handleMorrenusApiKeySave = useCallback(
    async (key: string) => {
      try {
        const saved = await ghostboxApi.setMorrenusApiKey(key);
        setMorrenusApiKey(saved);
        showToast(
          appearance.language === "en"
            ? "HubCap's key saved"
            : "Chave HubCap's salva",
          appearance.language === "en"
            ? "Your Hubcap's Manifest API key was saved."
            : "A chave do Hubcap's Manifest foi salva.",
        );
      } catch (error) {
        showToast(
          appearance.language === "en"
            ? "Failed to save HubCap's key"
            : "Falha ao salvar chave HubCap's",
          error instanceof Error
            ? error.message
            : appearance.language === "en"
              ? "Could not save the API key."
              : "Não foi possível salvar a chave.",
          "error",
        );
      }
    },
    [appearance.language, showToast],
  );

  /**
   * Aplica o path escolhido — pelo diálogo nativo ou digitado no modal — e
   * escaneia a biblioteca. Retorna `false` quando o path não serve, para que o
   * chamador possa manter o modal aberto com o que o usuário digitou.
   */
  const applySteamPathSelection = useCallback(
    async (result: SteamPathSelectionResult | undefined) => {
      if (result?.status === "ok") {
        setSteamPathInput(result.steamPath);
        const scanResult = await ghostboxApi.scanSteamLibrary(result.steamPath);
        if (scanResult?.status === "ok") {
          applySteamLibraryScanResult(scanResult);
          showToast(
            "Biblioteca Steam sincronizada",
            `${scanResult.games.length} jogos instalados encontrados.`,
          );
          return true;
        }
        if (scanResult?.status === "missing") {
          showToast("Steam não encontrada", scanResult.message, "error");
        }
        return false;
      }

      if (result?.status === "invalid") {
        showToast("Caminho inválido", result.message, "error");
      }
      return false;
    },
    [applySteamLibraryScanResult, showToast],
  );

  const handleSelectSteamPath = useCallback(async () => {
    setIsScanningSteamLibrary(true);
    try {
      await applySteamPathSelection(await ghostboxApi.selectSteamPath());
    } finally {
      setIsScanningSteamLibrary(false);
    }
  }, [applySteamPathSelection]);

  const handleSubmitSteamPath = useCallback(
    async (steamPath: string) => {
      setIsScanningSteamLibrary(true);
      try {
        return await applySteamPathSelection(
          await ghostboxApi.submitSteamPath(steamPath),
        );
      } finally {
        setIsScanningSteamLibrary(false);
      }
    },
    [applySteamPathSelection],
  );

  useEffect(() => {
    let cancelled = false;

    setIsScanningSteamLibrary(true);
    void ghostboxApi
      .scanSteamLibrary()
      .then((result) => {
        if (!cancelled && result?.status === "ok") {
          applySteamLibraryScanResult(result);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsScanningSteamLibrary(false);
          markInitialLoadStepComplete("steamLibrary");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySteamLibraryScanResult, markInitialLoadStepComplete]);

  useEffect(() => {
    let cancelled = false;
    const steamId = steamProfile?.steamId ?? null;
    const PLAYTIME_BOOT_TIMEOUT_MS = 12_000;

    void (async () => {
      try {
        const work =
          steamId != null && steamId.trim()
            ? syncPlaytimesFromSteam(steamId)
            : refreshGamePlaytimes();
        await Promise.race([
          work,
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, PLAYTIME_BOOT_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        console.warn(
          "[GhostBox] Initial playtime sync failed; showing last cached playtimes instead.",
          error,
        );
        await refreshGamePlaytimes().catch(() => undefined);
      } finally {
        if (!cancelled) markInitialLoadStepComplete("playtimes");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    markInitialLoadStepComplete,
    refreshGamePlaytimes,
    steamProfile?.steamId,
    syncPlaytimesFromSteam,
  ]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      isInitialLoading,
      initialLoadingProgress,
      favoriteGames,
      addedLibraryGames,
      userCollections,
      steamProfile,
      isCloudProfileRestoring,
      isSteamSigningIn,
      isScanningSteamLibrary,
      addingGameId,
      removingGameId,
      launchingGameId,
      activeSessionAppIds,
      favoriteGameIds,
      addedLibraryGameAppIds,
      availableLibraryGameAppIds,
      playableGameAppIds,
      installedSteamGameAppIds,
      backupSettings,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
      showSteamLibraryGames,
      hiddenProfileGameIds,
      steamAccountStats,
      cloudSaveAppIds,
      profileHistoryGames: profileHistoryGamesWithPlaytime,
      profileFavoriteGames,
      profileAddedLibraryGames,
      handleGameDetailsLoaded,
      refreshGameAchievements,
      toggleFavoriteGame,
      queueGame,
      removeQueuedGame,
      requestRemoveGame,
      uninstallGame,
      handlePlayGame,

      setCustomExeGame,
      addGameToUserCollection,
      removeGameFromCollection,
      deleteCollection,
      createUserCollection,
      openCreateUserCollectionModal,
      handleConnectSteam,
      handleDisconnectSteam,
      handleRestartSteam,
      handleUpdateProfile,
      setBackupSettings,
      setMorrenusApiKey,
      setInitialPage,
      setSteamPathInput,
      setShowSteamGames,
      setShowSteamLibraryGames,
      setProfileGameHidden,
      handleStartupSettingsChange,
      handleMorrenusApiKeySave,
      handleSelectSteamPath,
      handleSubmitSteamPath,
    }),
    [
      favoriteGames,
      isInitialLoading,
      initialLoadingProgress,
      addedLibraryGames,
      userCollections,
      steamProfile,
      isCloudProfileRestoring,
      isSteamSigningIn,
      isScanningSteamLibrary,
      addingGameId,
      removingGameId,
      launchingGameId,
      activeSessionAppIds,
      favoriteGameIds,
      addedLibraryGameAppIds,
      availableLibraryGameAppIds,
      playableGameAppIds,
      installedSteamGameAppIds,
      backupSettings,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
      showSteamLibraryGames,
      hiddenProfileGameIds,
      steamAccountStats,
      cloudSaveAppIds,
      profileHistoryGamesWithPlaytime,
      profileFavoriteGames,
      profileAddedLibraryGames,
      handleGameDetailsLoaded,
      refreshGameAchievements,
      toggleFavoriteGame,
      queueGame,
      removeQueuedGame,
      requestRemoveGame,
      uninstallGame,
      handlePlayGame,
      setCustomExeGame,
      addGameToUserCollection,
      removeGameFromCollection,
      deleteCollection,
      createUserCollection,
      openCreateUserCollectionModal,
      handleConnectSteam,
      handleDisconnectSteam,
      handleRestartSteam,
      handleUpdateProfile,
      setProfileGameHidden,
      handleStartupSettingsChange,
      handleMorrenusApiKeySave,
      handleSelectSteamPath,
      handleSubmitSteamPath,
    ],
  );

  const removeConfirmHasLocalInstall = removeConfirmGame
    ? readDownloadTasks().some(
        (t) =>
          t.appId === (removeConfirmGame.appId || removeConfirmGame.id.replace(/^steam-/, "")) &&
          t.status === "completed",
      )
    : false;

  return (
    <AppDataContext.Provider value={value}>
      {children}
      <UninstallConfirmModal
        open={removeConfirmGame !== null}
        gameTitle={removeConfirmGame?.title ?? ""}
        hasLocalInstall={removeConfirmHasLocalInstall}
        onCancel={() => setRemoveConfirmGame(null)}
        onRemoveOnly={() => {
          if (removeConfirmGame) void removeQueuedGame(removeConfirmGame);
          setRemoveConfirmGame(null);
        }}
        onRemoveAndUninstall={() => {
          if (removeConfirmGame) void uninstallGame(removeConfirmGame);
          setRemoveConfirmGame(null);
        }}
      />
    </AppDataContext.Provider>
  );
}


export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider");
  }
  return context;
}
