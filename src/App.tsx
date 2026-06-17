import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TitleBar } from "./components/layout/TitleBar";
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

function AppShell() {
  const appData = useAppData();
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
  } = useOverlay();
  const { isGameModalVisible, isAchievementsViewVisible } =
    useContentOverlayState();

  const {
    page,
    navigate,
    back,
    contentRef,
    saveScrollPosition,
    restorePendingScroll,
  } = useAppNavigation();

  const shell = useAppShellState(page);
  const { appearance, notifications } = useSettings();
  const queryClient = useQueryClient();
  const [steamPathModalLoading, setSteamPathModalLoading] = useState(false);

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

  const headerTitle = useMemo(() => {
    if (selectedGame) return selectedGame.title;
    if (achievementsView) return achievementsView.game.title;
    if (page !== "favorites") return undefined;
    if (shell.activeProfileCollectionId === "favorites") return undefined;
    return appData.userCollections.find(
      (collection) => collection.id === shell.activeProfileCollectionId
    )?.name;
  }, [
    achievementsView,
    appData.userCollections,
    page,
    selectedGame,
    shell.activeProfileCollectionId,
  ]);

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
      <TitleBar />

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
          onSteamSignOut={() => void appData.handleSteamSignOut()}
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
        />

        <article
          className={`container ${isGameModalVisible || isAchievementsViewVisible ? "container--modal-open" : ""}`}
        >
          <Header
            page={page}
            title={headerTitle}
            canGoBack={
              Boolean(selectedGame) ||
              isAchievementsViewVisible ||
              page !== "home"
            }
            query={shell.query}
            isSearching={shell.isSearchLoading}
            suggestions={shell.headerSearchSuggestions}
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

function App() {
  return <AppShell />;
}

export default App;
