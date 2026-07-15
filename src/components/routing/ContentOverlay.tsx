import { lazy, Suspense } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { PagePlaceholder } from "../ui/LoadingStates";
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

interface ContentOverlayProps {
  page: Page;
}

export function ContentOverlay({ page }: ContentOverlayProps) {
  const appData = useAppData();
  const { appearance } = useSettings();
  const {
    selectedGame,
    achievementsView,
    closeGame,
    openAchievements,
  } = useOverlay();

  // Same entry motion as tab switches (`page-block-in` via `.page-enter`).
  const enterClass = appearance.disableTabAnimations ? "" : " page-enter";

  if (achievementsView) {
    return (
      <div
        className={`page page--game-achievements${enterClass}`}
        key={`achievements-${achievementsView.game.id}`}
      >
        <Suspense fallback={<PagePlaceholder page={page} />}>
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
      <div
        className={`page page--game-modal${enterClass}`}
        key={`game-modal-${selectedGame.id}`}
      >
        <Suspense fallback={<PagePlaceholder page={page} />}>
          <LazyGameModal
            game={mergedGame}
            isAdding={appData.addingGameId === selectedGame.id}
            isAdded={appData.availableLibraryGameAppIds.has(selectedGame.appId)}
            isInstalled={appData.addedLibraryGameAppIds.has(selectedGame.appId)}
            isRemoving={appData.removingGameId === selectedGame.id}
            isPlaying={appData.launchingGameId === selectedGame.id}
            isSessionActive={isSessionActive}
            isFavorite={appData.favoriteGameIds.has(selectedGame.id)}
            userCollections={appData.userCollections}
            steamProfile={appData.steamProfile}
            onClose={closeGame}
            onQueueGame={appData.queueGame}
            onRemoveGame={appData.removeQueuedGame}
            onToggleFavorite={appData.toggleFavoriteGame}
            onAddGameToCollection={appData.addGameToUserCollection}
            onRemoveGameFromCollection={appData.removeGameFromCollection}
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
