import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { GhostBoxGame } from "../data";
import type { ToastVariant } from "../components/ui/Toast";
import { getToastVariant } from "../lib/toastUtils";
import { useSettings } from "./settings";
import { preloadGameModalAssets } from "../utils/image";

export type AchievementsViewState = {
  game: GhostBoxGame;
  reopenModalOnBack: boolean;
  highlightAchievementId?: string;
} | null;

type ToastState = {
  id: number;
  title: string;
  message: string;
  variant?: ToastVariant;
} | null;

interface OverlayContextValue {
  selectedGame: GhostBoxGame | null;
  achievementsView: AchievementsViewState;
  isGameModalExitPending: boolean;
  toast: ToastState;
  collectionModalOpen: boolean;
  steamPathModalOpen: boolean;
  pendingBackupDeletion: { appId: string; title: string; backupPath?: string } | null;
  openGame: (game: GhostBoxGame) => void;
  closeGame: () => void;
  closeContentOverlay: () => void;
  openAchievements: (
    game: GhostBoxGame,
    options?: { reopenModalOnBack?: boolean; highlightAchievementId?: string }
  ) => void;
  closeAchievements: () => void;
  showToast: (title: string, message: string, variant?: ToastVariant) => void;
  dismissToast: () => void;
  setCollectionModalOpen: (open: boolean) => void;
  setSteamPathModalOpen: (open: boolean) => void;
  setPendingBackupDeletion: (
    value: { appId: string; title: string; backupPath?: string } | null
  ) => void;
  setIsGameModalExitPending: (value: boolean) => void;
  modalReturnScrollTopRef: MutableRefObject<number>;
  restoreContentScrollAfterModalRef: MutableRefObject<boolean>;
}

const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const { notifications } = useSettings();
  const [selectedGame, setSelectedGame] = useState<GhostBoxGame | null>(null);
  const [achievementsView, setAchievementsView] =
    useState<AchievementsViewState>(null);
  const [isGameModalExitPending, setIsGameModalExitPending] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [steamPathModalOpen, setSteamPathModalOpen] = useState(false);
  const [pendingBackupDeletion, setPendingBackupDeletion] = useState<{
    appId: string;
    title: string;
    backupPath?: string;
  } | null>(null);
  const toastIdRef = useRef(0);
  const modalReturnScrollTopRef = useRef(0);
  const restoreContentScrollAfterModalRef = useRef(false);
  const gameModalExitTimeoutRef = useRef<number>();

  const showToast = useCallback(
    (title: string, message: string, variant?: ToastVariant) => {
      const nextVariant = getToastVariant(title, variant);
      if (!notifications.inAppToastsEnabled) return;
      if (nextVariant === "success" && !notifications.inAppSuccessToastsEnabled)
        return;
      if (nextVariant === "error" && !notifications.inAppErrorToastsEnabled)
        return;

      toastIdRef.current += 1;
      setToast({
        id: toastIdRef.current,
        title,
        message,
        variant: nextVariant,
      });
    },
    [
      notifications.inAppErrorToastsEnabled,
      notifications.inAppSuccessToastsEnabled,
      notifications.inAppToastsEnabled,
    ]
  );

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const openGame = useCallback((game: GhostBoxGame) => {
    if (gameModalExitTimeoutRef.current) {
      window.clearTimeout(gameModalExitTimeoutRef.current);
      gameModalExitTimeoutRef.current = undefined;
    }
    restoreContentScrollAfterModalRef.current = true;
    setIsGameModalExitPending(false);
    setAchievementsView(null);
    setSelectedGame(game);
    window.setTimeout(() => preloadGameModalAssets(game), 0);
  }, []);

  const closeGame = useCallback(() => {
    if (gameModalExitTimeoutRef.current) {
      window.clearTimeout(gameModalExitTimeoutRef.current);
    }
    setIsGameModalExitPending(true);
    setSelectedGame(null);
    gameModalExitTimeoutRef.current = window.setTimeout(() => {
      setIsGameModalExitPending(false);
      gameModalExitTimeoutRef.current = undefined;
    }, 220);
  }, []);

  const closeContentOverlay = useCallback(() => {
    if (gameModalExitTimeoutRef.current) {
      window.clearTimeout(gameModalExitTimeoutRef.current);
      gameModalExitTimeoutRef.current = undefined;
    }
    setSelectedGame(null);
    setAchievementsView(null);
    setIsGameModalExitPending(false);
  }, []);

  useEffect(() => {
    return () => {
      if (gameModalExitTimeoutRef.current) {
        window.clearTimeout(gameModalExitTimeoutRef.current);
      }
    };
  }, []);

  const openAchievements = useCallback(
    (
      game: GhostBoxGame,
      options?: { reopenModalOnBack?: boolean; highlightAchievementId?: string }
    ) => {
      setSelectedGame(null);
      setAchievementsView({
        game,
        reopenModalOnBack: options?.reopenModalOnBack ?? false,
        highlightAchievementId: options?.highlightAchievementId,
      });
    },
    []
  );

  const closeAchievements = useCallback(() => {
    if (achievementsView?.reopenModalOnBack) {
      openGame(achievementsView.game);
    }
    setAchievementsView(null);
  }, [achievementsView, openGame]);

  const value = useMemo<OverlayContextValue>(
    () => ({
      selectedGame,
      achievementsView,
      isGameModalExitPending,
      toast,
      collectionModalOpen,
      steamPathModalOpen,
      pendingBackupDeletion,
      openGame,
      closeGame,
      closeContentOverlay,
      openAchievements,
      closeAchievements,
      showToast,
      dismissToast,
      setCollectionModalOpen,
      setSteamPathModalOpen,
      setPendingBackupDeletion,
      setIsGameModalExitPending,
      modalReturnScrollTopRef,
      restoreContentScrollAfterModalRef,
    }),
    [
      selectedGame,
      achievementsView,
      isGameModalExitPending,
      toast,
      collectionModalOpen,
      steamPathModalOpen,
      pendingBackupDeletion,
      openGame,
      closeGame,
      closeContentOverlay,
      openAchievements,
      closeAchievements,
      showToast,
      dismissToast,
    ]
  );

  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

export function useOverlay() {
  const context = useContext(OverlayContext);
  if (!context) {
    throw new Error("useOverlay must be used within OverlayProvider");
  }
  return context;
}
