import { useMemo } from "react";
import type { PirateGame } from "../data";
import type { UserCollection } from "../types";
import { Download, Folder, Heart, Play, TextSearch, Trash } from "lucide-react";
import { ContextMenuItem } from "../components/ui/ContextMenu";

interface UseCollectionContextMenuOptions {
  game: PirateGame | null;
  favoriteGameIds: Set<string>;
  libraryGameAppIds?: Set<string>;
  removableGameAppIds?: Set<string>;
  playableGameAppIds?: Set<string>;
  addingGameId?: string | null;
  launchingGameId?: string | null;
  userCollections: UserCollection[];
  onOpenGame?: (game: PirateGame) => void;
  onAddGame?: (game: PirateGame) => void;
  onPlayGame?: (game: PirateGame) => void;
  onRemoveGame?: (game: PirateGame) => void;
  onToggleFavorite?: (game: PirateGame) => void;
  onAddGameToCollection?: (game: PirateGame, collectionId: string) => void;
  onRemoveGameFromCollection?: (game: PirateGame, collectionId: string) => void;
  includeFavorites?: boolean;
  directFavoriteAction?: boolean;
  onlyCollectionActions?: boolean;
  excludeCollectionId?: string;
}

export function useCollectionContextMenu({
  game,
  favoriteGameIds,
  libraryGameAppIds,
  removableGameAppIds,
  playableGameAppIds,
  addingGameId,
  launchingGameId,
  userCollections,
  onOpenGame,
  onAddGame,
  onPlayGame,
  onRemoveGame,
  onToggleFavorite,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  includeFavorites = true,
  directFavoriteAction = false,
  onlyCollectionActions = false,
  excludeCollectionId,
}: UseCollectionContextMenuOptions): ContextMenuItem[] {
  return useMemo(() => {
    if (!game) return [];

    const hasGameKey = (keys: Set<string> | undefined) => {
      if (!keys) return false;
      const appId = game.appId || game.id.replace(/^steam-/, "");
      return keys.has(game.id) || keys.has(game.appId) || keys.has(appId) || keys.has(`steam-${appId}`);
    };

    const isFavorite = favoriteGameIds.has(game.id);
    const isRemovableFromLibrary = hasGameKey(removableGameAppIds);
    const canPlay = hasGameKey(playableGameAppIds);
    const isInLibrary = Boolean(
      hasGameKey(libraryGameAppIds) || isRemovableFromLibrary || canPlay
    );
    const isAdding = addingGameId === game.id;
    const isLaunching = launchingGameId === game.id;
    const showDirectFavoriteAction = includeFavorites && directFavoriteAction;
    const showFavoriteCollectionShortcut = includeFavorites && !showDirectFavoriteAction;
    const addableCollections = userCollections.filter(
      (c) => !c.gameIds.includes(game.id) && c.id !== excludeCollectionId
    );
    const removableCollections = userCollections.filter(
      (c) => c.gameIds.includes(game.id) && c.id !== excludeCollectionId
    );

    const items: ContextMenuItem[] = [];

    if (!onlyCollectionActions && onOpenGame) {
      items.push({
        label: "Game details",
        icon: TextSearch,
        onClick: () => onOpenGame(game),
      });
    }

    if (!onlyCollectionActions && onPlayGame && canPlay && !isLaunching) {
      items.push({
        label: "Play",
        icon: Play,
        onClick: () => onPlayGame(game),
      });
    }

    if (!onlyCollectionActions && showDirectFavoriteAction && onToggleFavorite) {
      items.push({
        label: isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
        icon: Heart,
        danger: isFavorite,
        onClick: () => onToggleFavorite(game),
      });
    }

    if (!onlyCollectionActions && onAddGame && !isInLibrary && !isAdding) {
      items.push({
        label: "Adicionar à biblioteca",
        icon: Download,
        onClick: () => onAddGame(game),
      });
    }

    if ((showFavoriteCollectionShortcut && !isFavorite) || addableCollections.length) {
      items.push({
        label: "Adicionar à coleção",
        icon: Folder,
        children: [
          ...(showFavoriteCollectionShortcut && !isFavorite
            ? [
                {
                  label: "Favoritos",
                  onClick: () => onToggleFavorite?.(game),
                },
              ]
            : []),
          ...addableCollections.map((c) => ({
            label: c.name,
            onClick: () => onAddGameToCollection?.(game, c.id),
          })),
        ],
      });
    }

    if ((showFavoriteCollectionShortcut && isFavorite) || removableCollections.length) {
      items.push({
        label: "Remover da coleção",
        icon: Folder,
        danger: true,
        children: [
          ...(showFavoriteCollectionShortcut && isFavorite
            ? [
                {
                  label: "Favoritos",
                  danger: true,
                  onClick: () => onToggleFavorite?.(game),
                },
              ]
            : []),
          ...removableCollections.map((c) => ({
            label: c.name,
            danger: true,
            onClick: () => onRemoveGameFromCollection?.(game, c.id),
          })),
        ],
      });
    }

    if (!onlyCollectionActions && onRemoveGame && isRemovableFromLibrary) {
      items.push({
        label: "Remover da biblioteca",
        icon: Trash,
        danger: true,
        onClick: () => onRemoveGame(game),
      });
    }

    return items;
  }, [
    game,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    includeFavorites,
    directFavoriteAction,
    onlyCollectionActions,
    excludeCollectionId,
    onOpenGame,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onToggleFavorite,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  ]);
}
