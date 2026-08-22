import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { Toast } from "./components/ui/Toast";
import { PageRouter } from "./components/routing/PageRouter";
import { useContentOverlayState } from "./components/routing/ContentOverlay";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShellState } from "./hooks/useAppShellState";
import { useViewportResizeTracking } from "./hooks/useViewportResize";
import { useAuthSessionToast } from "./hooks/useAuthSessionToast";
import { useAppData } from "./context/AppDataContext";
import { useAuth } from "./context/AuthContext";
import { MetricsVisibilityProvider } from "./context/MetricsVisibilityContext";
import { useOverlay, type AchievementsViewState } from "./context/OverlayContext";
import { useSettings } from "./context/settings";
import { ghostboxApi } from "./lib/ghostboxApi";
import { startDownloadManager } from "./lib/downloadManager";
import {
  getTrayHiddenNotificationCopy,
  showTrayHiddenDesktopNotification,
} from "./lib/trayNotifications";
import { type SettingsTabId } from "./features/settings/settingsTabsShared";
import type { SubscriptionPortalFlow, SubscriptionStatusResult } from "./lib/ghostboxApi.types";
import { ingestRemoteGameByAppId, type GhostBoxGame } from "./data";
import ghostIconSource from "../Icons/ghost-solid.png";
import "./app.scss";

const PREMIUM_STATUS_REFRESH_MS = 5 * 60 * 1000;

type OverlayForwardEntry =
  | { kind: "game"; game: GhostBoxGame }
  | { kind: "achievements"; view: NonNullable<AchievementsViewState> };

function AppSplash({ progress }: { progress: number }) {
  const spinnerStyle = {
    ["--app-splash-progress"]: `${progress}%`,
  } as CSSProperties;

  return (
    <main
      className="app-splash app-splash--react"
      aria-label="Carregando interface"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      role="progressbar"
    >
      <div className="app-splash__content">
        <img className="app-splash__icon" src={ghostIconSource} alt="GhostBox" />
        <div
          className="app-splash__spinner"
          style={spinnerStyle}
          aria-hidden="true"
        />
      </div>
    </main>
  );
}

function AppContent({ appData }: { appData: ReturnType<typeof useAppData> }) {
  const { status, openAuthModal } = useAuth();
  const {
    openGame,
    openAchievements,
    toast,
    dismissToast,
    selectedGame,
    achievementsView,
    isGameModalExitPending,
    closeGame,
    closeContentOverlay,
    closeAchievements,
    modalReturnScrollTopRef,
    restoreContentScrollAfterModalRef,
    setSubscriptionModalOpen,
    showToast,
  } = useOverlay();
  const { isGameModalVisible, isAchievementsViewVisible } =
    useContentOverlayState();

  const {
    page,
    navigate,
    purgePage,
    back,
    forward,
    canGoBack,
    canGoForward,
    contentRef,
    saveScrollPosition,
  } = useAppNavigation();

  useAuthSessionToast();

  // The profile belongs to the signed-in account: signing out from inside it
  // falls back to home, and its history entries go too so Back cannot return
  // to someone else's profile. Layout effect, not effect: the fallback has to
  // land before the browser paints, or signing out flashes an empty page.
  useLayoutEffect(() => {
    if (status === "authenticated") return;
    purgePage("profile");
  }, [purgePage, status]);

  const overlayForwardRef = useRef<OverlayForwardEntry | null>(null);
  const [canForwardOverlay, setCanForwardOverlay] = useState(false);

  const clearOverlayForward = useCallback(() => {
    overlayForwardRef.current = null;
    setCanForwardOverlay(false);
  }, []);

  const setOverlayForward = useCallback((entry: OverlayForwardEntry | null) => {
    overlayForwardRef.current = entry;
    setCanForwardOverlay(Boolean(entry));
  }, []);

  const shell = useAppShellState(page);
  // Marca `html.is-resizing` durante o arrasto da janela: transições ficam
  // suspensas e quem mede layout espera o resize assentar.
  useViewportResizeTracking();
  const { appearance, notifications } = useSettings();
  const queryClient = useQueryClient();
  const [steamPathModalLoading, setSteamPathModalLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionPeriodEnd, setSubscriptionPeriodEnd] = useState<string | null>(null);
  const [subscriptionPortalFlow, setSubscriptionPortalFlow] = useState<SubscriptionPortalFlow | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cachedPremium = ghostboxApi.getCachedIsPremium();
    if (cachedPremium !== null) setIsPremium(cachedPremium);
    const freshPremium = ghostboxApi.getFreshCachedPremiumStatus();
    if (freshPremium?.currentPeriodEnd) {
      setSubscriptionPeriodEnd(freshPremium.isPremium ? freshPremium.currentPeriodEnd : null);
    }

    const refreshSubscriptionStatus = () =>
      void ghostboxApi.getSubscriptionStatus().then((status: SubscriptionStatusResult | null) => {
        if (cancelled) return;
        // null means the status could not be read (offline, expired session),
        // not that the subscription ended. Keep whatever we last knew instead
        // of revoking the crown under a paying user.
        if (!status) return;

        const subscription = status.subscription;
        const active = subscription?.isPremium === true || subscription?.status === "active";
        const end = subscription?.currentPeriodEnd ?? null;
        const endTime = end ? Date.parse(end) : NaN;

        setIsPremium(active && (!end || !Number.isFinite(endTime) || endTime > Date.now()));
        setSubscriptionPeriodEnd(active ? end : null);
      });

    /**
     * Confirms a checkout the user was sent to Stripe for.
     *
     * The webhook normally grants Premium within seconds, but if it is delayed
     * or dropped the app would otherwise keep showing the plan picker to
     * someone who already paid. Returns true when the checkout reached a final
     * state, meaning the status is worth re-reading right away.
     */
    const reconcilePendingCheckout = async () => {
      const pending = ghostboxApi.getPendingCheckoutId();
      if (!pending) return false;

      const result = await ghostboxApi.refreshSubscriptionCheckout(pending);
      // null means the check itself failed — keep the id and retry on the next
      // focus rather than dropping a real payment.
      if (!result?.payment || result.payment.status === "pending") return false;

      ghostboxApi.setPendingCheckoutId(null);
      return true;
    };

    const refreshSubscriptionStatusIfStale = () => {
      void (async () => {
        const reconciled = await reconcilePendingCheckout();
        if (cancelled) return;
        // A just-confirmed checkout must bypass the cache TTL; otherwise the
        // user waits up to five minutes to see what they paid for.
        if (reconciled || !ghostboxApi.getFreshCachedPremiumStatus()) refreshSubscriptionStatus();
      })();
    };

    refreshSubscriptionStatusIfStale();
    window.addEventListener("focus", refreshSubscriptionStatusIfStale);
    const refreshInterval = window.setInterval(refreshSubscriptionStatus, PREMIUM_STATUS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshSubscriptionStatusIfStale);
      window.clearInterval(refreshInterval);
    };
  }, []);

  // A coroa pertence a uma conta autenticada: o logout precisa derruba-la na
  // hora. O poll de status devolve null quando deslogado e mantem de proposito
  // o ultimo valor conhecido — sem este reset o botao "Assinatura" sobrevivia
  // ao logout ate o app reiniciar. Cobre tambem a sessao expirada detectada
  // pelo refreshAccount, que reverte para anonymous.
  useEffect(() => {
    if (status !== "anonymous") return;
    setIsPremium(false);
    setSubscriptionPeriodEnd(null);
  }, [status]);

  useEffect(() => {
    if (isPremium) setSubscriptionModalOpen(false);
  }, [isPremium, setSubscriptionModalOpen]);

  useEffect(() => {
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    });
  }, [queryClient]);

  useEffect(() => {
    return startDownloadManager();
  }, []);

  useEffect(() => {
    return ghostboxApi.onWindowHiddenToTray(() => {
      const copy = getTrayHiddenNotificationCopy(appearance.language);
      showTrayHiddenDesktopNotification(
        copy,
        notifications.desktopNotificationsEnabled
      );
    });
  }, [appearance.language, notifications.desktopNotificationsEnabled]);


  const handleNavigate = useCallback(
    (newPage: typeof page, collectionId?: string) => {
      // Single gate for every entry point into the profile — sidebar, tray,
      // forward history.
      if (newPage === "profile" && status !== "authenticated") {
        openAuthModal();
        return;
      }
      saveScrollPosition();
      clearOverlayForward();
      closeContentOverlay();
      navigate(newPage);
      shell.clearQuery();
      if (collectionId) {
        shell.setActiveProfileCollectionId(collectionId);
      }
    },
    [
      clearOverlayForward,
      closeContentOverlay,
      navigate,
      openAuthModal,
      saveScrollPosition,
      shell,
      status,
    ]
  );

  useEffect(() => {
    return ghostboxApi.onTrayNavigate(({ page }) => {
      handleNavigate(page);
    });
  }, [handleNavigate]);

  const handleBack = useCallback(() => {
    saveScrollPosition();
    shell.clearQuery();

    if (achievementsView) {
      if (achievementsView.reopenModalOnBack) {
        clearOverlayForward();
        closeAchievements();
        return;
      }
      setOverlayForward({ kind: "achievements", view: achievementsView });
      closeAchievements();
      return;
    }

    if (selectedGame) {
      setOverlayForward({ kind: "game", game: selectedGame });
      closeGame();
      return;
    }

    clearOverlayForward();
    back();
  }, [
    achievementsView,
    back,
    clearOverlayForward,
    closeAchievements,
    closeGame,
    saveScrollPosition,
    selectedGame,
    setOverlayForward,
    shell,
  ]);

  const handleForward = useCallback(() => {
    saveScrollPosition();
    shell.clearQuery();

    if (achievementsView || selectedGame) return;

    const overlayEntry = overlayForwardRef.current;
    if (overlayEntry) {
      clearOverlayForward();
      if (overlayEntry.kind === "game") {
        openGame(overlayEntry.game);
        return;
      }
      openAchievements(overlayEntry.view.game, {
        reopenModalOnBack: overlayEntry.view.reopenModalOnBack,
        highlightAchievementId: overlayEntry.view.highlightAchievementId,
      });
      return;
    }

    forward();
  }, [
    achievementsView,
    clearOverlayForward,
    forward,
    openAchievements,
    openGame,
    saveScrollPosition,
    selectedGame,
    shell,
  ]);

  const handleSettingsTabChange = useCallback(
    (tabId: SettingsTabId) => {
      shell.setActiveSettingsTabId(tabId);
    },
    [shell]
  );

  const handleOpenSubscriptionPortal = useCallback(async (flow: SubscriptionPortalFlow) => {
    const copy = (pt: string, en: string) => appearance.language === "en" ? en : pt;
    if (subscriptionPortalFlow) return;

    setSubscriptionPortalFlow(flow);
    try {
      const session = await ghostboxApi.createSubscriptionPortalSession(flow);
      if (!session?.url) {
        throw new Error(copy("Não foi possível abrir o portal de cobrança.", "Could not open the billing portal."));
      }
      await ghostboxApi.openExternalUrl(session.url);
    } catch (error) {
      showToast(
        copy("Portal de assinatura", "Subscription portal"),
        error instanceof Error && error.message
          ? error.message
          : copy("Não foi possível abrir o portal de cobrança.", "Could not open the billing portal."),
        "error"
      );
    } finally {
      setSubscriptionPortalFlow(null);
    }
  }, [appearance.language, showToast, subscriptionPortalFlow]);

  const openGameAndIngestFallback = useCallback((game: GhostBoxGame) => {
    openGame(game);
    if (/^\d{1,10}$/.test(game.appId) && !game.databaseAddedAt) {
      void ingestRemoteGameByAppId(game.appId)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["games"] });
          void queryClient.invalidateQueries({ queryKey: ["home"] });
        })
        .catch(() => undefined);
    }
  }, [openGame, queryClient]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    if (selectedGame || achievementsView) {
      if (!isGameModalExitPending) {
        modalReturnScrollTopRef.current = content.scrollTop;
        content.scrollTop = 0;
      }
      return;
    }

    if (restoreContentScrollAfterModalRef.current) {
      content.scrollTop = modalReturnScrollTopRef.current;
      restoreContentScrollAfterModalRef.current = false;
    }
  }, [
    achievementsView,
    contentRef,
    isGameModalExitPending,
    modalReturnScrollTopRef,
    restoreContentScrollAfterModalRef,
    selectedGame,
  ]);

  const activeCollectionId =
    page === "library"
      ? (shell.activeLibraryCollectionId ?? undefined)
      : shell.activeProfileCollectionId;

  return (
    <div className="ghostbox-shell">
      <main className="app-main">
        <Sidebar
          activePage={page}
          activeCollectionId={activeCollectionId}
          steamProfile={appData.steamProfile}
          isCloudProfileRestoring={appData.isCloudProfileRestoring}
          favoriteGames={appData.favoriteGames}
          addedLibraryGames={appData.addedLibraryGames}
          userCollections={appData.userCollections}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onOpenProfile={() => handleNavigate("profile")}
          onOpenGame={openGame}
          onCreateCollection={appData.openCreateUserCollectionModal}
          onRemoveFavorite={appData.toggleFavoriteGame}
          onDeleteCollection={appData.deleteCollection}
          activeSessionAppIds={appData.activeSessionAppIds}
          activeSettingsTabId={shell.activeSettingsTabId}
          onSettingsTabChange={handleSettingsTabChange}
        />

        <article
          className={`container ${isGameModalVisible || isAchievementsViewVisible ? "container--modal-open" : ""}`}
        >
          <Header
            page={page}
            canGoBack={
              isGameModalVisible ||
              isAchievementsViewVisible ||
              canGoBack
            }
            canGoForward={
              !isGameModalVisible &&
              !isAchievementsViewVisible &&
              (canGoForward || canForwardOverlay)
            }
            query={shell.query}
            isSearching={shell.isSearchLoading}
            suggestions={shell.headerSearchSuggestions}
            hasNoSearchResults={shell.hasNoHeaderSearchResults}
            showAppIdPrompt={shell.shouldShowHeaderAppIdPrompt}
            steamProfile={appData.steamProfile}
            isPremium={isPremium}
            subscriptionPeriodEnd={subscriptionPeriodEnd}
            onQueryChange={shell.handleQueryChange}
            onSelectSuggestion={(game) => {
              clearOverlayForward();
              openGameAndIngestFallback(game);
            }}
            onBack={handleBack}
            onForward={handleForward}
            onNavigateToNotifications={() => handleNavigate("notifications")}
            onClickPremium={() => {
              setSubscriptionModalOpen(true);
            }}
            onOpenSubscriptionPortal={handleOpenSubscriptionPortal}
          />

          <section
            ref={contentRef}
            className={`container__content ${page === "settings" ? "container__content--settings" : ""} ${isGameModalVisible || isAchievementsViewVisible ? "container__content--modal-open" : ""}`}
          >
            <PageRouter
              page={page}
              debouncedQuery={shell.debouncedQuery}
              activeSettingsTabId={shell.activeSettingsTabId}
              activeProfileCollectionId={shell.activeProfileCollectionId}
              setActiveProfileCollectionId={shell.setActiveProfileCollectionId}
              activeLibraryCollectionId={shell.activeLibraryCollectionId}
              setActiveLibraryCollectionId={shell.setActiveLibraryCollectionId}
              isMainPage={shell.isMainPage}
              contentRef={contentRef}
              steamPathModalLoading={steamPathModalLoading}
              setSteamPathModalLoading={setSteamPathModalLoading}
              onNavigateToCatalogue={() => handleNavigate("catalogue")}
              steamProfile={appData.steamProfile}
            />
          </section>
        </article>
      </main>

      <Toast toast={toast} onClose={dismissToast} />
    </div>
  );
}

function AppShell() {
  const appData = useAppData();
  const { status } = useAuth();
  const isAuthenticated = status === "authenticated";

  return (
    <MetricsVisibilityProvider isAuthenticated={isAuthenticated}>
      <AppContent appData={appData} />
      {appData.isInitialLoading ? (
        <AppSplash progress={appData.initialLoadingProgress} />
      ) : null}
    </MetricsVisibilityProvider>
  );
}

function App() {
  return <AppShell />;
}

export default App;
