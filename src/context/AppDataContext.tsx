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
import type { GamePlaytimeSnapshot } from "../lib/ghostboxApi.types";
import {
  applyCloudProfileToLocal,
  buildCloudProfileSnapshot,
  isCloudSnapshotNewer,
} from "../lib/cloudProfile";
import { formatSteamLoginError, mergeSteamProfile } from "../lib/steamProfile";
import {
  createBackupToastFromRecord,
  getLatestChangedBackupRecord,
  isAppFocused,
  showDesktopBackupNotification,
} from "../lib/backupNotifications";
import { isHiddenLibraryGame } from "../utils/filters";
import { preloadGamePortraitSources } from "../utils/image";
import { normalizeSteamGameTitles } from "../utils/steamTitles";
import {
  buildSteamOwnedGamesFromPlaytimes,
  buildSteamOwnedGamesFromSnapshot,
  mergeSteamOwnedLibraryGames,
} from "../utils/steamLibraryMerge";
import { mergeSteamAchievementsIntoGames } from "../utils/steamAchievementMerge";
import {
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
  readStoredUserCollections,
  readStoredSteamProfile,
  readStoredStartupPage,
  readStoredShowSteamGames,
  readStoredCloudProfileUpdatedAt,
  writeStoredFavoriteGames,
  writeStoredProfileHistoryGames,
  writeStoredUserCollections,
  writeStoredSteamProfile,
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

function applyPlaytimeToGame(
  game: GhostBoxGame,
  snapshot: GamePlaytimeSnapshot,
): GhostBoxGame {
  const playtime = snapshot[game.appId];
  if (!playtime) {
    return { ...game, sessionActive: false };
  }

  return {
    ...game,
    playTimeInMilliseconds: playtime.playTimeInMilliseconds,
    lastTimePlayed: playtime.lastTimePlayed,
    lastSessionRecordedAt: playtime.lastSessionRecordedAt,
    lastSessionDurationInMilliseconds:
      playtime.lastSessionDurationInMilliseconds,
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
    const playtime = snapshot[game.appId];

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
      lastTimePlayed: playtime.lastTimePlayed,
      lastSessionRecordedAt: playtime.lastSessionRecordedAt,
      lastSessionDurationInMilliseconds:
        playtime.lastSessionDurationInMilliseconds,
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
  handleSteamSignIn: () => Promise<void>;
  handleSteamSignOut: () => Promise<void>;
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

  const [favoriteGames, setFavoriteGames] = useState<GhostBoxGame[]>(() =>
    readStoredFavoriteGames(),
  );
  const [addedLibraryGames, setAddedLibraryGames] = useState<GhostBoxGame[]>(
    [],
  );
  const [scannedLibraryGames, setScannedLibraryGames] = useState<GhostBoxGame[]>(
    [],
  );
  const [steamOwnedLibraryGames, setSteamOwnedLibraryGames] = useState<
    GhostBoxGame[]
  >([]);
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
  const [showSteamGames, setShowSteamGames] = useState(() =>
    readStoredShowSteamGames(),
  );
  const [steamAccountStats, setSteamAccountStats] =
    useState<SteamAccountStats | null>(null);
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
  const cloudProfileRestoredSteamIdRef = useRef<string | null>(null);
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
    async (steamId?: string | null, snapshot: GamePlaytimeSnapshot = gamePlaytimesRef.current) => {
      const id = steamId?.trim();
      if (!id) {
        setSteamOwnedLibraryGames([]);
        return;
      }

      const fallbackGames = buildSteamOwnedGamesFromSnapshot(snapshot);
      if (fallbackGames.length > 0) setSteamOwnedLibraryGames(fallbackGames);

      const stats = await ghostboxApi.getSteamAccountStats(id).catch(() => null);
      if (stats) setSteamAccountStats(stats);
      if (!stats?.ownedPlaytimes?.length) return;

      setSteamOwnedLibraryGames(
        buildSteamOwnedGamesFromPlaytimes(stats.ownedPlaytimes, snapshot),
      );
    },
    [],
  );

  const refreshGamePlaytimes = useCallback(async () => {
    const snapshot = await ghostboxApi.getGamePlaytimes();
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
          void refreshSteamOwnedLibraryGames(id, snapshot);
          return;
        }
        await refreshGamePlaytimes();
      } catch {
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
    steamProfileRef.current = steamProfile;
    if (!steamProfile?.steamId) {
      setSteamOwnedLibraryGames([]);
      setSteamAccountStats(null);
      steamAccountStatsRef.current = null;
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
      steamAccountStatsRef.current = stats;
      setSteamAccountStats(stats);
      if (stats.ownedPlaytimes?.length) {
        setSteamOwnedLibraryGames(
          buildSteamOwnedGamesFromPlaytimes(
            stats.ownedPlaytimes,
            gamePlaytimesRef.current,
          ),
        );
      }
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
      const gameById = new Map<string, GhostBoxGame>();
      for (const game of favoriteGamesRef.current) gameById.set(game.id, game);
      for (const game of addedLibraryGamesRef.current)
        gameById.set(game.id, game);
      for (const game of profileHistoryGamesRef.current)
        gameById.set(game.id, game);
      for (const game of extraGames) gameById.set(game.id, game);

      return collections.map((collection) => ({
        ...collection,
        games: collection.gameIds.flatMap((gameId) => {
          const game = gameById.get(gameId);
          return game ? [game] : [];
        }),
      }));
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
    const profile = steamProfileRef.current;
    if (!profile?.steamId) return false;

    const session = await ghostboxApi.getCloudSession();
    if (!session?.token) return false;

    return ghostboxApi.isPremiumUser(profile.steamId);
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
    const profile = steamProfileRef.current;
    if (!profile?.steamId) return;

    cloudProfileSyncInFlightRef.current = true;
    try {
      if (!(await hasPremiumCloudProfileAccess())) return;

      const updatedAt =
        cloudProfileLocalUpdatedAtRef.current || markCloudProfileLocalUpdated();
      let cloudProfile = profile;
      if (/^data:/i.test(cloudProfile.avatarUrl || "")) {
        const uploaded = await ghostboxApi.uploadProfileImage(
          cloudProfile.avatarUrl || "",
          "avatar",
        );
        if (!uploaded) return;
        cloudProfile = { ...cloudProfile, avatarUrl: uploaded };
      }
      if (/^data:/i.test(cloudProfile.bannerUrl || "")) {
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
    if (!steamProfileRef.current?.steamId) return;
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
    const currentProfile = steamProfileRef.current;
    if (!currentProfile?.steamId) {
      setIsCloudProfileRestoring(false);
      return false;
    }

    cloudProfileRestoreInFlightRef.current = true;
    let shouldFlushPendingUpload = false;
    try {
      if (!(await hasPremiumCloudProfileAccess())) return false;
      setIsCloudProfileRestoring(true);

      const remote = await ghostboxApi.getCloudProfileSnapshot();
      if (!remote) {
        cloudProfileRestoredSteamIdRef.current = currentProfile.steamId;
        cloudProfilePendingUploadRef.current = true;
        shouldFlushPendingUpload = true;
        return true;
      }

      const localUpdatedAt = cloudProfileLocalUpdatedAtRef.current;
      const localHasData =
        Boolean(currentProfile.bannerUrl) ||
        favoriteGamesRef.current.length > 0 ||
        userCollectionsRef.current.length > 0;

      if (
        localHasData &&
        !isCloudSnapshotNewer(remote.updatedAt, localUpdatedAt)
      ) {
        if (isCloudSnapshotNewer(localUpdatedAt, remote.updatedAt)) {
          cloudProfileRestoredSteamIdRef.current = currentProfile.steamId;
          cloudProfilePendingUploadRef.current = true;
          shouldFlushPendingUpload = true;
        }
        cloudProfileRestoredSteamIdRef.current = currentProfile.steamId;
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
      cloudProfileRestoredSteamIdRef.current = currentProfile.steamId;
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
    const steamId = steamProfile?.steamId?.trim();
    if (!steamId) {
      setIsCloudProfileRestoring(false);
      if (cloudProfileRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(cloudProfileRestoreRetryTimerRef.current);
        cloudProfileRestoreRetryTimerRef.current = null;
      }
      return;
    }
    if (cloudProfileRestoredSteamIdRef.current === steamId) return;
    void restoreCloudProfileFromRemote().then((restored) => {
      if (
        restored ||
        steamProfileRef.current?.steamId !== steamId ||
        cloudProfileRestoredSteamIdRef.current === steamId
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
  }, [cloudProfileRestoreRetryTick, restoreCloudProfileFromRemote, steamProfile?.steamId]);

  useEffect(() => {
    setUserCollections((current) => {
      if (current.length === 0) return current;
      const next = rehydrateCollectionGames(current);
      const changed = next.some((collection, index) => {
        const previous = current[index];
        return (
          (previous?.games?.length ?? 0) !== (collection.games?.length ?? 0)
        );
      });
      return changed ? next : current;
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
    writeStoredShowSteamGames(showSteamGames);
  }, [showSteamGames]);

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

      for (const achievementName of payload.achievements) {
        const message = `${payload.title}: ${achievementName}`;

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

  const applySteamLibraryScanResult = useCallback(
    (result: SteamLibraryScanResult) => {
      if (result.status !== "ok") return;

      const games = normalizeSteamGameTitles(
        result.games.filter((game) => !isHiddenLibraryGame(game)),
        [...favoriteGamesRef.current, ...profileHistoryGamesRef.current],
      );
      setSteamPathInput(result.steamPath);
      setScannedLibraryGames(games);
    },
    [],
  );

  useEffect(() => {
    const games = mergeSteamAchievementsIntoGames(
      mergeSteamOwnedLibraryGames(
        scannedLibraryGames,
        steamOwnedLibraryGames.filter((game) => !isHiddenLibraryGame(game)),
        showSteamGames,
      ),
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
  }, [
    mergeGamePlaytime,
    scannedLibraryGames,
    showSteamGames,
    steamAccountStats,
    steamOwnedLibraryGames,
  ]);

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
    },
    [favoriteGameIds, showToast],
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
        const isSteamOwnedGame =
          isKnownSteamOwnedGame ||
          Boolean(
            steamProfile?.steamId &&
            (await ghostboxApi
              .getSteamAccountStats(steamProfile.steamId)
              .then(
                (stats) =>
                  stats?.ownedPlaytimes?.some(
                    (playtime) => playtime.appId === game.appId,
                  ) ?? false,
              )
              .catch(() => false)),
          );

        const result = isSteamOwnedGame
          ? await registerSteamLibraryGame(game)
          : await addGameViaLuaTools(game);
        if (!result.success) {
          showToast("Falha ao adicionar", result.error);
          return;
        }
        if (isHiddenLibraryGame(result.libraryGame)) return;

        setAddedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, result.libraryGame),
        );
        setAddedLibraryGameAppIds((current) =>
          new Set(current).add(result.libraryGame.appId),
        );
        showToast(
          "Jogo adicionado",
          isSteamOwnedGame
            ? `${result.libraryGame.title} foi reconhecido na Biblioteca.`
            : `${result.libraryGame.title} foi adicionado à Biblioteca.`,
        );
      } catch (error) {
        showToast(
          "Falha ao adicionar",
          error instanceof Error
            ? error.message
            : "Não foi possível concluir o fluxo LuaTools.",
        );
      } finally {
        setAddingGameId(null);
      }
    },
    [
      addingGameId,
      availableLibraryGameAppIds,
      removingGameId,
      showToast,
      steamProfile?.steamId,
    ],
  );

  const removeQueuedGame = useCallback(
    async (game: GhostBoxGame) => {
      if (addingGameId || removingGameId) return;
      setRemovingGameId(game.id);

      try {
        const result = await removeGameViaLuaTools(game);
        if (!result.success) {
          showToast("Falha ao remover", result.error);
          return;
        }

        setAddedLibraryGames((current) =>
          removeLibraryGameByAppId(current, result.appId),
        );
        setAddedLibraryGameAppIds((current) => {
          const next = new Set(current);
          next.delete(result.appId);
          return next;
        });

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
      } catch (error) {
        showToast(
          "Falha ao remover",
          error instanceof Error
            ? error.message
            : "Não foi possível remover o jogo.",
        );
      } finally {
        setRemovingGameId(null);
      }
    },
    [
      addingGameId,
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
        const result = await ghostboxApi.launchGame(game);
        if (result && !result.success) {
          showToast(
            "Falha ao iniciar",
            result.error ?? "Não foi possível iniciar o jogo.",
          );
        }
        if (result?.success) {
          await refreshGamePlaytimes();
        }
      } finally {
        setLaunchingGameId((current) => (current === game.id ? null : current));
      }
    },
    [refreshGamePlaytimes, showToast],
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
    },
    [],
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
    },
    [],
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
    },
    [setCollectionModalOpen, showToast, userCollections],
  );

  const openCreateUserCollectionModal = useCallback(() => {
    setCollectionModalOpen(true);
  }, [setCollectionModalOpen]);

  const handleSteamSignIn = useCallback(async () => {
    if (isSteamSigningIn) return;
    if (steamProfile) {
      const session = await ghostboxApi.getCloudSession();
      if (session?.token) return;
    }

    const requestId = ++steamProfileRequestSequenceRef.current;
    setIsSteamSigningIn(true);
    showToast(
      appearance.language === "en" ? "Waiting for Steam" : "Aguardando Steam",
      appearance.language === "en"
        ? "Complete the login in your browser."
        : "Conclua o login no navegador aberto.",
    );

    try {
      const profile = await ghostboxApi.signInWithSteam();
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      setIsCloudProfileRestoring(true);
      steamProfileRef.current = profile;
      setSteamProfile(profile);
      writeStoredSteamProfile(profile);
      void syncPlaytimesFromSteam(profile?.steamId);
      void restoreCloudProfileFromRemote();
      showToast(
        appearance.language === "en" ? "Login complete" : "Login concluído",
        appearance.language === "en"
          ? `Signed in as ${profile.displayName}.`
          : `Conectado como ${profile.displayName}.`,
      );
    } catch (error) {
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      showToast(
        appearance.language === "en"
          ? "Steam login failed"
          : "Login com Steam falhou",
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

  const handleSteamSignOut = useCallback(async () => {
    ++steamProfileRequestSequenceRef.current;
    await ghostboxApi.signOutSteam();
    await ghostboxApi.signOutCloud().catch(() => undefined);
    setSteamProfile(null);
    writeStoredSteamProfile(null);
    writeStoredCloudProfileUpdatedAt(null);
    cloudProfileLocalUpdatedAtRef.current = null;
    cloudProfileRestoredSteamIdRef.current = null;
    cloudProfileFavoriteGameIdsRef.current = [];
    cloudProfilePendingUploadRef.current = false;
    skipCloudProfileUploadCountRef.current = 0;
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
      if (!steamProfile) return;

      const previousBannerUrl = steamProfile.bannerUrl;
      const optimisticProfile: SteamProfile = {
        ...steamProfile,
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
        ...steamProfile,
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
      } catch {
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
      handleSteamSignIn,
      handleSteamSignOut,
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
      handleSteamSignIn,
      handleSteamSignOut,
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
