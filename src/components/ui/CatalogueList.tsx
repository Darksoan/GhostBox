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

// Teto só do passo de medição: nele todas as pills candidatas ficam no DOM ao
// mesmo tempo, em 20 cards. Nem a linha mais larga do card chega perto disso —
// quem corta é a medição, não este número.
const maxMeasuredGenreLabels = 16;

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
  // Sem teto fixo de rótulos: a medição abaixo decide quantas pills cabem na
  // linha do card, em vez de cortar em 3 e depois derrubar para 2.
  const maxGenreLabels = useMemo(
    () =>
      (game.tags.length ? game.tags : game.genres).slice(
        0,
        maxMeasuredGenreLabels
      ),
    [game.genres, game.tags]
  );
  const genreLabelsKey = maxGenreLabels.join("\u0000");
  const genresRef = useRef<HTMLDivElement | null>(null);
  const genresMeasureRef = useRef<HTMLDivElement | null>(null);
  const lastGenresWidthRef = useRef<number | null>(null);
  // A linha visível nunca renderiza mais pills do que cabe: a contagem sai da
  // linha-espelho fora do fluxo. Antes o card pintava todas e recolhia depois
  // de medir — era esse recolhimento que aparecia na tela.
  const [genreDisplay, setGenreDisplay] = useState(() => ({
    count: maxGenreLabels.length <= 1 ? maxGenreLabels.length : 0,
    key: genreLabelsKey,
  }));
  const visibleGenreCount =
    genreDisplay.key === genreLabelsKey ? genreDisplay.count : 0;
  const renderedGenreLabels = maxGenreLabels.slice(0, visibleGenreCount);

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
    const measureRow = genresMeasureRef.current;
    if (!container || !measureRow) return;

    if (maxGenreLabels.length <= 1) {
      lastGenresWidthRef.current = null;
      setGenreDisplay((current) =>
        current.key === genreLabelsKey && current.count === maxGenreLabels.length
          ? current
          : { count: maxGenreLabels.length, key: genreLabelsKey }
      );
      return;
    }

    // Conta na linha-espelho (todas as pills, fora do fluxo e invisível) quantas
    // fecham dentro da largura do card e corta na primeira que vaza. A linha
    // visível não participa da medição, então nenhuma pill chega a ser pintada
    // para depois sumir.
    const measureGenres = () => {
      const containerRect = container.getBoundingClientRect();
      if (!containerRect.width) return;
      lastGenresWidthRef.current = containerRect.width;

      let fittingCount = 0;
      for (const chip of Array.from(measureRow.children) as HTMLElement[]) {
        if (chip.getBoundingClientRect().right > containerRect.right + 0.5) break;
        fittingCount += 1;
      }

      // Pelo menos uma: card estreito demais ainda mostra o rótulo principal em
      // vez de uma linha vazia.
      const nextCount = Math.max(1, fittingCount);
      setGenreDisplay((current) =>
        current.key === genreLabelsKey && current.count === nextCount
          ? current
          : { count: nextCount, key: genreLabelsKey }
      );
    };

    measureGenres();

    // Num arrasto de janela o observer dispara a cada frame. O timer segura a
    // remedição até a largura parar de mudar — o ajuste acontece uma vez só, no
    // fim, em vez de a cada frame.
    let remeasureTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? container.getBoundingClientRect().width;
      const previousWidth = lastGenresWidthRef.current;
      if (previousWidth !== null && Math.abs(nextWidth - previousWidth) <= 0.5) {
        return;
      }

      // Primeira largura real do card (item fora da viewport não tem layout até
      // entrar nela): mede na hora, senão a linha ficaria vazia pelo tempo do
      // timer justo quando o card aparece.
      if (previousWidth === null) {
        measureGenres();
        return;
      }

      lastGenresWidthRef.current = nextWidth;
      if (remeasureTimeoutId !== null) clearTimeout(remeasureTimeoutId);
      remeasureTimeoutId = setTimeout(() => {
        remeasureTimeoutId = null;
        measureGenres();
      }, genresRemeasureDelayMs);
    });
    resizeObserver.observe(container);

    return () => {
      if (remeasureTimeoutId !== null) clearTimeout(remeasureTimeoutId);
      resizeObserver.disconnect();
    };
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
          <div className="catalogue-list__genres" ref={genresRef}>
            {renderedGenreLabels.map((tag, index) => (
              <span className="catalogue-list__genre-chip" key={`${tag}-${index}`}>
                {tag}
              </span>
            ))}
            {/* Linha-espelho: mesmas pills, fora do fluxo e invisível. Só ela
                é medida — a linha de cima já nasce com a contagem certa. */}
            <div
              className="catalogue-list__genres-measure"
              ref={genresMeasureRef}
              aria-hidden="true"
            >
              {maxGenreLabels.map((tag, index) => (
                <span
                  className="catalogue-list__genre-chip"
                  key={`measure-${tag}-${index}`}
                >
                  {tag}
                </span>
              ))}
            </div>
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
