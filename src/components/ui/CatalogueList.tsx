import { CircleCheck, Loader2, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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

interface CatalogueListItemProps {
  game: GhostBoxGame;
  isAdded: boolean;
  isAdding?: boolean;
  isRemoving?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onHoverGame: (game: GhostBoxGame | null) => void;
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
  onHoverGame,
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
  const lastGenresWidthRef = useRef<number | null>(null);
  const [genreDisplay, setGenreDisplay] = useState(() => ({
    count: maxGenreLabels.length,
    key: genreLabelsKey,
    measured: maxGenreLabels.length < 3,
  }));
  const genresMeasured =
    genreDisplay.key === genreLabelsKey && genreDisplay.measured;
  const visibleGenreCount =
    genreDisplay.key === genreLabelsKey
      ? genreDisplay.count
      : maxGenreLabels.length;
  const renderedGenreLabels = genresMeasured
    ? maxGenreLabels.slice(0, visibleGenreCount)
    : maxGenreLabels;

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
    const container = genresRef.current;
    if (!container) return;

    if (maxGenreLabels.length < 3) {
      lastGenresWidthRef.current = null;
      if (!genresMeasured || visibleGenreCount !== maxGenreLabels.length) {
        setGenreDisplay({
          count: maxGenreLabels.length,
          key: genreLabelsKey,
          measured: true,
        });
      }
      return;
    }

    const measureGenres = () => {
      const firstChip = container.children.item(0) as HTMLElement | null;
      const thirdChip = container.children.item(2) as HTMLElement | null;
      if (!firstChip || !thirdChip) return;

      const containerRect = container.getBoundingClientRect();
      const thirdRect = thirdChip.getBoundingClientRect();
      lastGenresWidthRef.current = containerRect.width;
      const overflowsLine =
        thirdChip.offsetTop > firstChip.offsetTop ||
        thirdRect.right > containerRect.right + 0.5;

      setGenreDisplay({
        count: overflowsLine ? 2 : maxGenreLabels.length,
        key: genreLabelsKey,
        measured: true,
      });
    };

    if (!genresMeasured) measureGenres();

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? container.getBoundingClientRect().width;
      const previousWidth = lastGenresWidthRef.current;
      if (previousWidth !== null && Math.abs(nextWidth - previousWidth) <= 0.5) {
        return;
      }

      lastGenresWidthRef.current = nextWidth;
      setGenreDisplay({
        count: maxGenreLabels.length,
        key: genreLabelsKey,
        measured: false,
      });
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [genreLabelsKey, genresMeasured, maxGenreLabels.length, visibleGenreCount]);

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
      onFocus={() => {
        onPreloadGame(game);
        onHoverGame(game);
      }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
          onHoverGame(null);
        }
      }}
      onPointerEnter={() => {
        onPreloadGame(game);
        onHoverGame(game);
      }}
      onPointerLeave={() => onHoverGame(null)}
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
          className="catalogue-list__genres"
          ref={genresRef}
          style={{ visibility: genresMeasured ? "visible" : "hidden" }}
        >
          {/* index no key: o backend pode repetir tags e a colisão quebra a lista */}
          {renderedGenreLabels.map((tag, index) => (
            <span className="catalogue-list__genre-chip" key={`${tag}-${index}`}>
              {tag}
            </span>
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
  onHoverGame: (game: GhostBoxGame | null) => void;
  addedGameAppIds?: Set<string>;
  addingGameId?: string | null;
  removingGameId?: string | null;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}

export function CatalogueList({
  games,
  onOpenGame,
  onHoverGame,
  addedGameAppIds = new Set(),
  addingGameId = null,
  removingGameId = null,
  onRemoveGame,
  onGameContextMenu,
}: CatalogueListProps) {
  const preloadTimeoutRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scheduleGamePreload = useCallback((game: GhostBoxGame) => {
    if (preloadTimeoutRef.current !== null) {
      window.clearTimeout(preloadTimeoutRef.current);
    }

    preloadTimeoutRef.current = window.setTimeout(() => {
      preloadTimeoutRef.current = null;
      preloadGameModalAssets(game, 0, { nativeResolve: false });
    }, 80);
  }, []);

  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current !== null) {
        window.clearTimeout(preloadTimeoutRef.current);
      }
    };
  }, []);

  // Sem virtualização de propósito: a página do catálogo entrega no máximo
  // `cataloguePageSize` (20) itens, e o gate de `IntersectionObserver` por linha
  // já evita carregar as capas fora da viewport.
  return (
    <div className="catalogue-list" ref={listRef}>
      {games.map((game) => (
        <CatalogueListItem
          game={game}
          key={game.id}
          isAdded={addedGameAppIds.has(game.appId)}
          isAdding={addingGameId === game.id}
          isRemoving={removingGameId === game.id}
          onOpenGame={onOpenGame}
          onHoverGame={onHoverGame}
          onRemoveGame={onRemoveGame}
          onPreloadGame={scheduleGamePreload}
          onGameContextMenu={onGameContextMenu}
        />
      ))}
    </div>
  );
}

export { CatalogueListLoadingState };
