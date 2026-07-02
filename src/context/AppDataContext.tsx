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
  removeGameViaLuaTools,
} from "../data";
import type {
  BackupRootStatus,
  BackupSettings,
  StartupPage,
  StartupSettings,
  SteamLibraryScanResult,
  SteamProfile,
  UserCollection,
} from "../types";
import { ghostboxApi } from "../lib/ghostboxApi";
import type { GamePlaytimeSnapshot } from "../lib/ghostboxApi.types";
import {
  formatSteamLoginError,
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
import {
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
  readStoredUserCollections,
  readStoredSteamProfile,
  readStoredStartupPage,
  readStoredShowSteamGames,
  writeStoredFavoriteGames,
  writeStoredProfileHistoryGames,
  writeStoredUserCollections,
  writeStoredSteamProfile,
  writeStoredStartupPage,
  writeStoredShowSteamGames,
} from "../utils/storage";
import { loadGameAchievementDetailsCached } from "../utils/gameCache";
import {
  countUnlockedAchievements,
  createProfileHistoryFallbackGame,
  getBackupRecordLatestKey,
  mergeBackupAchievementsIntoGame,
  mergeGameDetailsPreservingAchievements,
  removeProfileHistoryGameByAppId,
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
  "steamLibrary",
  "playtimes",
  "backupRoot",
];

const defaultBackupSettings: BackupSettings = {
  outputPath: "",
  automaticBackupsForLibrary: false,
  automaticBackups: {},
  backupRecords: {},
  customExecutables: {},
};

function upsertLibraryGameByAppId(games: GhostBoxGame[], nextGame: GhostBoxGame) {
  return [nextGame, ...games.filter((game) => game.appId !== nextGame.appId)];
}

function removeLibraryGameByAppId(games: GhostBoxGame[], appId: string) {
  return games.filter((game) => game.appId !== appId);
}

function applyPlaytimeToGame(
  game: GhostBoxGame,
  snapshot: GamePlaytimeSnapshot
): GhostBoxGame {
  const playtime = snapshot[game.appId];
  return playtime
    ? {
        ...game,
        playTimeInMilliseconds: playtime.playTimeInMilliseconds,
        lastTimePlayed: playtime.lastTimePlayed,
        lastSessionRecordedAt: playtime.lastSessionRecordedAt,
        lastSessionDurationInMilliseconds:
          playtime.lastSessionDurationInMilliseconds,
        sessionActive: playtime.sessionActive === true,
      }
    : { ...game, sessionActive: false };
}

function applyPlaytimeSnapshotToGames(
  games: GhostBoxGame[],
  snapshot: GamePlaytimeSnapshot
) {
  let changed = false;

  const nextGames = games.map((game) => {
    const playtime = snapshot[game.appId];

    if (!playtime) {
      if (game.sessionActive === false) return game;
      changed = true;
      return { ...game, sessionActive: false };
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
      .map((entry) => entry.appId)
  );
}

interface AppDataContextValue {
  isInitialLoading: boolean;
  initialLoadingProgress: number;
  favoriteGames: GhostBoxGame[];
  addedLibraryGames: GhostBoxGame[];
  userCollections: UserCollection[];
  steamProfile: SteamProfile | null;
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
  backupRootStatus: BackupRootStatus | null;
  morrenusApiKey: string;
  startupSettings: StartupSettings | null;
  initialPage: StartupPage;
  steamPathInput: string;
  showSteamGames: boolean;
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
    bannerPosition: NonNullable<SteamProfile["bannerPosition"]>
  ) => Promise<void>;
  setBackupSettings: (settings: BackupSettings | null) => void;
  setMorrenusApiKey: (key: string) => void;
  setInitialPage: Dispatch<SetStateAction<StartupPage>>;
  setSteamPathInput: (path: string) => void;
  setShowSteamGames: (value: boolean) => void;
  handleStartupSettingsChange: (settings: Partial<StartupSettings>) => Promise<void>;
  handleMorrenusApiKeySave: (key: string) => Promise<void>;
  handleSelectSteamPath: () => Promise<void>;
  handleSelectBackupOutputPath: () => Promise<void>;
  handleToggleLibraryAutomaticBackups: (enabled: boolean) => Promise<void>;
  handleToggleAutomaticBackup: (game: GhostBoxGame, enabled: boolean) => Promise<void>;
  handleSelectGameExecutable: (game: GhostBoxGame) => Promise<void>;
  handleRemoveGameExecutable: (game: GhostBoxGame) => Promise<void>;
  handleOpenBackupFolder: (appId: string, backupPath?: string) => Promise<void>;
  handleDeleteBackupFolder: (
    appId: string,
    title: string,
    backupPath?: string
  ) => void;
  handleCreateBackupRoot: () => Promise<void>;
  refreshBackupRootStatus: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { showToast, setCollectionModalOpen } = useOverlay();
  const { appearance, notifications } = useSettings();

  const [favoriteGames, setFavoriteGames] = useState<GhostBoxGame[]>(() =>
    readStoredFavoriteGames()
  );
  const [addedLibraryGames, setAddedLibraryGames] = useState<GhostBoxGame[]>([]);
  const [userCollections, setUserCollections] = useState<UserCollection[]>(() =>
    readStoredUserCollections()
  );
  const [steamProfile, setSteamProfile] = useState<SteamProfile | null>(() =>
    readStoredSteamProfile()
  );
  const [isSteamSigningIn, setIsSteamSigningIn] = useState(false);
  const [isScanningSteamLibrary, setIsScanningSteamLibrary] = useState(false);
  const [addingGameId, setAddingGameId] = useState<string | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [launchingGameId, setLaunchingGameId] = useState<string | null>(null);
  const [activeSessionAppIds, setActiveSessionAppIds] = useState<Set<string>>(
    () => new Set()
  );
  const [addedLibraryGameAppIds, setAddedLibraryGameAppIds] = useState<
    Set<string>
  >(() => new Set());
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(
    defaultBackupSettings
  );
  const [backupRootStatus, setBackupRootStatus] =
    useState<BackupRootStatus | null>(null);
  const [morrenusApiKey, setMorrenusApiKey] = useState("");
  const [startupSettings, setStartupSettings] =
    useState<StartupSettings | null>(null);
  const [initialPage, setInitialPage] = useState<StartupPage>(() =>
    readStoredStartupPage() ?? "home"
  );
  const [steamPathInput, setSteamPathInput] = useState(
    "C:\\Program Files (x86)\\Steam"
  );
  const [showSteamGames, setShowSteamGames] = useState(() =>
    readStoredShowSteamGames()
  );
  const backupSettingsRef = useRef<BackupSettings | null>(defaultBackupSettings);
  const pendingBackupToastRef = useRef<BackupToastPayload | null>(null);
  const steamProfileRequestSequenceRef = useRef(0);
  const profileBackupSyncKeysRef = useRef(new Map<string, string>());
  const gamePlaytimesRef = useRef<GamePlaytimeSnapshot>({});
  const [profileHistoryGames, setProfileHistoryGames] = useState<GhostBoxGame[]>(
    () => readStoredProfileHistoryGames()
  );
  const [completedInitialLoadSteps, setCompletedInitialLoadSteps] = useState<
    Set<InitialLoadStep>
  >(() => new Set());

  const markInitialLoadStepComplete = useCallback((step: InitialLoadStep) => {
    setCompletedInitialLoadSteps((current) => {
      if (current.has(step)) return current;
      return new Set(current).add(step);
    });
  }, []);

  const initialLoadingProgress = Math.round(
    (completedInitialLoadSteps.size / initialLoadSteps.length) * 100
  );
  const isInitialLoading = completedInitialLoadSteps.size < initialLoadSteps.length;

  const mergeGamePlaytime = useCallback((game: GhostBoxGame): GhostBoxGame => {
    return applyPlaytimeToGame(game, gamePlaytimesRef.current);
  }, []);

  const refreshGamePlaytimes = useCallback(async () => {
    const snapshot = await ghostboxApi.getGamePlaytimes();
    gamePlaytimesRef.current = snapshot;
    setActiveSessionAppIds(collectActiveSessionAppIds(snapshot));
    setFavoriteGames((current) =>
      applyPlaytimeSnapshotToGames(current, snapshot)
    );
    setAddedLibraryGames((current) =>
      applyPlaytimeSnapshotToGames(current, snapshot)
    );
  }, []);

  useEffect(() => {
    return ghostboxApi.onGamePlaytimesChanged((snapshot) => {
      gamePlaytimesRef.current = snapshot;
      setActiveSessionAppIds(collectActiveSessionAppIds(snapshot));
      setFavoriteGames((current) =>
        applyPlaytimeSnapshotToGames(current, snapshot)
      );
      setAddedLibraryGames((current) =>
        applyPlaytimeSnapshotToGames(current, snapshot)
      );
    });
  }, []);

  useEffect(() => {
    backupSettingsRef.current = backupSettings;
  }, [backupSettings]);

  const queueBackupToast = useCallback(
    (record: BackupSettings["backupRecords"][string]) => {
      const shouldNotify =
        record.lastBackupSuccess !== false
          ? notifications.backupSuccessEnabled
          : notifications.backupErrorEnabled;
      if (!shouldNotify) return;

      const pendingToast = createBackupToastFromRecord(record);

      if (isAppFocused()) {
        showToast(pendingToast.title, pendingToast.message, pendingToast.variant);
      } else {
        pendingBackupToastRef.current = pendingToast;
      }

      const desktopEnabled = record.lastBackupSuccess !== false
        ? notifications.backupSuccessEnabled
        : notifications.backupErrorEnabled;

      showDesktopBackupNotification(
        pendingToast,
        notifications.desktopNotificationsEnabled && desktopEnabled
      );
    },
    [
      notifications.backupErrorEnabled,
      notifications.backupSuccessEnabled,
      notifications.desktopNotificationsEnabled,
      showToast,
    ]
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
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) markInitialLoadStepComplete("backupRoot");
      });

    const unsubscribe = ghostboxApi.onBackupSettingsChanged((settings) => {
      if (cancelled) return;

      const changedRecord = getLatestChangedBackupRecord(
        backupSettingsRef.current,
        settings
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
    writeStoredFavoriteGames(favoriteGames);
  }, [favoriteGames]);

  useEffect(() => {
    writeStoredUserCollections(userCollections);
  }, [userCollections]);

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
    void ghostboxApi.setTrayLibraryGames(addedLibraryGames);
  }, [addedLibraryGames]);

  useEffect(() => {
    const records = backupSettings?.backupRecords;
    if (!records) return;

    let cancelled = false;
    const backupGames = Object.entries(records).filter(([, record]) =>
      Boolean(record.entries?.length || record.lastBackupSuccess)
    );

    void (async () => {
      for (const [appId, record] of backupGames) {
        if (cancelled) return;

        const backupPath = record.entries?.[0]?.path ?? record.lastBackupPath;
        const backupDetails = await ghostboxApi
          .getBackupDetails(appId, backupPath)
          .catch(() => null);
        if (cancelled || !backupDetails?.achievements.length) continue;

        const backupUnlockedCount = backupDetails.achievements.length;
        const profileGame = profileHistoryGames.find(
          (game) => game.appId === appId
        );
        const profileUnlockedCount = countUnlockedAchievements(profileGame);
        const syncKey = `${getBackupRecordLatestKey(record)}|${backupUnlockedCount}|${profileUnlockedCount}`;
        if (
          profileBackupSyncKeysRef.current.get(appId) === syncKey &&
          backupUnlockedCount <= profileUnlockedCount
        ) {
          continue;
        }
        profileBackupSyncKeysRef.current.set(appId, syncKey);

        const details = await loadGameAchievementDetailsCached(
          `steam-${appId}`
        ).catch(() => null);
        if (cancelled) continue;

        const baseGame =
          details ??
          createProfileHistoryFallbackGame(
            appId,
            record.title || `Steam ${appId}`
          );
        const gameWithBackupAchievements = mergeBackupAchievementsIntoGame(
          baseGame,
          backupDetails
        );

        setProfileHistoryGames((current) => {
          const existingGame = current.find((game) => game.appId === appId);
          const isPlaceholderTitle = /^Steam \d+$/.test(
            gameWithBackupAchievements.title
          );

          return upsertProfileHistoryGame(current, {
            ...(existingGame ?? gameWithBackupAchievements),
            ...gameWithBackupAchievements,
            title:
              existingGame?.title ||
              (isPlaceholderTitle
                ? record.title
                : gameWithBackupAchievements.title),
            playTimeInMilliseconds:
              existingGame?.playTimeInMilliseconds ??
              gameWithBackupAchievements.playTimeInMilliseconds,
            lastTimePlayed:
              existingGame?.lastTimePlayed ??
              gameWithBackupAchievements.lastTimePlayed,
          });
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addedLibraryGameAppIds, backupSettings?.backupRecords, profileHistoryGames]);

  useEffect(() => {
    const achievementUnlockedTitle =
      appearance.language === "en" ? "Achievement unlocked" : "Conquista desbloqueada";

    return ghostboxApi.onLocalAchievementsUnlocked((payload) => {
      if (!notifications.achievementsEnabled) return;

      for (const achievementName of payload.achievements) {
        const message = `${payload.title}: ${achievementName}`;

        if (notifications.inAppToastsEnabled) {
          showToast(achievementUnlockedTitle, message);
        }

        showAchievementDesktopNotification(
          achievementUnlockedTitle,
          message,
          notifications.desktopNotificationsEnabled
        );
      }
    });
  }, [
    appearance.language,
    notifications.achievementsEnabled,
    notifications.desktopNotificationsEnabled,
    notifications.inAppToastsEnabled,
    showToast,
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
        if (cancelled || steamProfileRequestSequenceRef.current !== requestId) return;

        setSteamProfile((currentProfile) => {
          const merged = mergeSteamProfile(profile, currentProfile);
          if (merged) writeStoredSteamProfile(merged);
          return merged;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled && steamProfileRequestSequenceRef.current === requestId) {
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
    [favoriteGames]
  );

  const availableLibraryGameAppIds = useMemo(
    () => new Set(addedLibraryGames.map((game) => game.appId)),
    [addedLibraryGames]
  );

  const playableGameAppIds = useMemo(
    () => new Set(addedLibraryGames.map((game) => game.appId)),
    [addedLibraryGames]
  );

  const profileFavoriteGames = favoriteGames;
  const profileAddedLibraryGames = addedLibraryGames;
  const profileHistoryGamesWithPlaytime = useMemo(
    () => profileHistoryGames.map(mergeGamePlaytime),
    [mergeGamePlaytime, profileHistoryGames]
  );

  const applySteamLibraryScanResult = useCallback(
    (result: SteamLibraryScanResult) => {
      if (result.status !== "ok") return;

      const games = result.games.filter((game) => !isHiddenLibraryGame(game));
      setSteamPathInput(result.steamPath);
      setAddedLibraryGames(games);
      setAddedLibraryGameAppIds(new Set(games.map((game) => game.appId)));
    },
    []
  );

  const toggleFavoriteGame = useCallback(
    (game: GhostBoxGame) => {
      const isFavorite = favoriteGameIds.has(game.id);
      if (!isFavorite) preloadGamePortraitSources(game);

      setFavoriteGames((current) =>
        isFavorite
          ? current.filter((item) => item.id !== game.id)
          : [...current.filter((item) => item.id !== game.id), game]
      );
      showToast(
        isFavorite ? "Removido dos favoritos" : "Adicionado aos favoritos",
        isFavorite
          ? `${game.title} saiu dos favoritos.`
          : `${game.title} foi salvo nos favoritos.`
      );
    },
    [favoriteGameIds, showToast]
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
        const result = await addGameViaLuaTools(game);
        if (!result.success) {
          showToast("Falha ao adicionar", result.error);
          return;
        }
        if (isHiddenLibraryGame(result.libraryGame)) return;

        setAddedLibraryGames((current) =>
          upsertLibraryGameByAppId(current, result.libraryGame)
        );
        setAddedLibraryGameAppIds((current) =>
          new Set(current).add(result.libraryGame.appId)
        );
        showToast(
          "Jogo adicionado",
          `${result.libraryGame.title} foi adicionado à Biblioteca.`
        );
      } catch (error) {
        showToast(
          "Falha ao adicionar",
          error instanceof Error
            ? error.message
            : "Não foi possível concluir o fluxo LuaTools."
        );
      } finally {
        setAddingGameId(null);
      }
    },
    [addingGameId, availableLibraryGameAppIds, removingGameId, showToast]
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
          removeLibraryGameByAppId(current, result.appId)
        );
        setAddedLibraryGameAppIds((current) => {
          const next = new Set(current);
          next.delete(result.appId);
          return next;
        });

        const historyGame = mergeGamePlaytime(game);
        setProfileHistoryGames((current) =>
          upsertProfileHistoryGame(current, historyGame)
        );
        void loadGameAchievementDetailsCached(game.id)
          .then((details) => {
            if (!details) return;
            setProfileHistoryGames((current) =>
              upsertProfileHistoryGame(current, {
                ...historyGame,
                achievements: details.achievements,
                achievementList: details.achievementList,
              })
            );
          })
          .catch(() => undefined);

        showToast("Jogo removido", `${game.title} foi removido da Biblioteca.`);
      } catch (error) {
        showToast(
          "Falha ao remover",
          error instanceof Error
            ? error.message
            : "Não foi possível remover o jogo."
        );
      } finally {
        setRemovingGameId(null);
      }
    },
    [addingGameId, mergeGamePlaytime, removingGameId, showToast]
  );

  const handleGameDetailsLoaded = useCallback((details: GhostBoxGame) => {
    setProfileHistoryGames((current) => {
      const existingGame = current.find((game) => game.appId === details.appId);
      if (!existingGame) return current;

      return upsertProfileHistoryGame(
        current,
        mergeGameDetailsPreservingAchievements(existingGame, details)
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
            result.error ?? "Não foi possível iniciar o jogo."
          );
        }
        if (result?.success) {
          await refreshGamePlaytimes();
        }
      } finally {
        setLaunchingGameId((current) => (current === game.id ? null : current));
      }
    },
    [refreshGamePlaytimes, showToast]
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
            : collection
        )
      );
    },
    []
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
                  (item) => item.id !== game.id
                ),
              }
            : collection
        )
      );
    },
    []
  );

  const deleteCollection = useCallback((collectionId: string) => {
    setUserCollections((current) =>
      current.filter((collection) => collection.id !== collectionId)
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
    [setCollectionModalOpen, showToast, userCollections]
  );

  const openCreateUserCollectionModal = useCallback(() => {
    setCollectionModalOpen(true);
  }, [setCollectionModalOpen]);

  const handleSteamSignIn = useCallback(async () => {
    if (isSteamSigningIn || steamProfile) return;

    const requestId = ++steamProfileRequestSequenceRef.current;
    setIsSteamSigningIn(true);
    showToast(
      appearance.language === "en" ? "Waiting for Steam" : "Aguardando Steam",
      appearance.language === "en"
        ? "Complete the login in your browser."
        : "Conclua o login no navegador aberto."
    );

    try {
      const profile = await ghostboxApi.signInWithSteam();
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      setSteamProfile(profile);
      writeStoredSteamProfile(profile);
      showToast(
        appearance.language === "en" ? "Login complete" : "Login concluído",
        appearance.language === "en"
          ? `Signed in as ${profile.displayName}.`
          : `Conectado como ${profile.displayName}.`
      );
    } catch (error) {
      if (steamProfileRequestSequenceRef.current !== requestId) return;

      showToast(
        appearance.language === "en"
          ? "Steam login failed"
          : "Login com Steam falhou",
        formatSteamLoginError(error, appearance.language),
        "error"
      );
    } finally {
      if (steamProfileRequestSequenceRef.current === requestId) {
        setIsSteamSigningIn(false);
      }
    }
  }, [appearance.language, isSteamSigningIn, showToast, steamProfile]);

  const handleSteamSignOut = useCallback(async () => {
    ++steamProfileRequestSequenceRef.current;
    await ghostboxApi.signOutSteam();
    setSteamProfile(null);
    writeStoredSteamProfile(null);
  }, []);

  const handleRestartSteam = useCallback(async () => {
    const result = await ghostboxApi.restartSteam();
    if (result?.success) {
      showToast(
        "Steam reiniciada",
        "Steam foi reiniciada com sucesso."
      );
      return;
    }

    showToast(
      "Falha ao abrir Steam",
      result?.error ?? "Não foi possível localizar ou abrir a Steam."
    );
  }, [showToast]);

  const handleUpdateProfile = useCallback(
    async (
      displayName: string,
      avatarUrl: string,
      bannerUrl: string,
      bannerPosition: NonNullable<SteamProfile["bannerPosition"]>
    ) => {
      if (!steamProfile) return;

      const nextProfile: SteamProfile = {
        ...steamProfile,
        displayName,
        avatarUrl,
        bannerUrl,
        bannerPosition,
      };

      setSteamProfile(nextProfile);
      writeStoredSteamProfile(nextProfile);
      await ghostboxApi.saveSteamProfile(nextProfile);
    },
    [steamProfile]
  );

  const handleStartupSettingsChange = useCallback(
    async (settings: Partial<StartupSettings>) => {
      const next = await ghostboxApi.setStartupSettings(settings);
      if (next) setStartupSettings(next);
    },
    []
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
            : "A chave do Hubcap's Manifest foi salva."
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
          "error"
        );
      }
    },
    [appearance.language, showToast]
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
            `${scanResult.games.length} jogos instalados encontrados.`
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

    void refreshGamePlaytimes()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) markInitialLoadStepComplete("playtimes");
      });

    return () => {
      cancelled = true;
    };
  }, [markInitialLoadStepComplete, refreshGamePlaytimes]);

  const handleSelectBackupOutputPath = useCallback(async () => {
    const result = await ghostboxApi.selectBackupOutputPath();
    if (result?.settings) setBackupSettings(result.settings);
  }, []);

  const handleToggleLibraryAutomaticBackups = useCallback(
    async (enabled: boolean) => {
      const settings = await ghostboxApi.setLibraryAutomaticBackups(
        enabled,
        addedLibraryGames.map((game) => game.appId)
      );
      if (settings) setBackupSettings(settings);
    },
    [addedLibraryGames]
  );

  const handleToggleAutomaticBackup = useCallback(
    async (game: GhostBoxGame, enabled: boolean) => {
      const settings = await ghostboxApi.setGameAutomaticBackup(
        game.appId,
        enabled
      );
      if (settings) setBackupSettings(settings);
    },
    []
  );

  const handleSelectGameExecutable = useCallback(
    async (game: GhostBoxGame) => {
      const result = await ghostboxApi.selectGameExecutable(game);
      if (result?.settings) setBackupSettings(result.settings);
      if (result?.status === "ok" && result.libraryGame && !isHiddenLibraryGame(result.libraryGame)) {
        setProfileHistoryGames((current) =>
          removeProfileHistoryGameByAppId(current, result.libraryGame!.appId)
        );
      }
    },
    []
  );

  const handleRemoveGameExecutable = useCallback(async (game: GhostBoxGame) => {
    const settings = await ghostboxApi.setGameCustomExecutable(game.appId, null);
    if (settings) setBackupSettings(settings);
  }, []);

  const handleOpenBackupFolder = useCallback(
    async (appId: string, backupPath?: string) => {
      const result = await ghostboxApi.openBackupFolder(appId, backupPath);
      if (result.error) showToast("Falha ao abrir pasta", result.error);
    },
    [showToast]
  );

  const handleDeleteBackupFolder = useCallback(
    (appId: string, title: string, backupPath?: string) => {
      void backupPath;
      void appId;
      void title;
    },
    []
  );

  const handleCreateBackupRoot = useCallback(async () => {
    await handleSelectBackupOutputPath();
  }, [handleSelectBackupOutputPath]);

  const refreshBackupRootStatus = useCallback(async () => {
    const status = await ghostboxApi.validateBackupRoot();
    if (status) {
      setBackupRootStatus(status);
      setBackupSettings(status.settings);
    }
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      isInitialLoading,
      initialLoadingProgress,
      favoriteGames,
      addedLibraryGames,
      userCollections,
      steamProfile,
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
      backupRootStatus,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
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
      handleSelectBackupOutputPath,
      handleToggleLibraryAutomaticBackups,
      handleToggleAutomaticBackup,
      handleSelectGameExecutable,
      handleRemoveGameExecutable,
      handleOpenBackupFolder,
      handleDeleteBackupFolder,
      handleCreateBackupRoot,
      refreshBackupRootStatus,
    }),
    [
      favoriteGames,
      isInitialLoading,
      initialLoadingProgress,
      addedLibraryGames,
      userCollections,
      steamProfile,
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
      backupRootStatus,
      morrenusApiKey,
      startupSettings,
      initialPage,
      steamPathInput,
      showSteamGames,
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
      handleSelectBackupOutputPath,
      handleToggleLibraryAutomaticBackups,
      handleToggleAutomaticBackup,
      handleSelectGameExecutable,
      handleRemoveGameExecutable,
      handleOpenBackupFolder,
      handleDeleteBackupFolder,
      handleCreateBackupRoot,
      refreshBackupRootStatus,
    ]
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
