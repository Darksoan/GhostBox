import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, Loader2, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { GhostBoxGame } from "../../data";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import {
  layeredImageStyle,
  gameCatalogueHeaderSources,
  preloadGameModalAssets,
} from "../../utils/image";
import { CatalogueListLoadingState } from "./LoadingStates";
import { useSettings } from "../../context/settings";

const CATALOGUE_ITEM_ESTIMATED_HEIGHT = 108;
const CATALOGUE_VIRTUALIZATION_THRESHOLD = 30;

interface CatalogueListItemProps {
  game: GhostBoxGame;
  isAdded: boolean;
  isAdding?: boolean;
  isRemoving?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onPreloadGame: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}

export const CatalogueListItem = memo(function CatalogueListItem({
  game,
  isAdded,
  isAdding = false,
  isRemoving = false,
  onOpenGame,
  onRemoveGame,
  onPreloadGame,
  onGameContextMenu,
}: CatalogueListItemProps) {
  const { appearance } = useSettings();
  const itemRef = useRef<HTMLElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  const rawHeaderSources = useMemo(() => gameCatalogueHeaderSources(game), [game]);
  const headerSources = useCachedImageSources(shouldLoadCover ? rawHeaderSources : []);
  const { source: coverSource, loaded: coverLoaded } =
    useLoadableImageCover(headerSources);
  const previousCoverSourceRef = useRef(coverLoaded ? coverSource : "");
  const isEnglish = appearance.language === "en";
  const maxGenreLabels = (game.tags.length ? game.tags : game.genres).slice(0, 3);
  const genreLabelsKey = maxGenreLabels.join("\u0000");
  const genresRef = useRef<HTMLDivElement | null>(null);
  const [visibleGenreCount, setVisibleGenreCount] = useState(maxGenreLabels.length);

  useEffect(() => {
    if (shouldLoadCover) return;
    const node = itemRef.current;
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

  useLayoutEffect(() => {
    setVisibleGenreCount(maxGenreLabels.length);
  }, [game.id, genreLabelsKey, maxGenreLabels.length]);

  useLayoutEffect(() => {
    const container = genresRef.current;
    if (!container || maxGenreLabels.length < 3) return;

    const measureGenres = () => {
      const firstChip = container.children.item(0) as HTMLElement | null;
      const thirdChip = container.children.item(2) as HTMLElement | null;
      if (!firstChip || !thirdChip) return;

      const containerRect = container.getBoundingClientRect();
      const thirdRect = thirdChip.getBoundingClientRect();
      const overflowsLine =
        thirdChip.offsetTop > firstChip.offsetTop ||
        thirdRect.right > containerRect.right + 0.5;

      setVisibleGenreCount(overflowsLine ? 2 : maxGenreLabels.length);
    };

    measureGenres();

    const resizeObserver = new ResizeObserver(() => {
      setVisibleGenreCount(maxGenreLabels.length);
      window.requestAnimationFrame(measureGenres);
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [genreLabelsKey, maxGenreLabels.length]);

  useEffect(() => {
    if (coverLoaded && coverSource) {
      previousCoverSourceRef.current = coverSource;
    }
  }, [coverLoaded, coverSource]);

  const displayedCoverSource = coverLoaded
    ? coverSource
    : previousCoverSourceRef.current;
  const displayedCoverSources = displayedCoverSource ? [displayedCoverSource] : [];

  return (
    <article
      ref={itemRef}
      className={`catalogue-list__item ${isAdding ? "catalogue-list__item--adding" : ""}`}
      data-catalogue-game-id={game.id}
      role="button"
      aria-busy={isAdding}
      onClick={() => onOpenGame(game)}
      onFocus={() => onPreloadGame(game)}
      onPointerEnter={() => onPreloadGame(game)}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <div
        className={`catalogue-list__cover ${displayedCoverSources.length ? "catalogue-list__cover--loaded" : ""}`}
        style={layeredImageStyle(displayedCoverSources, "")}
      />
      <div className="catalogue-list__content">
        <strong>{game.title}</strong>
        <div className="catalogue-list__genres" ref={genresRef}>
          {maxGenreLabels.slice(0, visibleGenreCount).map((tag) => (
            <span className="catalogue-list__genre-chip" key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      {isAdded && (
        <div className="catalogue-list__actions">
          <button
            type="button"
            className="catalogue-list__added-status"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveGame?.(game);
            }}
            disabled={!onRemoveGame || isRemoving}
            aria-label={
              isEnglish ? `Remove ${game.title}` : `Remover ${game.title}`
            }
          >
            {isRemoving ? (
              <Loader2
                size={20}
                className="catalogue-list__remove-spinner"
                aria-hidden="true"
              />
            ) : (
              <>
                <CircleCheck
                  className="catalogue-list__added-check"
                  size={20}
                  aria-hidden="true"
                />
                <Trash2
                  className="catalogue-list__added-trash"
                  size={20}
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </div>
      )}
    </article>
  );
});

interface CatalogueListProps {
  games: GhostBoxGame[];
  onOpenGame: (game: GhostBoxGame) => void;
  addedGameAppIds?: Set<string>;
  addingGameId?: string | null;
  removingGameId?: string | null;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onVirtualHeightChange?: (height: number) => void;
}

export function CatalogueList({
  games,
  onOpenGame,
  addedGameAppIds = new Set(),
  addingGameId = null,
  removingGameId = null,
  onRemoveGame,
  onGameContextMenu,
  scrollElementRef,
  onVirtualHeightChange,
}: CatalogueListProps) {
  const preloadTimeoutRef = useRef<number | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  const scheduleGamePreload = useCallback((game: GhostBoxGame) => {
    if (preloadTimeoutRef.current !== null) {
      window.clearTimeout(preloadTimeoutRef.current);
    }

    preloadTimeoutRef.current = window.setTimeout(() => {
      preloadTimeoutRef.current = null;
      preloadGameModalAssets(game, 0, { nativeResolve: false });
    }, 80);
  }, []);

  useLayoutEffect(() => {
    setScrollElement(scrollElementRef?.current ?? null);
  }, [scrollElementRef, games.length]);

  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current !== null) {
        window.clearTimeout(preloadTimeoutRef.current);
      }
    };
  }, []);

  const shouldVirtualize =
    Boolean(scrollElement) && games.length > CATALOGUE_VIRTUALIZATION_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: games.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => CATALOGUE_ITEM_ESTIMATED_HEIGHT,
    overscan: 4,
  });

  useEffect(() => {
    if (!shouldVirtualize || !onVirtualHeightChange) return;
    onVirtualHeightChange(virtualizer.getTotalSize());
  }, [onVirtualHeightChange, shouldVirtualize, virtualizer, games.length]);

  const renderItem = (game: GhostBoxGame) => (
    <CatalogueListItem
      game={game}
      key={game.id}
      isAdded={addedGameAppIds.has(game.appId)}
      isAdding={addingGameId === game.id}
      isRemoving={removingGameId === game.id}
      onOpenGame={onOpenGame}
      onRemoveGame={onRemoveGame}
      onPreloadGame={scheduleGamePreload}
      onGameContextMenu={onGameContextMenu}
    />
  );

  if (!shouldVirtualize) {
    return (
      <div className="catalogue-list">
        {games.map((game) => renderItem(game))}
      </div>
    );
  }

  return (
    <div
      className="catalogue-list catalogue-list--virtual"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const game = games[virtualItem.index];
        if (!game) return null;

        return (
          <div
            key={game.id}
            className="catalogue-list__virtual-row"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(game)}
          </div>
        );
      })}
    </div>
  );
}

export { CatalogueListLoadingState };
