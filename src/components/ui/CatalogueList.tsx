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

// Espera a largura assentar antes de remedir os chips de gênero. Casado com o
// tempo de assentamento de `utils/viewportResize`: o arrasto termina, o layout
// para, e só então uma medição acontece.
const genresRemeasureDelayMs = 140;

interface CatalogueListItemProps {
  game: GhostBoxGame;
  isAdded: boolean;
  isAdding?: boolean;
  isRemoving?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onHoverGame: (
    game: GhostBoxGame | null,
    options?: {
      immediate?: boolean;
      anchor?: HTMLElement | null;
      pointer?: { x: number; y: number } | null;
      settled?: boolean;
    }
  ) => void;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onPreloadGame: (game: GhostBoxGame) => void;
  onHoverEnter: (
    game: GhostBoxGame,
    anchor: HTMLElement | null,
    x: number,
    y: number
  ) => void;
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
  onHoverEnter,
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

    // Remedir custa um ciclo "mostra os 3 chips → mede → volta pra 2". Num
    // arrasto de janela o observer dispara a cada frame, e esse ciclo vira
    // piscada contínua. O timer segura a remedição até a largura parar de
    // mudar: durante o arrasto os chips ficam como estão e o ajuste acontece
    // uma vez só, no fim.
    let remeasureTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? container.getBoundingClientRect().width;
      const previousWidth = lastGenresWidthRef.current;
      if (previousWidth !== null && Math.abs(nextWidth - previousWidth) <= 0.5) {
        return;
      }

      lastGenresWidthRef.current = nextWidth;
      if (remeasureTimeoutId !== null) clearTimeout(remeasureTimeoutId);
      remeasureTimeoutId = setTimeout(() => {
        remeasureTimeoutId = null;
        setGenreDisplay({
          count: maxGenreLabels.length,
          key: genreLabelsKey,
          measured: false,
        });
      }, genresRemeasureDelayMs);
    });
    resizeObserver.observe(container);

    return () => {
      if (remeasureTimeoutId !== null) clearTimeout(remeasureTimeoutId);
      resizeObserver.disconnect();
    };
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
      aria-busy={isAdding || isRemoving}
      onContextMenu={(event) => {
        if (!onGameContextMenu) return;
        event.preventDefault();
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="catalogue-list__main"
        aria-label={game.title}
        onClick={() => onOpenGame(game)}
        onFocus={() => {
          onPreloadGame(game);
          onHoverGame(game, { immediate: true, anchor: itemRef.current });
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
            onHoverGame(null);
          }
        }}
        onPointerEnter={(event) =>
          onHoverEnter(game, itemRef.current, event.clientX, event.clientY)
        }
        onPointerLeave={() => onHoverGame(null)}
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
            {renderedGenreLabels.map((tag, index) => (
              <span className="catalogue-list__genre-chip" key={`${tag}-${index}`}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </button>
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
            aria-busy={isRemoving}
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
  viewMode?: "list" | "grid";
  onOpenGame: (game: GhostBoxGame) => void;
  onHoverGame: (
    game: GhostBoxGame | null,
    options?: {
      immediate?: boolean;
      anchor?: HTMLElement | null;
      pointer?: { x: number; y: number } | null;
      settled?: boolean;
    }
  ) => void;
  addedGameAppIds?: Set<string>;
  addingGameId?: string | null;
  removingGameId?: string | null;
  onRemoveGame?: (game: GhostBoxGame) => void;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
}

export function CatalogueList({
  games,
  viewMode = "list",
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
  // Última posição em que o cursor foi visto de fato se mexendo.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

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

  const handleHoverEnter = useCallback(
    (
      game: GhostBoxGame,
      anchor: HTMLElement | null,
      x: number,
      y: number
    ) => {
      const previous = lastPointerRef.current;
      lastPointerRef.current = { x, y };
      // Cursor no mesmo pixel de antes com outro cartão embaixo: quem se moveu
      // foi o conteúdo (troca de aba, lista assentando), não o usuário. Preload
      // sai fora e o preview espera a poeira baixar — senão cada cartão que
      // desliza sob o cursor vira uma rodada de requisições.
      const movedByLayout = previous?.x === x && previous?.y === y;

      if (!movedByLayout) scheduleGamePreload(game);
      onHoverGame(game, {
        anchor,
        pointer: { x, y },
        settled: !movedByLayout,
      });
    },
    [onHoverGame, scheduleGamePreload]
  );

  // Sem virtualização de propósito: a página do catálogo entrega no máximo
  // `cataloguePageSize` (20) itens, e o gate de `IntersectionObserver` por linha
  // já evita carregar as capas fora da viewport.
  return (
    <div
      className={`catalogue-list ${viewMode === "grid" ? "catalogue-list--grid" : ""}`}
      ref={listRef}
      onPointerMove={(event) => {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      }}
    >
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
          onHoverEnter={handleHoverEnter}
          onGameContextMenu={onGameContextMenu}
        />
      ))}
    </div>
  );
}

export { CatalogueListLoadingState };
