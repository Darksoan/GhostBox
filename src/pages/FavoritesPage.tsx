import { memo, useEffect, useState } from "react";
import type { PirateGame } from "../data";
import { Clock, Trophy } from "lucide-react";
import type { UserCollection } from "../types";
import {
  useCachedImageSources,
  useLoadableImageSource,
} from "../hooks/useCachedImageSources";
import { formatCompactPlaytime } from "../utils/time";
import {
  layeredImageStyle,
  gamePortraitSources,
  preloadGameListAssets,
  preloadGameModalAssets,
} from "../utils/image";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";

interface FavoriteCardProps {
  game: PirateGame;
  onOpenGame: (game: PirateGame) => void;
  onContextMenu?: (game: PirateGame, x: number, y: number) => void;
}

export const FavoriteCard = memo(function FavoriteCard({
  game,
  onOpenGame,
  onContextMenu,
}: FavoriteCardProps) {
  const coverSources = useCachedImageSources(gamePortraitSources(game));
  const coverSource = useLoadableImageSource(coverSources);
  const achievementTotal = game.achievements.total;
  const achievementUnlocked = Math.min(
    game.achievements.unlocked,
    achievementTotal
  );
  const achievementProgress =
    achievementTotal > 0 ? (achievementUnlocked / achievementTotal) * 100 : 0;
  const playtimeInMilliseconds = game.playTimeInMilliseconds ?? game.hours * 3_600_000;

  return (
    <article
      className="favorites-grid__item"
      role="button"
      onClick={() => onOpenGame(game)}
      onFocus={() => preloadGameModalAssets(game)}
      onMouseEnter={() => preloadGameModalAssets(game)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (onContextMenu) {
          onContextMenu(game, event.clientX, event.clientY);
        }
      }}
    >
      <div
        className={`favorites-grid__cover ${coverSource ? "favorites-grid__cover--loaded" : ""}`}
        key={coverSource ?? game.id}
        style={layeredImageStyle(coverSource ? [coverSource] : [], "")}
      >
        {achievementTotal > 0 && (
          <div
            className="game-card__achievement-progress"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${formatCompactPlaytime(playtimeInMilliseconds)} jogadas`}
          >
            <div className="game-card__achievement-progress-count">
              <>
                <Trophy size={16} strokeWidth={2.35} />
                <span>
                  {achievementUnlocked} / {achievementTotal}
                </span>
              </>
              <span className="game-card__summary-metric">
                <Clock size={16} strokeWidth={2.35} />
                <span>{formatCompactPlaytime(playtimeInMilliseconds)}</span>
              </span>
            </div>
            <div
              className="game-card__achievement-progress-track"
              aria-hidden="true"
            >
              <span style={{ width: `${achievementProgress}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="favorites-grid__backdrop">
        <div className="favorites-grid__content">
          <strong>{game.title}</strong>
        </div>
      </div>
    </article>
  );
});

interface FavoritesPageProps {
  games: PirateGame[];
  onOpenGame: (game: PirateGame) => void;
  onToggleFavorite: (game: PirateGame) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  favoriteGameIds?: Set<string>;
  libraryGameAppIds?: Set<string>;
  removableGameAppIds?: Set<string>;
  playableGameAppIds?: Set<string>;
  addingGameId?: string | null;
  launchingGameId?: string | null;
  userCollections?: UserCollection[];
  onAddGame?: (game: PirateGame) => void;
  onPlayGame?: (game: PirateGame) => void;
  onRemoveGame?: (game: PirateGame) => void;
  onAddGameToCollection?: (game: PirateGame, collectionId: string) => void;
  onRemoveGameFromCollection?: (game: PirateGame, collectionId: string) => void;
}

export function FavoritesPage({
  games,
  onOpenGame,
  onToggleFavorite,
  emptyTitle = "Sem favoritos",
  emptyMessage = "Adicione jogos no catálogo para vê-los aqui.",
  favoriteGameIds = new Set(),
  libraryGameAppIds = new Set(),
  removableGameAppIds = new Set(),
  playableGameAppIds = new Set(),
  addingGameId = null,
  launchingGameId = null,
  userCollections = [],
  onAddGame,
  onPlayGame,
  onRemoveGame,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: FavoritesPageProps) {
  const [contextMenu, setContextMenu] = useState<{
    game: PirateGame;
    x: number;
    y: number;
  } | null>(null);

  const contextMenuItems = useCollectionContextMenu({
    game: contextMenu?.game ?? null,
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
    directFavoriteAction: true,
    onAddGameToCollection,
    onRemoveGameFromCollection,
  });

  useEffect(() => {
    preloadGameListAssets(games, {
      variant: "portrait",
      limit: 24,
      idle: true,
      details: true,
      detailsLimit: 8,
    });
  }, [games]);

  if (!games.length) {
    return (
      <section className="favorites-page content-section content-section--full favorites-page--empty">
        <div className="empty-state">
          <div>
            <h3>{emptyTitle}</h3>
            <p>{emptyMessage}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="favorites-page content-section content-section--full">
      <div className="favorites-grid">
        {games.map((game) => (
          <FavoriteCard
            key={game.id}
            game={game}
            onOpenGame={onOpenGame}
            onContextMenu={(game, x, y) => setContextMenu({ game, x, y })}
          />
        ))}
      </div>
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
