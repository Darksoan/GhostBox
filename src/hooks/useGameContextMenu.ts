import { useAppData } from "../context/AppDataContext";
import {
  useCollectionContextMenu,
  type UseCollectionContextMenuOptions,
} from "./useCollectionContextMenu";

type GameContextMenuOptions = Pick<
  UseCollectionContextMenuOptions,
  | "game"
  | "onOpenGame"
  | "includeFavorites"
  | "directFavoriteAction"
  | "onlyCollectionActions"
  | "excludeCollectionId"
>;

export function useGameContextMenu(options: GameContextMenuOptions) {
  const {
    favoriteGameIds,
    availableLibraryGameAppIds,
    addedLibraryGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    queueGame,
    handlePlayGame,
    requestRemoveGame,
    toggleFavoriteGame,
    addGameToUserCollection,
    removeGameFromCollection,
  } = useAppData();

  return useCollectionContextMenu({
    ...options,
    favoriteGameIds,
    libraryGameAppIds: availableLibraryGameAppIds,
    removableGameAppIds: addedLibraryGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onAddGame: queueGame,
    onPlayGame: handlePlayGame,
    onRemoveGame: requestRemoveGame,
    onToggleFavorite: toggleFavoriteGame,
    onAddGameToCollection: addGameToUserCollection,
    onRemoveGameFromCollection: removeGameFromCollection,
  });
}
