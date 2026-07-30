import { PagePlaceholder } from "../ui/LoadingStates";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useCatalogueState } from "../../hooks/useCatalogueState";
import type { CatalogueFilterKey, Page, SteamProfile } from "../../types";
import { emptyCatalogueFilters } from "../../constants/catalogue";
import { ContentOverlay, useContentOverlayState } from "./ContentOverlay";
import { CollectionModal } from "../modals/CollectionModal";
import { SteamPathModal } from "../modals/SteamPathModal";
import { SubscriptionModal } from "../modals/SubscriptionModal";
import { markPageLoaded } from "../../utils/loadedPages";
import { preloadGameModalModule } from "../../utils/gameModalLoader";

const LazyHomePage = lazy(() =>
  import("../../pages/HomePage").then((m) => {
    markPageLoaded("home");
    return { default: m.HomePage };
  }),
);
const LazyCataloguePage = lazy(() =>
  import("../../pages/CataloguePage").then((m) => {
    markPageLoaded("catalogue");
    return { default: m.CataloguePage };
  }),
);
const LazyLibraryPage = lazy(() =>
  import("../../pages/LibraryPage").then((m) => {
    markPageLoaded("library");
    return { default: m.LibraryPage };
  }),
);
const LazyFavoritesPage = lazy(() =>
  import("../../pages/FavoritesPage").then((m) => {
    markPageLoaded("favorites");
    return { default: m.FavoritesPage };
  }),
);
const LazySettingsPage = lazy(() =>
  import("../../pages/SettingsPage").then((m) => {
    markPageLoaded("settings");
    return { default: m.SettingsPage };
  }),
);
const loadProfilePage = () =>
  import("../../pages/ProfilePage").then((m) => {
    markPageLoaded("profile");
    return m;
  });
const LazyProfilePage = lazy(() =>
  loadProfilePage().then((m) => ({ default: m.ProfilePage })),
);
const LazyNotificationsPage = lazy(() =>
  import("../../pages/NotificationsPage").then((m) => {
    markPageLoaded("notifications");
    return { default: m.NotificationsPage };
  }),
);
const LazyDownloadsPage = lazy(() =>
  import("../../pages/DownloadsPage").then((m) => {
    markPageLoaded("downloads");
    return { default: m.DownloadsPage };
  }),
);

const KEEP_ALIVE_PAGES: Page[] = [
  "home",
  "catalogue",
  "library",
  "favorites",
  "settings",
  "profile",
  "notifications",
  "downloads",
];

const PREFETCH_DELAYS_MS: Record<Page, number> = {
  home: 1_800,
  catalogue: 1_800,
  library: 2_200,
  favorites: 2_200,
  settings: 3_200,
  profile: 3_600,
  notifications: 3_200,
  downloads: 3_200,
};

const PAGE_LOADERS: Record<Page, () => Promise<unknown>> = {
  home: () => import("../../pages/HomePage"),
  catalogue: () => import("../../pages/CataloguePage"),
  library: () => import("../../pages/LibraryPage"),
  favorites: () => import("../../pages/FavoritesPage"),
  settings: () => import("../../pages/SettingsPage"),
  profile: loadProfilePage,
  notifications: () => import("../../pages/NotificationsPage"),
  downloads: () => import("../../pages/DownloadsPage"),
};

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
    setCollectionModalOpen,
    setSteamPathModalOpen,
    setSubscriptionModalOpen,
  } = useOverlay();
  const { hasOverlay } = useContentOverlayState();

  const catalogue = useCatalogueState(debouncedQuery, page === "catalogue");

  const [mountedPages, setMountedPages] = useState<Set<Page>>(
    () => new Set<Page>([page]),
  );

  // Keep-alive mounting must align with `page` before paint. Adjusting during
  // render (React-supported) avoids a blank frame for a newly visited page.
  if (!appearance.disablePageKeepAlive && !mountedPages.has(page)) {
    const nextMounted = new Set(mountedPages);
    nextMounted.add(page);
    setMountedPages(nextMounted);
  }

  useEffect(() => {
    const timeoutHandles: number[] = [];
    const idleHandles: number[] = [];
    const schedule = (delay: number, loader: () => Promise<unknown>) => {
      const run = () => {
        const exec = () => void loader();
        if (delay <= 0) {
          exec();
          return;
        }
        timeoutHandles.push(window.setTimeout(exec, delay));
      };

      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }).requestIdleCallback;
      if (!ric) {
        timeoutHandles.push(window.setTimeout(run, 1));
        return;
      }

      const idleHandle = ric(run);
      idleHandles.push(idleHandle);
    };

    schedule(1_200, async () => preloadGameModalModule());

    KEEP_ALIVE_PAGES.forEach((targetPage) => {
      if (targetPage === page) return;
      schedule(PREFETCH_DELAYS_MS[targetPage], PAGE_LOADERS[targetPage]);
    });

    return () => {
      timeoutHandles.forEach((handle) => window.clearTimeout(handle));
      const cancelIdleCallback = (window as unknown as {
        cancelIdleCallback?: (handle: number) => void;
      }).cancelIdleCallback;
      idleHandles.forEach((handle) => cancelIdleCallback?.(handle));
    };
  }, [page]);

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
          steamProfile={steamProfile}
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGame={appData.queueGame}
          onPlayGame={appData.handlePlayGame}
          onRemoveGame={appData.removeQueuedGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          onRemoveGameFromCollection={appData.removeGameFromCollection}
          onOpenCatalogueCategory={(
            key: Extract<CatalogueFilterKey, "genres" | "tags">,
            value: string,
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
          animateFilterPlaceholders={animateCatalogueFilterPlaceholders}
          onFiltersChange={catalogue.handleCatalogueFiltersChange}
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
          onActiveCollectionChange={(id) =>
            setActiveProfileCollectionId(id ?? undefined)
          }
          onToggleFavorite={appData.toggleFavoriteGame}
          onAddGameToCollection={appData.addGameToUserCollection}
          backupSettings={appData.backupSettings}
          activeSessionAppIds={appData.activeSessionAppIds}
          isActive={targetPage === page}
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
          isActive={targetPage === page}
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
          steamAccountStats={appData.steamAccountStats}
          isCloudProfileRestoring={appData.isCloudProfileRestoring}
          favoriteGames={appData.profileFavoriteGames}
          addedLibraryGames={appData.profileAddedLibraryGames}
          achievementHistoryGames={appData.profileHistoryGames}
          userCollections={appData.userCollections}
          activeCollectionId={activeProfileCollectionId}
          onSelectCollection={setActiveProfileCollectionId}
          scrollElementRef={contentRef}
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
      return <LazyNotificationsPage />;
    }

    if (targetPage === "downloads") {
      return <LazyDownloadsPage />;
    }

    return null;
  }

  const keepAlivePages = useMemo(
    () => appearance.disablePageKeepAlive ? [page] : KEEP_ALIVE_PAGES.filter((p) => mountedPages.has(p)),
    [appearance.disablePageKeepAlive, mountedPages, page],
  );

  return (
    <>
      <div
        className={`page-stack${hasOverlay ? " page-stack--overlay-open" : ""}`}
      >
        <div
          className="page-stack__base"
          aria-hidden={hasOverlay}
        >
          {keepAlivePages.map((targetPage) => {
            const isActive = targetPage === page;
            const wrapperClass = `page page--${targetPage} ${
              isMainPage && isActive ? "page--main-pages page--active" : ""
            }`;

            return (
              <div
                key={targetPage}
                className={wrapperClass}
                hidden={!isActive}
                aria-hidden={!isActive || hasOverlay}
              >
                <Suspense
                  fallback={<PagePlaceholder page={targetPage} />}
                >
                  {renderPage(targetPage)}
                </Suspense>
              </div>
            );
          })}
        </div>
        {hasOverlay ? (
          <div className="page-stack__overlay">
            <ContentOverlay page={page} />
          </div>
        ) : null}
      </div>

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
    </>
  );
}
