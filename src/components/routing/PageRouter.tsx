import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useCatalogueState } from "../../hooks/useCatalogueState";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { CatalogueFilterKey, Page, SteamProfile } from "../../types";
import { emptyCatalogueFilters } from "../../constants/catalogue";
import { ContentOverlay, useContentOverlayState } from "./ContentOverlay";
import { ConfirmModal } from "../modals/ConfirmModal";
import { CollectionModal } from "../modals/CollectionModal";
import { SteamPathModal } from "../modals/SteamPathModal";
import { SubscriptionModal } from "../modals/SubscriptionModal";
import { markPageLoaded } from "../../utils/loadedPages";

const LazyHomePage = lazy(() =>
  import("../../pages/HomePage").then((m) => {
    markPageLoaded("home");
    return { default: m.HomePage };
  })
);
const LazyCataloguePage = lazy(() =>
  import("../../pages/CataloguePage").then((m) => {
    markPageLoaded("catalogue");
    return { default: m.CataloguePage };
  })
);
const LazyLibraryPage = lazy(() =>
  import("../../pages/LibraryPage").then((m) => {
    markPageLoaded("library");
    return { default: m.LibraryPage };
  })
);
const LazyFavoritesPage = lazy(() =>
  import("../../pages/FavoritesPage").then((m) => {
    markPageLoaded("favorites");
    return { default: m.FavoritesPage };
  })
);
const LazySettingsPage = lazy(() =>
  import("../../pages/SettingsPage").then((m) => {
    markPageLoaded("settings");
    return { default: m.SettingsPage };
  })
);
const loadProfilePage = () =>
  import("../../pages/ProfilePage").then((m) => {
    markPageLoaded("profile");
    return m;
  });
const LazyProfilePage = lazy(() =>
  loadProfilePage().then((m) => ({ default: m.ProfilePage }))
);
const LazyNotificationsPage = lazy(() =>
  import("../../pages/NotificationsPage").then((m) => {
    markPageLoaded("notifications");
    return { default: m.NotificationsPage };
  })
);

// Pages that stay mounted at all times after their first load so switching
// back to them is instant (no Suspense fallback, no DOM remount).
const KEEP_ALIVE_PAGES: Page[] = [
  "home",
  "catalogue",
  "library",
  "favorites",
  "settings",
  "profile",
  "notifications",
];

// First-paint priorities for idle prefetching of the lazy chunks. Lower fires
// sooner. Home and Catalogue are usually needed immediately.
const PREFETCH_DELAYS_MS: Record<Page, number> = {
  home: 0,
  catalogue: 0,
  library: 200,
  favorites: 200,
  settings: 400,
  profile: 300,
  notifications: 400,
};

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
  isMainPage: boolean;
  contentRef: RefObject<HTMLElement>;
  steamPathModalLoading: boolean;
  setSteamPathModalLoading: (loading: boolean) => void;
  onNavigateToCatalogue: () => void;
  steamProfile: SteamProfile | null;
}

export function PageRouter({
  page,
  debouncedQuery,
  activeSettingsTabId,
  activeProfileCollectionId,
  setActiveProfileCollectionId,
  isMainPage,
  contentRef,
  steamPathModalLoading,
  setSteamPathModalLoading,
  onNavigateToCatalogue,
  steamProfile,
}: PageRouterProps) {
  const { appearance } = useSettings();
  const appData = useAppData();
  const {
    openGame,
    openAchievements,
    collectionModalOpen,
    steamPathModalOpen,
    subscriptionModalOpen,
    pendingBackupDeletion,
    setCollectionModalOpen,
    setSteamPathModalOpen,
    setSubscriptionModalOpen,
    setPendingBackupDeletion,
    showToast,
  } = useOverlay();
  const { hasOverlay } = useContentOverlayState();

  const catalogue = useCatalogueState(debouncedQuery, page === "catalogue");

  // Tracks which secondary pages have already been mounted at least once.
  // Primary pages are always mounted, so they're considered "mounted" from the
  // start for visibility purposes.
  const [mountedPages, setMountedPages] = useState<Set<Page>>(
    () => new Set<Page>(["home", "catalogue", "library", "favorites"])
  );

  // Track the previously active page so only the freshly-activated wrapper
  // receives the `page-enter` animation class (avoids re-animating siblings
  // that were already mounted).
  const previousPageRef = useRef<Page>(page);
  const [enteringPage, setEnteringPage] = useState<Page | null>(page);

  useEffect(() => {
    setMountedPages((current) => {
      if (current.has(page)) return current;
      const next = new Set(current);
      next.add(page);
      return next;
    });

    if (previousPageRef.current !== page) {
      previousPageRef.current = page;
      setEnteringPage(page);
    }
  }, [page]);

  // Idle prefetch of every lazy chunk so first visits to secondary tabs don't
  // show the Suspense spinner. Uses requestIdleCallback when available.
  useEffect(() => {
    const schedule = (delay: number, loader: () => Promise<unknown>) => {
      const run = () => {
        const exec = () => void loader();
        if (delay <= 0) {
          exec();
          return;
        }
        window.setTimeout(exec, delay);
      };

      const ric =
        (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
          .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
      ric(run);
    };

    schedule(PREFETCH_DELAYS_MS.home, () => import("../../pages/HomePage"));
    schedule(PREFETCH_DELAYS_MS.catalogue, () =>
      import("../../pages/CataloguePage")
    );
    schedule(PREFETCH_DELAYS_MS.library, () => import("../../pages/LibraryPage"));
    schedule(PREFETCH_DELAYS_MS.favorites, () =>
      import("../../pages/FavoritesPage")
    );
    schedule(PREFETCH_DELAYS_MS.settings, () =>
      import("../../pages/SettingsPage")
    );
    schedule(PREFETCH_DELAYS_MS.profile, loadProfilePage);
    schedule(PREFETCH_DELAYS_MS.notifications, () =>
      import("../../pages/NotificationsPage")
    );
  }, []);

  function renderPage(targetPage: Page): ReactNode {
    if (targetPage === "home") {
      return (
        <LazyHomePage
          onOpenGame={openGame}
          favoriteGameIds={appData.favoriteGameIds}
          libraryGameAppIds={appData.availableLibraryGameAppIds}
          removableGameAppIds={appData.addedLibraryGameAppIds}
          playableGameAppIds={appData.playableGameAppIds}
          addingGameId={appData.addingGameId}
          launchingGameId={appData.launchingGameId}
          userCollections={appData.userCollections}
          profileHistoryGames={appData.profileHistoryGames}
          steamProfile={steamProfile}
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onRemoveGame={appData.removeQueuedGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
          onOpenCatalogueCategory={(
            key: Extract<CatalogueFilterKey, "genres" | "tags">,
            value: string
          ) => {
            catalogue.handleCatalogueFiltersChange({
              ...emptyCatalogueFilters,
              [key]: [value],
            });
            onNavigateToCatalogue();
          }}
        />
      );
    }

    if (targetPage === "catalogue") {
      const animateCatalogueFilterPlaceholders =
        targetPage === "catalogue" &&
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
          initialLoading={catalogue.isInitialCatalogueLoading}
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

    if (targetPage === "library") {
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

    if (targetPage === "favorites") {
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

    if (targetPage === "settings") {
      return (
        <LazySettingsPage
          activeTabId={activeSettingsTabId as never}
          games={appData.addedLibraryGames}
          steamProfile={appData.steamProfile}
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
        />
      );
    }

    if (targetPage === "profile") {
      return (
        <LazyProfilePage
          steamProfile={appData.steamProfile}
          isCloudProfileRestoring={appData.isCloudProfileRestoring}
          favoriteGames={appData.profileFavoriteGames}
          addedLibraryGames={appData.profileAddedLibraryGames}
          achievementHistoryGames={appData.profileHistoryGames}
          userCollections={appData.userCollections}
          activeCollectionId={activeProfileCollectionId}
          onSelectCollection={setActiveProfileCollectionId}
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
          onSignOut={() => void appData.handleSteamSignOut()}
        />
      );
    }

    if (targetPage === "notifications") {
      return <LazyNotificationsPage onOpenGame={openGame} />;
    }

    return null;
  }

  const keepAlivePages = useMemo(
    () => KEEP_ALIVE_PAGES.filter((p) => mountedPages.has(p)),
    [mountedPages]
  );

  return (
    <>
      {hasOverlay ? (
        <ContentOverlay page={page} />
      ) : (
        <>
          {keepAlivePages.map((targetPage) => {
            const isActive = targetPage === page;
            const shouldAnimate =
              !appearance.disableTabAnimations &&
              isActive &&
              enteringPage === targetPage;
            const wrapperClass = `page page--${targetPage} ${
              shouldAnimate ? "page-enter" : ""
            } ${isMainPage && isActive ? "page--main-pages page--active" : ""}`;

            return (
              <div
                key={targetPage}
                className={wrapperClass}
                hidden={!isActive}
                aria-hidden={!isActive}
              >
                <Suspense fallback={<DeferredPagePlaceholder page={targetPage} />}>
                  {renderPage(targetPage)}
                </Suspense>
              </div>
            );
          })}
        </>
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

      <SubscriptionModal
        open={subscriptionModalOpen}
        onClose={() => setSubscriptionModalOpen(false)}
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
            void ghostboxApi
              .deleteBackupFolder(
                pendingBackupDeletion.appId,
                pendingBackupDeletion.backupPath
              )
              .then((result) => {
                if (result.error) {
                  showToast(
                    appearance.language === "en" ? "Failed to delete backup" : "Falha ao excluir backup",
                    result.error
                  );
                  return;
                }
                if (result.settings) {
                  appData.setBackupSettings(result.settings);
                }
                showToast(
                  appearance.language === "en" ? "Backup deleted" : "Backup excluído",
                  appearance.language === "en"
                    ? `${pendingBackupDeletion.title} backup folder was removed.`
                    : `A pasta de backup de ${pendingBackupDeletion.title} foi removida.`,
                  "success"
                );
              });
          }
          setPendingBackupDeletion(null);
        }}
      />
    </>
  );
}
