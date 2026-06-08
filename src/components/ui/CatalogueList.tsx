import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, FolderPlus, Loader2, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PirateGame } from "../../data";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import {
  layeredImageStyle,
  gameCatalogueHeaderSources,
  preloadGameModalAssets,
} from "../../utils/image";
import { CatalogueListLoadingState } from "./LoadingStates";
import { useSettings } from "../../context/settings";
import type { UserCollection } from "../../types";

const CATALOGUE_ITEM_ESTIMATED_HEIGHT = 108;
const CATALOGUE_VIRTUALIZATION_THRESHOLD = 30;

interface CatalogueListItemProps {
  game: PirateGame;
  isAdded: boolean;
  canAddToCollection: boolean;
  isAdding?: boolean;
  isRemoving?: boolean;
  onOpenGame: (game: PirateGame) => void;
  onRemoveGame?: (game: PirateGame) => void;
  onPreloadGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
  onCollectionContextMenu?: (game: PirateGame, x: number, y: number) => void;
}

export const CatalogueListItem = memo(function CatalogueListItem({
  game,
  isAdded,
  canAddToCollection,
  isAdding = false,
  isRemoving = false,
  onOpenGame,
  onRemoveGame,
  onPreloadGame,
  onGameContextMenu,
  onCollectionContextMenu,
}: CatalogueListItemProps) {
  const { appearance } = useSettings();
  const headerSources = useCachedImageSources(gameCatalogueHeaderSources(game));
  const { source: coverSource, loaded: coverLoaded } =
    useLoadableImageCover(headerSources);
  const previousCoverSourceRef = useRef(coverLoaded ? coverSource : "");
  const isEnglish = appearance.language === "en";
  const genresRef = useRef<HTMLDivElement>(null);
  const [showGenreFade, setShowGenreFade] = useState(false);
  const genreLabels = game.tags.length ? game.tags : game.genres;

  useEffect(() => {
    if (coverLoaded && coverSource) {
      previousCoverSourceRef.current = coverSource;
    }
  }, [coverLoaded, coverSource]);

  const displayedCoverSource = coverLoaded
    ? coverSource
    : previousCoverSourceRef.current;
  const displayedCoverSources = displayedCoverSource ? [displayedCoverSource] : [];

  const updateGenreFade = useCallback(() => {
    const node = genresRef.current;
    if (!node) {
      setShowGenreFade(false);
      return;
    }

    setShowGenreFade(node.scrollWidth > node.clientWidth + 1);
  }, []);

  useEffect(() => {
    updateGenreFade();
  }, [genreLabels, updateGenreFade]);

  useEffect(() => {
    const node = genresRef.current;
    if (!node) return;

    const resizeObserver = new ResizeObserver(updateGenreFade);
    resizeObserver.observe(node);
    window.addEventListener("resize", updateGenreFade);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateGenreFade);
    };
  }, [updateGenreFade]);

  return (
    <article
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
        <div
          ref={genresRef}
          className={`catalogue-list__genres${showGenreFade ? " catalogue-list__genres--fade" : ""}`}
        >
          {genreLabels.slice(0, 4).map((tag) => (
            <span className="catalogue-list__genre-chip" key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      {(canAddToCollection || isAdded) && (
        <div className="catalogue-list__actions">
          {canAddToCollection && onCollectionContextMenu && (
            <button
              type="button"
              className="catalogue-list__collection-button"
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onCollectionContextMenu(game, rect.right, rect.bottom);
              }}
              aria-label={
                isEnglish
                  ? `Add ${game.title} to collection`
                  : `Adicionar ${game.title} à coleção`
              }
            >
              <FolderPlus size={20} stroke="currentColor" />
            </button>
          )}
          {isAdded && (
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
          )}
        </div>
      )}
    </article>
  );
});

interface CatalogueListProps {
  games: PirateGame[];
  onOpenGame: (game: PirateGame) => void;
  userCollections?: UserCollection[];
  addedGameAppIds?: Set<string>;
  addingGameId?: string | null;
  removingGameId?: string | null;
  onRemoveGame?: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
  onCollectionContextMenu?: (game: PirateGame, x: number, y: number) => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
  onVirtualHeightChange?: (height: number) => void;
}

export function CatalogueList({
  games,
  onOpenGame,
  userCollections = [],
  addedGameAppIds = new Set(),
  addingGameId = null,
  removingGameId = null,
  onRemoveGame,
  onGameContextMenu,
  onCollectionContextMenu,
  scrollElementRef,
  onVirtualHeightChange,
}: CatalogueListProps) {
  const preloadTimeoutRef = useRef<number | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  const scheduleGamePreload = useCallback((game: PirateGame) => {
    if (preloadTimeoutRef.current !== null) {
      window.clearTimeout(preloadTimeoutRef.current);
    }

    preloadTimeoutRef.current = window.setTimeout(() => {
      preloadTimeoutRef.current = null;
      preloadGameModalAssets(game);
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

  const renderItem = (game: PirateGame) => (
    <CatalogueListItem
      game={game}
      key={game.id}
      isAdded={addedGameAppIds.has(game.appId)}
      canAddToCollection={userCollections.some(
        (collection) => !collection.gameIds.includes(game.id)
      )}
      isAdding={addingGameId === game.id}
      isRemoving={removingGameId === game.id}
      onOpenGame={onOpenGame}
      onRemoveGame={onRemoveGame}
      onPreloadGame={scheduleGamePreload}
      onGameContextMenu={onGameContextMenu}
      onCollectionContextMenu={onCollectionContextMenu}
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
