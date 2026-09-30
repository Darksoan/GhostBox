import { useMemo } from "react";
import type { GhostBoxGame } from "../data";
import type { UserCollection } from "../types";
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  Heart,
  HeartOff,
  Play,
  TextSearch,
  Trash,
  Trophy,
} from "lucide-react";
import { ContextMenuItem } from "../components/ui/ContextMenu";
import { useSettings } from "../context/settings";
import { hasAvailableAchievements } from "../utils/achievementStats";

export interface UseCollectionContextMenuOptions {
  game: GhostBoxGame | null;
  favoriteGameIds: Set<string>;
  libraryGameAppIds?: Set<string>;
  removableGameAppIds?: Set<string>;
  steamInstallConfirmed?: boolean;
  playableGameAppIds?: Set<string>;
  addingGameId?: string | null;
  launchingGameId?: string | null;
  userCollections: UserCollection[];
  onOpenGame?: (game: GhostBoxGame) => void;
  onAddGame?: (game: GhostBoxGame) => void;
  onPlayGame?: (game: GhostBoxGame) => void;
  onOpenAchievements?: (game: GhostBoxGame) => void;
  onToggleHidden?: (game: GhostBoxGame) => void;
  onOpenInSteam?: (game: GhostBoxGame) => void;
  isProfileHidden?: boolean;
  /** AppIds possuídos fora da biblioteca/favoritos (histórico, owned Steam). */
  hideableGameAppIds?: Set<string>;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onToggleFavorite?: (game: GhostBoxGame) => void;
  onAddGameToCollection?: (game: GhostBoxGame, collectionId: string) => void;
  onRemoveGameFromCollection?: (game: GhostBoxGame, collectionId: string) => void;
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
  steamInstallConfirmed = false,
  playableGameAppIds,
  addingGameId,
  launchingGameId,
  userCollections,
  onOpenGame,
  onAddGame,
  onPlayGame,
  onOpenAchievements,
  onToggleHidden,
  onOpenInSteam,
  isProfileHidden = false,
  hideableGameAppIds,
  onRemoveGame,
  onToggleFavorite,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  includeFavorites = true,
  directFavoriteAction = false,
  onlyCollectionActions = false,
  excludeCollectionId,
}: UseCollectionContextMenuOptions): ContextMenuItem[] {
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";
  const copy = (pt: string, en: string) => (isEnglish ? en : pt);

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

    if (!onlyCollectionActions && onOpenAchievements && hasAvailableAchievements(game)) {
      items.push({
        label: copy("Ver conquistas", "View achievements"),
        icon: Trophy,
        onClick: () => onOpenAchievements(game),
      });
    }

    if (!onlyCollectionActions && showDirectFavoriteAction && onToggleFavorite) {
      items.push({
        label: isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
        icon: isFavorite ? HeartOff : Heart,
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

    if (!onlyCollectionActions && onRemoveGame && (isRemovableFromLibrary || (isInLibrary && steamInstallConfirmed))) {
      items.push({
        label: "Remover da biblioteca",
        icon: Trash,
        danger: true,
        onClick: () => onRemoveGame(game),
      });
    }

    // Só jogo possuído pode sumir do perfil: biblioteca, favoritos,
    // histórico ou owned Steam. Catálogo não possuído não recebe o item.
    const canHideFromProfile = Boolean(
      game.appId &&
        (isInLibrary || isFavorite || hasGameKey(hideableGameAppIds)),
    );
    if (!onlyCollectionActions && onToggleHidden && canHideFromProfile) {
      items.push({
        label: isProfileHidden
          ? copy("Mostrar no perfil", "Show on profile")
          : copy("Ocultar no perfil", "Hide from profile"),
        icon: isProfileHidden ? Eye : EyeOff,
        onClick: () => onToggleHidden(game),
      });
    }

    if (!onlyCollectionActions && onOpenInSteam && game.appId) {
      items.push({
        label: copy("Ver na loja", "View in store"),
        icon: ExternalLink,
        onClick: () => onOpenInSteam(game),
      });
    }

    return items;
  }, [
    game,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds,
    steamInstallConfirmed,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    includeFavorites,
    directFavoriteAction,
    onlyCollectionActions,
    excludeCollectionId,
    isProfileHidden,
    hideableGameAppIds,
    copy,
    onOpenGame,
    onAddGame,
    onPlayGame,
    onOpenAchievements,
    onRemoveGame,
    onToggleFavorite,
    onToggleHidden,
    onOpenInSteam,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  ]);
}

