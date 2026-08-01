import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { Toast } from "./components/ui/Toast";
import { PageRouter } from "./components/routing/PageRouter";
import { useContentOverlayState } from "./components/routing/ContentOverlay";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShellState } from "./hooks/useAppShellState";
import { useAppData } from "./context/AppDataContext";
import { MetricsVisibilityProvider } from "./context/MetricsVisibilityContext";
import { useOverlay, type AchievementsViewState } from "./context/OverlayContext";
import { useSettings } from "./context/settings";
import { ghostboxApi } from "./lib/ghostboxApi";
import {
  getTrayHiddenNotificationCopy,
  showTrayHiddenDesktopNotification,
} from "./lib/trayNotifications";
import { clearCatalogueGamesCache } from "./utils/gameCache";
import { type SettingsTabId } from "./features/settings/settingsTabsShared";
import type { SubscriptionPortalFlow, SubscriptionStatusResult } from "./lib/ghostboxApi.types";
import { ingestRemoteGameByAppId, type GhostBoxGame } from "./data";
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
        <img className="app-splash__icon" src="/ghost-solid.png" alt="GhostBox" />
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
    back,
    forward,
    canGoBack,
    canGoForward,
    contentRef,
    saveScrollPosition,
  } = useAppNavigation();

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
  const { appearance, notifications } = useSettings();
  const queryClient = useQueryClient();
  const [steamPathModalLoading, setSteamPathModalLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionPeriodEnd, setSubscriptionPeriodEnd] = useState<string | null>(null);
  const [subscriptionPortalFlow, setSubscriptionPortalFlow] = useState<SubscriptionPortalFlow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const steamId = appData.steamProfile?.steamId;

    if (!steamId) {
      setIsPremium(false);
      setSubscriptionPeriodEnd(null);
      return;
    }

    const cachedPremium = ghostboxApi.getCachedIsPremium(steamId);
    if (cachedPremium !== null) setIsPremium(cachedPremium);
    const freshPremium = ghostboxApi.getFreshCachedPremiumStatus(steamId);
    if (freshPremium?.currentPeriodEnd) {
      setSubscriptionPeriodEnd(freshPremium.isPremium ? freshPremium.currentPeriodEnd : null);
    }

    const refreshSubscriptionStatus = () =>
      void ghostboxApi.getSubscriptionStatus(steamId).then((status: SubscriptionStatusResult | null) => {
        if (cancelled) return;
        const subscription = status?.subscription;
        const active = subscription?.isPremium === true || subscription?.status === "active";
        const end = subscription?.currentPeriodEnd ?? null;
        const endTime = end ? Date.parse(end) : NaN;

        setIsPremium(active && (!end || !Number.isFinite(endTime) || endTime > Date.now()));
        setSubscriptionPeriodEnd(active ? end : null);
      });

    const refreshSubscriptionStatusIfStale = () => {
      if (ghostboxApi.getFreshCachedPremiumStatus(steamId)) return;
      refreshSubscriptionStatus();
    };

    refreshSubscriptionStatusIfStale();
    window.addEventListener("focus", refreshSubscriptionStatusIfStale);
    const refreshInterval = window.setInterval(refreshSubscriptionStatus, PREMIUM_STATUS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshSubscriptionStatusIfStale);
      window.clearInterval(refreshInterval);
    };
  }, [appData.steamProfile?.steamId]);

  useEffect(() => {
    if (isPremium) setSubscriptionModalOpen(false);
  }, [isPremium, setSubscriptionModalOpen]);

  useEffect(() => {
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      clearCatalogueGamesCache();
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    });
  }, [queryClient]);

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
      saveScrollPosition();
      clearOverlayForward();
      closeContentOverlay();
      navigate(newPage);
      shell.clearQuery();
      if (collectionId) {
        shell.setActiveProfileCollectionId(collectionId);
      }
    },
    [clearOverlayForward, closeContentOverlay, navigate, saveScrollPosition, shell]
  );  useEffect(() => {
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

  const handleSidebarSettingsTabChange = useCallback(
    (tabId: SettingsTabId) => {
      shell.setActiveSettingsTabId(tabId);
    },
    [shell]
  );

  const handleOpenSubscriptionPortal = useCallback(async (flow: SubscriptionPortalFlow) => {
    const steamId = appData.steamProfile?.steamId?.trim();
    const copy = (pt: string, en: string) => appearance.language === "en" ? en : pt;
    if (!steamId || subscriptionPortalFlow) return;

    setSubscriptionPortalFlow(flow);
    try {
      const session = await ghostboxApi.createSubscriptionPortalSession(steamId, flow);
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
  }, [appData.steamProfile?.steamId, appearance.language, showToast, subscriptionPortalFlow]);

  const openGameAndIngestFallback = useCallback((game: GhostBoxGame) => {
    openGame(game);
    if (/^\d{1,10}$/.test(game.appId) && !game.databaseAddedAt) {
      void ingestRemoteGameByAppId(game.appId)
        .then(() => {
          clearCatalogueGamesCache();
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

  return (
    <div className="ghostbox-shell">
      <main className="app-main">
        <Sidebar
          activePage={page}
          activeCollectionId={shell.activeProfileCollectionId}
          steamProfile={appData.steamProfile}
          isCloudProfileRestoring={appData.isCloudProfileRestoring}
          isSteamSigningIn={appData.isSteamSigningIn}
          favoriteGames={appData.favoriteGames}
          addedLibraryGames={appData.addedLibraryGames}
          userCollections={appData.userCollections}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onOpenProfile={() => handleNavigate("profile")}
          onOpenGame={openGame}
          onSteamSignIn={() => void appData.handleSteamSignIn()}
          onRestartSteam={appData.handleRestartSteam}
          onCreateCollection={appData.openCreateUserCollectionModal}
          onRemoveFavorite={appData.toggleFavoriteGame}
          onRemoveGame={appData.removeQueuedGame}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
          onDeleteCollection={appData.deleteCollection}
          favoriteGameIds={appData.favoriteGameIds}
          libraryGameAppIds={appData.availableLibraryGameAppIds}
          removableGameAppIds={appData.addedLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          activeSessionAppIds={appData.activeSessionAppIds}
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onToggleFavorite={appData.toggleFavoriteGame}
          activeSettingsTabId={shell.activeSettingsTabId}
          onSettingsTabChange={handleSidebarSettingsTabChange}
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

  return (
    <MetricsVisibilityProvider steamProfile={appData.steamProfile}>
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
