import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame } from "../data";
import { Clock, Lock } from "lucide-react";
import { Cup } from "reicon-react";
import {
  useCachedImageSources,
  useLoadableImageSource,
} from "../hooks/useCachedImageSources";
import { formatCompactPlaytime } from "../utils/time";
import {
  layeredImageStyle,
  gamePortraitPreviewSources,
  preloadGameListAssets,
  preloadGameModalAssets,
} from "../utils/image";
import { ContextMenu } from "../components/ui/ContextMenu";
import { EmptyState } from "../components/ui/LoadingStates";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useFlipLayout } from "../hooks/useFlipLayout";
import { useMetricsUnlocked } from "../context/MetricsVisibilityContext";
import { useSettings } from "../context/settings";

interface FavoriteCardProps {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}

export const FavoriteCard = memo(function FavoriteCard({
  game,
  onOpenGame,
  onContextMenu,
}: FavoriteCardProps) {
  const { t } = useSettings();
  const areMetricsUnlocked = useMetricsUnlocked();
  const cardRef = useRef<HTMLElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  const rawCoverSources = useMemo(() => gamePortraitPreviewSources(game), [game]);
  const coverSources = useCachedImageSources(shouldLoadCover ? rawCoverSources : []);
  const coverSource = useLoadableImageSource(coverSources);
  const achievementTotal = game.achievements.total;
  const achievementUnlocked = Math.min(
    game.achievements.unlocked,
    achievementTotal
  );
  const achievementProgress =
    achievementTotal > 0 ? (achievementUnlocked / achievementTotal) * 100 : 0;
  const playtimeInMilliseconds = game.playTimeInMilliseconds ?? game.hours * 3_600_000;

  useEffect(() => {
    if (shouldLoadCover) return;
    const node = cardRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoadCover(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadCover(true);
          observer.disconnect();
        }
      },
      { rootMargin: "420px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoadCover]);

  return (
    <article
      ref={cardRef}
      data-layout-id={game.id}
      className="favorites-grid__item"
      role="button"
      onClick={() => onOpenGame(game)}
      onFocus={() => preloadGameModalAssets(game, 0, { nativeResolve: false })}
      onMouseEnter={() => preloadGameModalAssets(game, 0, { nativeResolve: false })}
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
        {!areMetricsUnlocked ? (
          <div
            className="game-card__achievement-progress game-card__achievement-progress--locked"
            aria-label={t("metrics.lockedAria")}
          >
            <div className="game-card__achievement-progress-count">
              <Lock size={14} strokeWidth={2.0} aria-hidden="true" />
              <span>{t("metrics.locked")}</span>
            </div>
          </div>
        ) : (
          achievementTotal > 0 && (
            <div
              className="game-card__achievement-progress"
              aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${formatCompactPlaytime(playtimeInMilliseconds)} jogadas`}
            >
              <div className="game-card__achievement-progress-count">
                <>
                  <Cup size={16} weight="Filled" strokeWidth={2.0} />
                  <span>
                    {achievementUnlocked} / {achievementTotal}
                  </span>
                </>
                <span className="game-card__summary-metric">
                  <Clock size={16} strokeWidth={2.0} />
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
          )
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
  games: GhostBoxGame[];
  onOpenGame: (game: GhostBoxGame) => void;
  emptyTitle?: string;
  isActive?: boolean;
}

export function FavoritesPage({
  games,
  onOpenGame,
  emptyTitle = "Sem favoritos",
  isActive = true,
}: FavoritesPageProps) {
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
  } | null>(null);
  const layoutKey = games.map((game) => game.id).join("|");
  const gridRef = useFlipLayout<HTMLDivElement>(layoutKey, isActive);

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

    preloadGameListAssets(games, {
      variant: "portrait",
      limit: 12,
      idle: true,
      details: true,
      detailsLimit: 8,
    });
  }, [games, isActive]);

  if (!games.length) {
    return (
      <section className="favorites-page content-section content-section--full favorites-page--empty">
        <EmptyState title={emptyTitle} />
      </section>
    );
  }

  return (
    <section className="favorites-page content-section content-section--full">
      <div className="favorites-grid" ref={gridRef}>
        {games.map((game) => (
          <FavoriteCard
            key={game.id}
            game={game}
            onOpenGame={onOpenGame}
            onContextMenu={handleGameContextMenu}
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
