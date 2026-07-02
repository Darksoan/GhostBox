import { lazy, Suspense } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import type { Page } from "../../types";

const LazyGameModal = lazy(() =>
  import("../modals/GameModal").then((module) => ({
    default: module.GameModal,
  }))
);

const LazyGameAchievementsPage = lazy(() =>
  import("../../pages/GameAchievementsPage").then((module) => ({
    default: module.GameAchievementsPage,
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

interface ContentOverlayProps {
  page: Page;
}

export function ContentOverlay({ page }: ContentOverlayProps) {
  const appData = useAppData();
  const {
    selectedGame,
    achievementsView,
    closeGame,
    openAchievements,
  } = useOverlay();

  if (achievementsView) {
    return (
      <div className="page page--game-achievements">
        <Suspense fallback={<DeferredPagePlaceholder page={page} />}>
          <LazyGameAchievementsPage
            game={achievementsView.game}
            highlightAchievementId={achievementsView.highlightAchievementId}
            onDetailsLoaded={appData.handleGameDetailsLoaded}
          />
        </Suspense>
      </div>
    );
  }

  if (selectedGame) {
    const mergedGame =
      appData.addedLibraryGames.find((game) => game.id === selectedGame.id) ??
      appData.favoriteGames.find((game) => game.id === selectedGame.id) ??
      selectedGame;
    const isSessionActive = appData.activeSessionAppIds.has(selectedGame.appId);
    return (
      <div className="page page--game-modal">
        <Suspense fallback={<DeferredPagePlaceholder page={page} />}>
          <LazyGameModal
            game={mergedGame}
            isAdding={appData.addingGameId === selectedGame.id}
            isAdded={appData.availableLibraryGameAppIds.has(selectedGame.appId)}
            isInstalled={appData.addedLibraryGameAppIds.has(selectedGame.appId)}
            isRemoving={appData.removingGameId === selectedGame.id}
            isPlaying={appData.launchingGameId === selectedGame.id}
            isSessionActive={isSessionActive}
            isFavorite={appData.favoriteGameIds.has(selectedGame.id)}
            customExecutablePath={
              appData.backupSettings?.customExecutables[selectedGame.appId] ?? ""
            }
            userCollections={appData.userCollections}
            steamProfile={appData.steamProfile}
            onClose={closeGame}
            onQueueGame={appData.queueGame}
            onRemoveGame={appData.removeQueuedGame}
            onToggleFavorite={appData.toggleFavoriteGame}
            onAddGameToCollection={appData.addGameToUserCollection}
            onRemoveGameFromCollection={appData.removeGameFromCollection}
            onSelectGameExecutable={appData.handleSelectGameExecutable}
            onRemoveGameExecutable={appData.handleRemoveGameExecutable}
            onPlayGame={appData.handlePlayGame}
            onViewAchievements={(game) =>
              openAchievements(game, { reopenModalOnBack: true })
            }
            onDetailsLoaded={appData.handleGameDetailsLoaded}
          />
        </Suspense>
      </div>
    );
  }

  return null;
}

export function useContentOverlayState() {
  const { selectedGame, achievementsView, isGameModalExitPending } = useOverlay();
  return {
    isGameModalVisible: Boolean(selectedGame) || isGameModalExitPending,
    isAchievementsViewVisible: Boolean(achievementsView),
    hasOverlay: Boolean(selectedGame) || isGameModalExitPending || achievementsView,
  };
}
