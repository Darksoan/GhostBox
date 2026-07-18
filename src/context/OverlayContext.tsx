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
  subscriptionModalOpen: boolean;
  openGame: (game: GhostBoxGame) => void;
  closeGame: () => void;
  closeContentOverlay: () => void;
  openAchievements: (
    game: GhostBoxGame,
    options?: { reopenModalOnBack?: boolean; highlightAchievementId?: string },
  ) => void;
  closeAchievements: () => void;
  showToast: (title: string, message: string, variant?: ToastVariant) => void;
  dismissToast: () => void;
  setCollectionModalOpen: (open: boolean) => void;
  setSteamPathModalOpen: (open: boolean) => void;
  setSubscriptionModalOpen: (open: boolean) => void;
  setIsGameModalExitPending: (value: boolean) => void;
  modalReturnScrollTopRef: MutableRefObject<number>;
  restoreContentScrollAfterModalRef: MutableRefObject<boolean>;
}

const OverlayContext = createContext<OverlayContextValue | undefined>(
  undefined,
);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const { notifications, appearance } = useSettings();
  const [selectedGame, setSelectedGame] = useState<GhostBoxGame | null>(null);
  const [achievementsView, setAchievementsView] =
    useState<AchievementsViewState>(null);
  const [isGameModalExitPending, setIsGameModalExitPending] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [steamPathModalOpen, setSteamPathModalOpen] = useState(false);
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  const toastIdRef = useRef(0);
  const modalReturnScrollTopRef = useRef(0);
  const restoreContentScrollAfterModalRef = useRef(false);
  const gameModalExitTimeoutRef = useRef<number>();
  const selectedGameRef = useRef<GhostBoxGame | null>(null);
  const achievementsViewRef = useRef<AchievementsViewState>(null);
  selectedGameRef.current = selectedGame;
  achievementsViewRef.current = achievementsView;

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
    ],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const clearOverlayExitTimeout = useCallback(() => {
    if (gameModalExitTimeoutRef.current) {
      window.clearTimeout(gameModalExitTimeoutRef.current);
      gameModalExitTimeoutRef.current = undefined;
    }
  }, []);

  const getOverlayExitMs = useCallback(() => {
    if (appearance.disableTabAnimations || appearance.reduceAllAnimations) {
      return 0;
    }
    return 100;
  }, [appearance.disableTabAnimations, appearance.reduceAllAnimations]);

  const openGame = useCallback((game: GhostBoxGame) => {
    clearOverlayExitTimeout();
    restoreContentScrollAfterModalRef.current = true;
    setIsGameModalExitPending(false);
    setAchievementsView(null);
    setSelectedGame(game);
  }, [clearOverlayExitTimeout]);

  const closeGame = useCallback(() => {
    if (gameModalExitTimeoutRef.current !== undefined) return;
    if (!selectedGameRef.current) return;
    setIsGameModalExitPending(true);
    gameModalExitTimeoutRef.current = window.setTimeout(() => {
      setSelectedGame(null);
      setIsGameModalExitPending(false);
      gameModalExitTimeoutRef.current = undefined;
    }, getOverlayExitMs());
  }, [getOverlayExitMs]);

  const closeContentOverlay = useCallback(() => {
    clearOverlayExitTimeout();
    setSelectedGame(null);
    setAchievementsView(null);
    setIsGameModalExitPending(false);
  }, [clearOverlayExitTimeout]);

  useEffect(() => {
    return () => {
      clearOverlayExitTimeout();
    };
  }, [clearOverlayExitTimeout]);

  const openAchievements = useCallback(
    (
      game: GhostBoxGame,
      options?: {
        reopenModalOnBack?: boolean;
        highlightAchievementId?: string;
      },
    ) => {
      clearOverlayExitTimeout();
      setIsGameModalExitPending(false);
      setSelectedGame(null);
      setAchievementsView({
        game,
        reopenModalOnBack: options?.reopenModalOnBack ?? false,
        highlightAchievementId: options?.highlightAchievementId,
      });
    },
    [clearOverlayExitTimeout],
  );

  const closeAchievements = useCallback(() => {
    if (gameModalExitTimeoutRef.current !== undefined) return;
    const current = achievementsViewRef.current;
    if (!current) return;

    if (current.reopenModalOnBack) {
      clearOverlayExitTimeout();
      setIsGameModalExitPending(false);
      openGame(current.game);
      setAchievementsView(null);
      return;
    }

    setIsGameModalExitPending(true);
    gameModalExitTimeoutRef.current = window.setTimeout(() => {
      setAchievementsView(null);
      setIsGameModalExitPending(false);
      gameModalExitTimeoutRef.current = undefined;
    }, getOverlayExitMs());
  }, [clearOverlayExitTimeout, getOverlayExitMs, openGame]);
  const value = useMemo<OverlayContextValue>(
    () => ({
      selectedGame,
      achievementsView,
      isGameModalExitPending,
      toast,
      collectionModalOpen,
      steamPathModalOpen,
      subscriptionModalOpen,
      openGame,
      closeGame,
      closeContentOverlay,
      openAchievements,
      closeAchievements,
      showToast,
      dismissToast,
      setCollectionModalOpen,
      setSteamPathModalOpen,
      setSubscriptionModalOpen,
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
      subscriptionModalOpen,
      openGame,
      closeGame,
      closeContentOverlay,
      openAchievements,
      closeAchievements,
      showToast,
      dismissToast,
    ],
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
