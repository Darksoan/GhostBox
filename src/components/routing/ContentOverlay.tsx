import { lazy, Suspense } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { PagePlaceholder } from "../ui/LoadingStates";
import type { Page, SteamAccountStats } from "../../types";
import { getGameAppId } from "../../utils/image";
import { mergeSteamAchievementsIntoGame } from "../../utils/steamAchievementMerge";

function matchesSelectedGame(candidate: GhostBoxGame, selected: GhostBoxGame) {
  if (candidate.id === selected.id) return true;
  const selectedAppId = getGameAppId(selected);
  const candidateAppId = getGameAppId(candidate);
  return Boolean(selectedAppId) && selectedAppId === candidateAppId;
}

function resolveOverlayGame(
  selected: GhostBoxGame,
  libraryGames: GhostBoxGame[],
  favoriteGames: GhostBoxGame[],
  historyGames: GhostBoxGame[],
  steamAccountStats: SteamAccountStats | null,
) {
  const libraryGame = libraryGames.find((game) =>
    matchesSelectedGame(game, selected),
  );
  const favoriteGame = favoriteGames.find((game) =>
    matchesSelectedGame(game, selected),
  );
  const historyGame = historyGames.find((game) =>
    matchesSelectedGame(game, selected),
  );
  const source = libraryGame ?? favoriteGame ?? historyGame ?? selected;
  const playtimeSource = [libraryGame, favoriteGame, historyGame, selected]
    .filter((game): game is GhostBoxGame => Boolean(game))
    .sort(
      (left, right) =>
        (right.playTimeInMilliseconds ?? 0) -
        (left.playTimeInMilliseconds ?? 0),
    )[0];

  return mergeSteamAchievementsIntoGame(
    {
      ...source,
      playTimeInMilliseconds:
        playtimeSource?.playTimeInMilliseconds ?? source.playTimeInMilliseconds,
      lastTimePlayed: playtimeSource?.lastTimePlayed ?? source.lastTimePlayed,
      lastSessionRecordedAt:
        playtimeSource?.lastSessionRecordedAt ?? source.lastSessionRecordedAt,
      lastSessionDurationInMilliseconds:
        playtimeSource?.lastSessionDurationInMilliseconds ??
        source.lastSessionDurationInMilliseconds,
      sessionActive:
        playtimeSource?.sessionActive === true || source.sessionActive === true,
    },
    steamAccountStats,
  );
}

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
    isGameModalExitPending,
    closeGame,
    openAchievements,
  } = useOverlay();

  const animationsOff = appearance.reduceAllAnimations;
  const motionClass = animationsOff
    ? ""
    : isGameModalExitPending
      ? " content-overlay-exit"
      : "";

  if (achievementsView) {
    const achievementsGame = resolveOverlayGame(
      achievementsView.game,
      appData.addedLibraryGames,
      appData.favoriteGames,
      appData.profileHistoryGames,
      appData.steamAccountStats,
    );
    return (
      <div
        className={`page page--game-achievements${motionClass}`}
        key={`achievements-${achievementsView.game.id}`}
        aria-hidden={isGameModalExitPending}
      >
        <Suspense fallback={<PagePlaceholder page={page} />}>
          <LazyGameAchievementsPage
            game={achievementsGame}
            highlightAchievementId={achievementsView.highlightAchievementId}
            onDetailsLoaded={appData.handleGameDetailsLoaded}
          />
        </Suspense>
      </div>
    );
  }

  if (selectedGame) {
    const mergedGame = resolveOverlayGame(
      selectedGame,
      appData.addedLibraryGames,
      appData.favoriteGames,
      appData.profileHistoryGames,
      appData.steamAccountStats,
    );
    const selectedAppId = getGameAppId(selectedGame);
    const isSessionActive =
      appData.activeSessionAppIds.has(selectedAppId) ||
      appData.activeSessionAppIds.has(selectedGame.appId);
    const isFavorite =
      appData.favoriteGameIds.has(selectedGame.id) ||
      appData.favoriteGameIds.has(mergedGame.id) ||
      appData.favoriteGames.some((game) =>
        matchesSelectedGame(game, selectedGame),
      );
    return (
      <div
        className={`page page--game-modal${motionClass}`}
        key={`game-modal-${selectedGame.id}`}
        aria-hidden={isGameModalExitPending}
      >
        <Suspense fallback={<PagePlaceholder page={page} />}>
          <LazyGameModal
            game={mergedGame}
            isAdding={
              appData.addingGameId === selectedGame.id ||
              appData.addingGameId === mergedGame.id
            }
            isAdded={appData.availableLibraryGameAppIds.has(selectedAppId)}
            isInstalled={appData.addedLibraryGameAppIds.has(selectedAppId)}
            isRemoving={
              appData.removingGameId === selectedGame.id ||
              appData.removingGameId === mergedGame.id
            }
            isPlaying={
              appData.launchingGameId === selectedGame.id ||
              appData.launchingGameId === mergedGame.id
            }
            isSessionActive={isSessionActive}
            isFavorite={isFavorite}
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
    hasOverlay:
      Boolean(selectedGame) || Boolean(achievementsView) || isGameModalExitPending,
  };
}
