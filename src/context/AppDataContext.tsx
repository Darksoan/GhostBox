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
import type { CloudSave, GamePlaytimeSnapshot } from "../lib/ghostboxApi.types";
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
import {
  createBackupToastFromRecord,
  getLatestChangedBackupRecord,
  isAppFocused,
  showDesktopBackupNotification,
} from "../lib/backupNotifications";
import { isHiddenLibraryGame } from "../utils/filters";
import { preloadGamePortraitSources } from "../utils/image";
import { normalizeSteamGameTitles } from "../utils/steamTitles";

import { mergeSteamAchievementsIntoGames } from "../utils/steamAchievementMerge";
import {
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
  readStoredUserCollections,
  readStoredSteamProfile,
  readStoredSteamAccountStats,
  readStoredStartupPage,
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
  upsertProfileHistoryGame,
} from "../lib/profileHistoryGames";
import { showAchievementDesktopNotification } from "../lib/trayNotifications";
import { useOverlay } from "./OverlayContext";
import { useSettings } from "./settings";
import { useAuth } from "./AuthContext";
import type { BackupToastPayload } from "../lib/backupNotifications";

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
        .map((gameId) => loadGameDetailsCached(gameId)),
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
  backupSettings: BackupSettings | null;
  morrenusApiKey: string;
  startupSettings: StartupSettings | null;
  initialPage: StartupPage;
  steamPathInput: string;
  showSteamGames: boolean;
  steamAccountStats: SteamAccountStats | null;
  profileHistoryGames: GhostBoxGame[];
  profileFavoriteGames: GhostBoxGame[];
  profileAddedLibraryGames: GhostBoxGame[];
  handleGameDetailsLoaded: (details: GhostBoxGame) => void;
  toggleFavoriteGame: (game: GhostBoxGame) => void;
  queueGame: (game: GhostBoxGame) => Promise<void>;
  removeQueuedGame: (game: GhostBoxGame) => Promise<void>;
  handlePlayGame: (game: GhostBoxGame) => Promise<void>;
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
  handleStartupSettingsChange: (
    settings: Partial<StartupSettings>,
  ) => Promise<void>;
  handleMorrenusApiKeySave: (key: string) => Promise<void>;
  handleSelectSteamPath: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(
  undefined,
);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { showToast, setCollectionModalOpen } = useOverlay();
  const { appearance, notifications } = useSettings();
  const { account, linkedSteamId } = useAuth();
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
  // Steam account games are never auto-listed in the library.
  const showSteamGames = false;
  const setShowSteamGames = useCallback((_value: boolean) => {
    writeStoredShowSteamGames(false);
  }, []);
  const [steamAccountStats, setSteamAccountStats] =
    useState<SteamAccountStats | null>(() => readStoredSteamAccountStats());
  const steamAccountStatsRef = useRef<SteamAccountStats | null>(null);
  const backupSettingsRef = useRef<BackupSettings | null>(
    defaultBackupSettings,
  );
  const pendingBackupToastRef = useRef<BackupToastPayload | null>(null);
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

      const stats = await ghostboxApi.getSteamAccountStats(id).catch(() => null);
      if (
        stats &&
        (!steamAccountStatsRef.current ||
          stats.steamId !== steamAccountStatsRef.current.steamId ||
          stats.fetchedAt >= steamAccountStatsRef.current.fetchedAt)
      ) {
        steamAccountStatsRef.current = stats;
        setSteamAccountStats(stats);
        writeStoredSteamAccountStats(stats);
      }
    },
    [],
  );

  const refreshGamePlaytimes = useCallback(async () => {
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
      try {
        const snapshot = await ghostboxApi.syncSteamPlaytimes(id);
        if (snapshot && Object.keys(snapshot).length > 0) {
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
          void refreshSteamOwnedLibraryGames(id);
          return;
        }
        await refreshGamePlaytimes();
      } catch (error) {
        console.warn(
          "[GhostBox] Steam playtime sync failed; showing last cached playtimes instead.",
          error,
        );
        await refreshGamePlaytimes().catch(() => undefined);
      }
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

  useEffect(() => {
    accountUserIdRef.current = accountUserId;
  }, [accountUserId]);

  useEffect(() => {
    steamProfileRef.current = steamProfile;
    const steamId = steamProfile?.steamId?.trim();
    if (
      steamId &&
      steamAccountStatsRef.current?.steamId !== steamId
    ) {
      setSteamAccountStats(null);
      steamAccountStatsRef.current = null;
      writeStoredSteamAccountStats(null);
    }
  }, [steamProfile]);

  useEffect(() => {
    steamAccountStatsRef.current = steamAccountStats;
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
      const backupDetails = await ghostboxApi.getBackupDetails(
        game.appId,
        backupPath,
      );
      if (!backupDetails?.achievements.length) return;

      setProfileHistoryGames((current) =>
        upsertProfileHistoryGame(
          current,
          mergeBackupAchievementsIntoGame(game, backupDetails),
        ),
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

  const restoreCloudProfileFromRemote = useCallback(async (): Promise<boolean> => {
    if (cloudProfileRestoreInFlightRef.current) return false;
    const accountId = accountUserIdRef.current;
    if (!accountId) {
      setIsCloudProfileRestoring(false);
      return false;
    }
    const currentProfile = steamProfileRef.current;

    cloudProfileRestoreInFlightRef.current = true;
    let shouldFlushPendingUpload = false;
    try {
      if (!(await hasPremiumCloudProfileAccess())) return false;
      setIsCloudProfileRestoring(true);

      const remote = await ghostboxApi.getCloudProfileSnapshot();
      if (!remote) {
        cloudProfileRestoredUserIdRef.current = accountId;
        cloudProfilePendingUploadRef.current = true;
        shouldFlushPendingUpload = true;
        return true;
      }

      const localUpdatedAt = cloudProfileLocalUpdatedAtRef.current;
      const localHasData =
        Boolean(currentProfile?.bannerUrl) ||
        favoriteGamesRef.current.length > 0 ||
        userCollectionsRef.current.length > 0;

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
      skipCloudProfileUploadCountRef.current = 2;
      if (applied.steamProfile) {
        setSteamProfile(applied.steamProfile);
        writeStoredSteamProfile(applied.steamProfile);
        await ghostboxApi
          .saveSteamProfile(applied.steamProfile)
          .catch(() => undefined);
      }
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
    (record: BackupSettings["backupRecords"][string]) => {
      const shouldNotify =
        record.lastBackupSuccess !== false
          ? notifications.backupSuccessEnabled
          : notifications.backupErrorEnabled;
      if (!shouldNotify) return;

      const pendingToast = createBackupToastFromRecord(record);
      const createdAt = Date.parse(record.lastBackupAt);

      pushAppNotification({
        id: `backup:${record.title}:${record.lastBackupAt}:${record.lastBackupSuccess !== false ? "success" : "error"}`,
        type: "backup",
        severity: record.lastBackupSuccess !== false ? "success" : "error",
        title: pendingToast.title,
        message: pendingToast.message,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        game: { title: record.title },
      });

      if (isAppFocused()) {
        showToast(
          pendingToast.title,
          pendingToast.message,
          pendingToast.variant,
        );
      } else {
        pendingBackupToastRef.current = pendingToast;
      }

      const desktopEnabled =
        record.lastBackupSuccess !== false
          ? notifications.backupSuccessEnabled
          : notifications.backupErrorEnabled;

      showDesktopBackupNotification(
        pendingToast,
        notifications.desktopNotificationsEnabled && desktopEnabled,
      );
    },
    [
      notifications.backupErrorEnabled,
      notifications.backupSuccessEnabled,
      notifications.desktopNotificationsEnabled,
      showToast,
    ],
  );

  useEffect(() => {
    const flushPendingBackupToast = () => {
      if (!isAppFocused() || !pendingBackupToastRef.current) return;

      const pendingToast = pendingBackupToastRef.current;
      pendingBackupToastRef.current = null;
      showToast(pendingToast.title, pendingToast.message, pendingToast.variant);
    };

    window.addEventListener("focus", flushPendingBackupToast);
    document.addEventListener("visibilitychange", flushPendingBackupToast);

    return () => {
      window.removeEventListener("focus", flushPendingBackupToast);
      document.removeEventListener("visibilitychange", flushPendingBackupToast);
    };
  }, [showToast]);

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

      const changedRecord = getLatestChangedBackupRecord(
        backupSettingsRef.current,
        settings,
      );
      backupSettingsRef.current = settings;
      setBackupSettings(settings);
      if (changedRecord) queueBackupToast(changedRecord);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [markInitialLoadStepComplete, queueBackupToast]);

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

        await applyBackupAchievementsToProfileHistory(game).catch(() => undefined);
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
    writeStoredShowSteamGames(false);
  }, []);

  useEffect(() => {
    writeStoredProfileHistoryGames(profileHistoryGames);
  }, [profileHistoryGames]);

  useEffect(() => {
    void ghostboxApi.setTrayLibraryGames(
      addedLibraryGames.filter((game) => game.librarySource !== "steam-owned"),
    );
  }, [addedLibraryGames]);

  useEffect(() => {
    const achievementUnlockedTitle =
      appearance.language === "en"
        ? "Achievement unlocked"
        : "Conquista desbloqueada";

    return ghostboxApi.onLocalAchievementsUnlocked((payload) => {
      if (!notifications.achievementsEnabled) return;

      for (const [index, achievementName] of payload.achievements.entries()) {
        const message = `${payload.title}: ${achievementName}`;

        pushAppNotification({
          id: `achievement:${payload.title}:${achievementName}:${Date.now()}:${index}`,
          type: "achievement",
          severity: "success",
          title: achievementUnlockedTitle,
          message,
          createdAt: Date.now(),
          game: { appId: payload.appId, title: payload.title },
        });

        showAchievementDesktopNotification(
          achievementUnlockedTitle,
          message,
          notifications.desktopNotificationsEnabled,
        );
      }
    });
  }, [
    appearance.language,
    notifications.achievementsEnabled,
    notifications.desktopNotificationsEnabled,
  ]);

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
        steamProfileRef.current = profile;
        setSteamProfile(profile);
        writeStoredSteamProfile(profile);
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

    void ghostboxApi
      .getSteamProfile()
      .then((profile) => {
        if (cancelled || steamProfileRequestSequenceRef.current !== requestId)
          return;

        const merged = mergeSteamProfile(profile, steamProfileRef.current);
        if (merged) {
          setIsCloudProfileRestoring(true);
          steamProfileRef.current = merged;
          writeStoredSteamProfile(merged);
        }
        setSteamProfile(merged);
      })
      .catch(() => undefined)
      .finally(() => {
        if (
          !cancelled &&
          steamProfileRequestSequenceRef.current === requestId
        ) {
          markInitialLoadStepComplete("steamProfile");
        }
      });

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
      showToast(
        event.title,
        event.error ? `${event.message} ${event.error}` : event.message,
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
        if (notifications.backupSuccessEnabled) {
          showToast(title, message, "success");
        }
      } catch (error) {
        // Auto-restore is best-effort: never block adding or launching a game.
        // Still log it — a silent catch here hid expired cloud sessions.
        console.warn("Cloud auto-restore failed", appId, error);
      } finally {
        autoRestoreInFlightAppIdsRef.current.delete(appId);
      }
    },
    [
      appearance.language,
      hasPremiumCloudProfileAccess,
      notifications.backupSuccessEnabled,
      showToast,
    ],
  );

  const queueGame = useCallback(
    async (game: GhostBoxGame) => {
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
          const errorMessage = result.error || "Não foi possível adicionar o jogo à Biblioteca.";
          showToast("Falha ao adicionar", errorMessage);
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
        const errorMessage = error instanceof Error
          ? error.message
          : "Não foi possível concluir o fluxo LuaTools.";
        showToast(
          "Falha ao adicionar",
          errorMessage,
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
          const errorMessage = result.error || "Não foi possível remover o jogo.";
          showToast("Falha ao remover", errorMessage);
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
        const errorMessage = error instanceof Error
          ? error.message
          : "Não foi possível remover o jogo.";
        showToast(
          "Falha ao remover",
          errorMessage,
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

  const handlePlayGame = useCallback(
    async (game: GhostBoxGame) => {
      setLaunchingGameId(game.id);
      try {
        // Saves must be back in place before Steam opens the game.
        await autoRestoreCloudBackup(game);
        const result = await ghostboxApi.launchGame(game);
        if (result && !result.success) {
          showToast(
            "Falha ao iniciar",
            result.error ?? "Não foi possível iniciar o jogo.",
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
        showToast("Coleção existente", `A coleção ${trimmed} já existe.`);
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
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      setIsCloudProfileRestoring(true);
      steamProfileRef.current = profile;
      setSteamProfile(profile);
      writeStoredSteamProfile(profile);
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

    // Game history and last fetched metrics remain account-scoped and usable
    // offline. A later Steam connection replaces them only with newer data.

    if (cloudProfileRestoreRetryTimerRef.current !== null) {
      window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
      cloudProfileRestoreRetryTimerRef.current = null;
    }
  }, []);

  const handleRestartSteam = useCallback(async () => {
    const result = await ghostboxApi.restartSteam();
    if (result?.success) {
      showToast("Steam reiniciada", "Steam foi reiniciada com sucesso.");
      return;
    }

    showToast(
      "Falha ao abrir Steam",
      result?.error ?? "Não foi possível localizar ou abrir a Steam.",
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
        showToast("Falha ao salvar perfil", message);
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
    [scheduleCloudProfileSync, showToast, steamProfile],
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

  const handleSelectSteamPath = useCallback(async () => {
    setIsScanningSteamLibrary(true);
    try {
      const result = await ghostboxApi.selectSteamPath();
      if (result?.status === "ok") {
        setSteamPathInput(result.steamPath);
        const scanResult = await ghostboxApi.scanSteamLibrary(result.steamPath);
        if (scanResult?.status === "ok") {
          applySteamLibraryScanResult(scanResult);
          showToast(
            "Biblioteca Steam sincronizada",
            `${scanResult.games.length} jogos instalados encontrados.`,
          );
        } else if (scanResult?.status === "missing") {
          showToast("Steam não encontrada", scanResult.message);
        }
        return;
      }

      if (result?.status === "invalid") {
        showToast("Caminho inválido", result.message);
      }
    } finally {
      setIsScanningSteamLibrary(false);
    }
  }, [applySteamLibraryScanResult, showToast]);

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
      backupSettings,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
      steamAccountStats,
      profileHistoryGames: profileHistoryGamesWithPlaytime,
      profileFavoriteGames,
      profileAddedLibraryGames,
      handleGameDetailsLoaded,
      toggleFavoriteGame,
      queueGame,
      removeQueuedGame,
      handlePlayGame,
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
      handleStartupSettingsChange,
      handleMorrenusApiKeySave,
      handleSelectSteamPath,
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
      backupSettings,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
      steamAccountStats,
      profileHistoryGamesWithPlaytime,
      profileFavoriteGames,
      profileAddedLibraryGames,
      handleGameDetailsLoaded,
      toggleFavoriteGame,
      queueGame,
      removeQueuedGame,
      handlePlayGame,
      addGameToUserCollection,
      removeGameFromCollection,
      deleteCollection,
      createUserCollection,
      openCreateUserCollectionModal,
      handleConnectSteam,
      handleDisconnectSteam,
      handleRestartSteam,
      handleUpdateProfile,
      handleStartupSettingsChange,
      handleMorrenusApiKeySave,
      handleSelectSteamPath,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider");
  }
  return context;
}
