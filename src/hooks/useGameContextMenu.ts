import { useEffect, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { ghostboxApi } from "../lib/ghostboxApi";
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

  const appId = options.game?.appId || options.game?.id.replace(/^steam-/, "") || "";
  const isLibraryGame = availableLibraryGameAppIds.has(appId) || addedLibraryGameAppIds.has(appId);
  const [steamInstallCheck, setSteamInstallCheck] = useState<{
    appId: string;
    installed: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSteamInstallCheck(null);
    if (!appId || !isLibraryGame || options.onlyCollectionActions) return;

    void ghostboxApi.isSteamGameInstalled(appId)
      .then((installed) => {
        if (!cancelled) setSteamInstallCheck({ appId, installed });
      })
      .catch(() => {
        if (!cancelled) setSteamInstallCheck({ appId, installed: false });
      });

    return () => {
      cancelled = true;
    };
  }, [appId, isLibraryGame, options.onlyCollectionActions]);

  return useCollectionContextMenu({
    ...options,
    favoriteGameIds,
    libraryGameAppIds: availableLibraryGameAppIds,
    removableGameAppIds: addedLibraryGameAppIds,
    steamInstallConfirmed: steamInstallCheck?.appId === appId && steamInstallCheck.installed,
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
