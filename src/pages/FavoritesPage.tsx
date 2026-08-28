import { useCallback, useEffect, useState } from "react";
import type { GhostBoxGame } from "../data";
import { GameGrid } from "../components/ui/GameCard";
import { ContextMenu } from "../components/ui/ContextMenu";
import { EmptyState } from "../components/ui/LoadingStates";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useEnrichedGameCards } from "../hooks/useEnrichedGameCards";
import { preloadGameListAssets } from "../utils/image";

interface FavoritesPageProps {
  games: GhostBoxGame[];
  onOpenGame: (game: GhostBoxGame) => void;
  emptyTitle?: string;
  isActive?: boolean;
  activeSessionAppIds?: Set<string>;
}

export function FavoritesPage({
  games,
  onOpenGame,
  emptyTitle = "Sem favoritos",
  isActive = true,
  activeSessionAppIds = new Set(),
}: FavoritesPageProps) {
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);

  // A aba de coleção é a mesma superfície da biblioteca: as capas, o fade e o
  // hover vêm de `.content-section--library .game-grid--portrait`, então a
  // seção precisa carregar essas classes e o mesmo `GameGrid`.
  const collectionGames = useEnrichedGameCards(games, 80, isActive);

  const contextMenuItems = useGameContextMenu({
    game: contextMenu?.game ?? null,
    onOpenGame,
    directFavoriteAction: true,
  });

  const handleGameContextMenu = useCallback(
    (game: GhostBoxGame, x: number, y: number) => setContextMenu({ game, x, y }),
    [],
  );

  useEffect(() => {
    if (!isActive) return;

    preloadGameListAssets(collectionGames, {
      variant: "portrait",
      limit: 12,
      idle: true,
      details: true,
      detailsLimit: 8,
    });
  }, [collectionGames, isActive]);

  if (!collectionGames.length) {
    return (
      <section className="favorites-page content-section content-section--full favorites-page--empty">
        <EmptyState title={emptyTitle} />
      </section>
    );
  }

  return (
    <section className="content-section content-section--full content-section--library">
      <GameGrid
        games={collectionGames}
        onOpenGame={onOpenGame}
        onGameContextMenu={handleGameContextMenu}
        dense
        portrait
        showAchievements
        activeSessionAppIds={activeSessionAppIds}
        libraryCoverFade
        animateLayout
      />
      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}
