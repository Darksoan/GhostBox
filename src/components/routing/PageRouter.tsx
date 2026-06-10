import { lazy, Suspense } from "react";
import type { RefObject } from "react";
import { HomePage } from "../../pages/HomePage";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useCatalogueState } from "../../hooks/useCatalogueState";
import { pirateboxApi } from "../../lib/pirateboxApi";
import type { Page } from "../../types";
import { ContentOverlay, useContentOverlayState } from "./ContentOverlay";
import { ConfirmModal } from "../modals/ConfirmModal";
import { CollectionModal } from "../modals/CollectionModal";
import { SteamPathModal } from "../modals/SteamPathModal";

const LazyCataloguePage = lazy(() =>
  import("../../pages/CataloguePage").then((m) => ({ default: m.CataloguePage }))
);
const LazyLibraryPage = lazy(() =>
  import("../../pages/LibraryPage").then((m) => ({ default: m.LibraryPage }))
);
const LazyFavoritesPage = lazy(() =>
  import("../../pages/FavoritesPage").then((m) => ({ default: m.FavoritesPage }))
);
const LazySettingsPage = lazy(() =>
  import("../../pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const LazyBackupPage = lazy(() =>
  import("../../pages/BackupPage").then((m) => ({ default: m.BackupPage }))
);
const LazyProfilePage = lazy(() =>
  import("../../pages/ProfilePage").then((m) => ({ default: m.ProfilePage }))
);
const LazyNotificationsPage = lazy(() =>
  import("../../pages/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  }))
);

function DeferredPagePlaceholder({ page }: { page: Page }) {
  return (
    <section
      className={`deferred-page-placeholder deferred-page-placeholder--${page}`}
      aria-hidden="true"
    >
      <span className="deferred-page-placeholder__spinner" />
    </section>
  );
}

interface PageRouterProps {
  page: Page;
  debouncedQuery: string;
  activeSettingsTabId: string;
  activeProfileCollectionId?: string;
  setActiveProfileCollectionId: (id: string | undefined) => void;
  pageEnterKey: string;
  isMainPage: boolean;
  contentRef: RefObject<HTMLElement>;
  steamPathModalLoading: boolean;
  setSteamPathModalLoading: (loading: boolean) => void;
}

export function PageRouter({
  page,
  debouncedQuery,
  activeSettingsTabId,
  activeProfileCollectionId,
  setActiveProfileCollectionId,
  pageEnterKey,
  isMainPage,
  contentRef,
  steamPathModalLoading,
  setSteamPathModalLoading,
}: PageRouterProps) {
  const { appearance } = useSettings();
  const appData = useAppData();
  const {
    openGame,
    openAchievements,
    collectionModalOpen,
    steamPathModalOpen,
    pendingBackupDeletion,
    setCollectionModalOpen,
    setSteamPathModalOpen,
    setPendingBackupDeletion,
    showToast,
  } = useOverlay();
  const { hasOverlay } = useContentOverlayState();

  const catalogue = useCatalogueState(debouncedQuery, page === "catalogue");

  function renderPage() {
    if (page === "home") {
      return <HomePage onOpenGame={openGame} />;
    }

    if (page === "catalogue") {
      const animateCatalogueFilterPlaceholders =
        page === "catalogue" &&
        !catalogue.catalogueDatabase.games.length &&
        !debouncedQuery.trim();

      return (
        <LazyCataloguePage
          games={catalogue.catalogueDatabase.games}
          facets={
            catalogue.catalogueFacets ?? catalogue.catalogueDatabase.facets
          }
          filtersLoading={
            catalogue.isLoadingCatalogueFacets && !catalogue.catalogueFacets
          }
          loading={catalogue.shouldShowCatalogueLoading}
          query={debouncedQuery}
          page={catalogue.cataloguePage}
          chunkOffset={catalogue.catalogueChunkOffset}
          matched={catalogue.catalogueDatabase.matched}
          filters={catalogue.catalogueFilters}
          sort={catalogue.catalogueSort}
          animateFilterPlaceholders={animateCatalogueFilterPlaceholders}
          onFiltersChange={catalogue.handleCatalogueFiltersChange}
          onSortChange={catalogue.handleCatalogueSortChange}
          onPageChange={catalogue.handleCataloguePageChange}
          onOpenGame={openGame}
          favoriteGameIds={appData.favoriteGameIds}
          addedGameAppIds={appData.addedLibraryGameAppIds}
          libraryGameAppIds={appData.availableLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          removingGameId={appData.removingGameId}
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onRemoveGame={appData.removeQueuedGame}
          userCollections={appData.userCollections}
          onAddGameToCollection={appData.addGameToUserCollection}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
          pulseLoading={catalogue.shouldPulseCatalogueLoading}
          scrollElementRef={contentRef}
        />
      );
    }

    if (page === "library") {
      return (
        <LazyLibraryPage
          games={appData.addedLibraryGames}
          favoriteGames={appData.favoriteGames}
          loading={false}
          query={debouncedQuery}
          onOpenGame={openGame}
          removableGameAppIds={appData.addedLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          launchingGameId={appData.launchingGameId}
          onRemoveGame={appData.removeQueuedGame}
          onPlayGame={appData.handlePlayGame}
          favoriteGameIds={appData.favoriteGameIds}
          userCollections={appData.userCollections}
          activeCollectionId={activeProfileCollectionId ?? null}
          onActiveCollectionChange={(id) => setActiveProfileCollectionId(id ?? undefined)}
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          backupSettings={appData.backupSettings}
          backupRootStatus={appData.backupRootStatus}
          activeSessionAppIds={appData.activeSessionAppIds}
        />
      );
    }

    if (page === "favorites") {
      return (
        <LazyFavoritesPage
          games={appData.favoriteGames}
          onOpenGame={openGame}
          onToggleFavorite={appData.toggleFavoriteGame}
          favoriteGameIds={appData.favoriteGameIds}
          libraryGameAppIds={appData.availableLibraryGameAppIds}
          removableGameAppIds={appData.addedLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          userCollections={appData.userCollections}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onRemoveGame={appData.removeQueuedGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
        />
      );
    }

    if (page === "settings") {
      return (
        <LazySettingsPage
          activeTabId={activeSettingsTabId as never}
          games={appData.addedLibraryGames}
          initialPage={appData.initialPage}
          onInitialPageChange={appData.setInitialPage}
          steamPath={appData.steamPathInput}
          onSelectSteamPath={appData.handleSelectSteamPath}
          startupSettings={
            appData.startupSettings ?? {
              openAtLogin: false,
              startMinimized: false,
              minimizeToTray: false,
              gameDatabaseUpdateIntervalHours: 24,
            }
          }
          onStartupSettingsChange={appData.handleStartupSettingsChange}
          morrenusApiKey={appData.morrenusApiKey}
          onMorrenusApiKeyChange={appData.setMorrenusApiKey}
          onMorrenusApiKeySave={() =>
            void appData.handleMorrenusApiKeySave(appData.morrenusApiKey)
          }
          backupSettings={appData.backupSettings}
          onSelectBackupOutputPath={appData.handleSelectBackupOutputPath}
          onToggleLibraryAutomaticBackups={
            appData.handleToggleLibraryAutomaticBackups
          }
        />
      );
    }

    if (page === "backup") {
      return (
        <LazyBackupPage
          games={appData.addedLibraryGames}
          installedGameAppIds={appData.addedLibraryGameAppIds}
          isRefreshingInstallationStatus={appData.isScanningSteamLibrary}
          backupSettings={appData.backupSettings}
          backupRootStatus={appData.backupRootStatus}
          onLocateBackupRoot={appData.handleSelectBackupOutputPath}
          onCreateBackupRoot={appData.handleCreateBackupRoot}
          onBackupSettingsChange={appData.setBackupSettings}
          onOpenBackupFolder={appData.handleOpenBackupFolder}
          onDeleteBackupFolder={appData.handleDeleteBackupFolder}
        />
      );
    }

    if (page === "profile") {
      return (
        <LazyProfilePage
          steamProfile={appData.steamProfile}
          favoriteGames={appData.profileFavoriteGames}
          addedLibraryGames={appData.profileAddedLibraryGames}
          achievementHistoryGames={appData.profileHistoryGames}
          userCollections={appData.userCollections}
          activeCollectionId={activeProfileCollectionId}
          onSelectCollection={setActiveProfileCollectionId}
          onCreateCollection={appData.openCreateUserCollectionModal}
          onUpdateProfile={appData.handleUpdateProfile}
          onOpenGame={openGame}
          removableGameAppIds={appData.addedLibraryGameAppIds}
          libraryGameAppIds={appData.availableLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          activeSessionAppIds={appData.activeSessionAppIds}
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          onAddGame={appData.queueGame}
          onRemoveGame={appData.removeQueuedGame}
          onPlayGame={appData.handlePlayGame}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
          favoriteGameIds={appData.favoriteGameIds}
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onOpenGameAchievements={(game) => openAchievements(game)}
        />
      );
    }

    if (page === "notifications") {
      return <LazyNotificationsPage onOpenGame={openGame} />;
    }

    return null;
  }

  return (
    <>
      {hasOverlay ? (
        <ContentOverlay page={page} />
      ) : (
        <div
          key={pageEnterKey}
          className={`page page--${page} ${!appearance.disableTabAnimations ? "page-enter" : ""} ${isMainPage ? "page--main-pages page--active" : ""}`}
        >
          <Suspense fallback={<DeferredPagePlaceholder page={page} />}>
            {renderPage()}
          </Suspense>
        </div>
      )}

      <CollectionModal
        open={collectionModalOpen}
        onClose={() => setCollectionModalOpen(false)}
        onSubmit={appData.createUserCollection}
      />

      <SteamPathModal
        open={steamPathModalOpen}
        value={appData.steamPathInput}
        checkedPaths={[]}
        loading={steamPathModalLoading}
        onChange={appData.setSteamPathInput}
        onClose={() => setSteamPathModalOpen(false)}
        onSubmit={async (value) => {
          setSteamPathModalLoading(true);
          try {
            appData.setSteamPathInput(value);
            await appData.handleSelectSteamPath();
            setSteamPathModalOpen(false);
          } finally {
            setSteamPathModalLoading(false);
          }
        }}
      />

      <ConfirmModal
        open={Boolean(pendingBackupDeletion)}
        title={
          appearance.language === "en"
            ? "Delete backup folder?"
            : "Excluir pasta de backup?"
        }
        description={
          pendingBackupDeletion
            ? appearance.language === "en"
              ? `This will permanently delete the backup folder for ${pendingBackupDeletion.title}.`
              : `Isso vai excluir permanentemente a pasta de backup de ${pendingBackupDeletion.title}.`
            : ""
        }
        confirmLabel={appearance.language === "en" ? "Delete" : "Excluir"}
        cancelLabel={appearance.language === "en" ? "Cancel" : "Cancelar"}
        onClose={() => setPendingBackupDeletion(null)}
        onConfirm={() => {
          if (pendingBackupDeletion) {
            void pirateboxApi
              .deleteBackupFolder(
                pendingBackupDeletion.appId,
                pendingBackupDeletion.backupPath
              )
              .then((result) => {
                if (result.error) {
                  showToast("Falha ao excluir backup", result.error);
                }
              });
          }
          setPendingBackupDeletion(null);
        }}
      />
    </>
  );
}
