import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { Toast } from "./components/ui/Toast";
import { PageRouter } from "./components/routing/PageRouter";
import { useContentOverlayState } from "./components/routing/ContentOverlay";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useAppShellState } from "./hooks/useAppShellState";
import { useAppData } from "./context/AppDataContext";
import { useOverlay } from "./context/OverlayContext";
import { useSettings } from "./context/settings";
import { ghostboxApi } from "./lib/ghostboxApi";
import {
  getTrayHiddenNotificationCopy,
  showTrayHiddenDesktopNotification,
} from "./lib/trayNotifications";
import { clearCatalogueGamesCache } from "./utils/gameCache";
import type { SettingsTabId } from "./features/settings/settingsTabsShared";
import "./app.scss";

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
    toast,
    dismissToast,
    selectedGame,
    achievementsView,
    isGameModalExitPending,
    closeGame,
    closeContentOverlay,
    closeAchievements,
    modalReturnScrollTopRef,
    setSubscriptionModalOpen,
  } = useOverlay();
  const { isGameModalVisible, isAchievementsViewVisible } =
    useContentOverlayState();

  const {
    page,
    navigate,
    back,
    canGoBack,
    contentRef,
    saveScrollPosition,
    restorePendingScroll,
  } = useAppNavigation();

  const shell = useAppShellState(page);
  const { appearance, notifications } = useSettings();
  const queryClient = useQueryClient();
  const [steamPathModalLoading, setSteamPathModalLoading] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const steamId = appData.steamProfile?.steamId;

    if (!steamId) {
      setIsPremium(false);
      return;
    }

    // Instant hydrate from premium cache (lifetime / previous session).
    const cachedPremium = ghostboxApi.getCachedIsPremium(steamId);
    if (cachedPremium !== null) setIsPremium(cachedPremium);

    const refreshSubscriptionStatus = () =>
      void ghostboxApi.isPremiumUser(steamId).then((premium) => {
        if (!cancelled) setIsPremium(premium);
      });

    // Prefetch Discord link early so sidebar/profile paint without waiting on mount.
    void ghostboxApi.getDiscordLinkStatus(steamId);

    refreshSubscriptionStatus();
    window.addEventListener("focus", refreshSubscriptionStatus);
    const refreshInterval = window.setInterval(refreshSubscriptionStatus, 60_000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshSubscriptionStatus);
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
      closeContentOverlay();
      if (newPage !== page) {
        navigate(newPage);
      }
      shell.clearQuery();
      if (collectionId) {
        shell.setActiveProfileCollectionId(collectionId);
      }
    },
    [closeContentOverlay, navigate, page, saveScrollPosition, shell]
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
      closeAchievements();
      return;
    }
    if (selectedGame) {
      closeGame();
      return;
    }
    back();
  }, [
    achievementsView,
    back,
    closeAchievements,
    closeGame,
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

  useLayoutEffect(() => {
    restorePendingScroll();
  }, [page, restorePendingScroll]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    if (selectedGame || achievementsView) {
      if (!selectedGame && !achievementsView) return;
      if (!isGameModalExitPending) {
        modalReturnScrollTopRef.current = content.scrollTop;
      }
      content.scrollTop = 0;
    }
  }, [
    achievementsView,
    contentRef,
    isGameModalExitPending,
    modalReturnScrollTopRef,
    selectedGame,
  ]);

  return (
    <div className="ghostbox-shell">
      <main className="app-main">
        <Sidebar
          activePage={page}
          activeCollectionId={shell.activeProfileCollectionId}
          steamProfile={appData.steamProfile}
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
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onToggleFavorite={appData.toggleFavoriteGame}
          activeSettingsTabId={shell.activeSettingsTabId}
          onSettingsTabChange={handleSidebarSettingsTabChange}
          isPremium={isPremium}
        />

        <article
          className={`container ${isGameModalVisible || isAchievementsViewVisible ? "container--modal-open" : ""}`}
        >
          <Header
            page={page}
            canGoBack={
              Boolean(selectedGame) ||
              isAchievementsViewVisible ||
              canGoBack
            }
            navigationTitle={
              achievementsView?.game.title ??
              selectedGame?.title ??
              null
            }
            query={shell.query}
            isSearching={shell.isSearchLoading}
            suggestions={shell.headerSearchSuggestions}
            steamProfile={appData.steamProfile}
            onQueryChange={shell.handleQueryChange}
            onSelectSuggestion={openGame}
            onBack={handleBack}
            onNavigateToNotifications={() => handleNavigate("notifications")}
          />

          <section
            ref={contentRef}
            className={`container__content ${page === "settings" ? "container__content--settings" : ""} ${page === "catalogue" ? "container__content--catalogue" : ""} ${isGameModalVisible || isAchievementsViewVisible ? "container__content--modal-open" : ""}`}
          >
            <PageRouter
              page={page}
              debouncedQuery={shell.debouncedQuery}
              activeSettingsTabId={shell.activeSettingsTabId}
              activeProfileCollectionId={shell.activeProfileCollectionId}
              setActiveProfileCollectionId={shell.setActiveProfileCollectionId}
              pageEnterKey={shell.pageEnterKey}
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

  if (appData.isInitialLoading) {
    return <AppSplash progress={appData.initialLoadingProgress} />;
  }

  return <AppContent appData={appData} />;
}

function App() {
  return <AppShell />;
}

export default App;
