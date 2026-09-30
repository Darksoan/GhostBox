import { CircleCheck, Flame, Loader2, Trash2 } from "lucide-react";
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
import { gameCatalogueHeaderSources } from "../../utils/image";
import {
  cacheImageSourceAfterLoad,
  forgetCachedImageSource,
  markImageSourceLoaded,
  resolveSteamHeaderSource,
  withCachedImageSources,
} from "../../utils/imageCache";
import { getSteamReviewScore } from "../../utils/gameMetrics";
import { CatalogueListLoadingState } from "./LoadingStates";
import { useSettings } from "../../context/settings";
import { useWindowMaximized } from "../../hooks/useWindowMaximized";

// Espera a largura assentar antes de remedir os chips de gênero. Casado com o
// tempo de assentamento de `utils/viewportResize`: o arrasto termina, o layout
// para, e só então uma medição acontece.
const genresRemeasureDelayMs = 140;

// Teto só do passo de medição: nele todas as pills candidatas ficam no DOM ao
// mesmo tempo, em 20 cards. Nem a linha mais larga do card chega perto disso —
// quem corta é a medição, não este número.
const maxMeasuredGenreLabels = 16;

/**
 * Imagem crua do catálogo. O source escolhido fica congelado durante esta
 * montagem: um miss pinta o `header.jpg` remoto e só depois grava seus bytes
 * originais em segundo plano. Assim o primeiro paint nunca troca de bitmap;
 * na próxima montagem/abertura, o mesmo arquivo vem direto do disco.
 */
const CatalogueHeaderImage = memo(function CatalogueHeaderImage({
  game,
}: {
  game: GhostBoxGame;
}) {
  const rawSources = useMemo(() => gameCatalogueHeaderSources(game), [game]);
  const sourceKey = rawSources.join("\n");
  const sources = useMemo(
    () =>
      withCachedImageSources(rawSources, {
        requestManifests: false,
        preserveSourceOrder: true,
        prioritizeCached: true,
      }),
    // `sourceKey` muda junto com o conteúdo; o mapa de cache pode mudar em
    // segundo plano sem alterar este snapshot nem recarregar a imagem visível.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceKey]
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [resolvedFallbackSource, setResolvedFallbackSource] = useState("");
  const fallbackRequestRef = useRef(0);
  // Enquanto o source atual não confirma `onLoad`, o img fica invisível e só
  // o placeholder da capa (fundo skeleton com aspect-ratio) aparece — sem
  // isso o WebView pinta o ícone de imagem quebrada entre o `src` e o
  // `onError` que troca para o próximo fallback.
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    fallbackRequestRef.current += 1;
    setSourceIndex(0);
    setResolvedFallbackSource("");
    setIsLoaded(false);

    return () => {
      fallbackRequestRef.current += 1;
    };
  }, [sourceKey]);

  const source = sources[sourceIndex] ?? resolvedFallbackSource;

  // Cada troca de fallback (source novo no mesmo `img`) volta a esconder até
  // o próximo `onLoad`, para o ícone quebrado nunca pintar num frame.
  useEffect(() => {
    setIsLoaded(false);
  }, [source]);

  if (!source) return null;

  return (
    <img
      className="catalogue-card__cover-image"
      src={source}
      width={460}
      height={215}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      aria-hidden="true"
      style={isLoaded ? undefined : { opacity: 0 }}
      onLoad={() => {
        setIsLoaded(true);
        markImageSourceLoaded(source);
        if (!/^https?:\/\//i.test(source)) return;

        // O download para o cache começa depois que a imagem visível terminou
        // de carregar. A fila compartilhada agrupa os cards e o backend limita
        // a concorrência, sem disputar o primeiro paint do catálogo.
        cacheImageSourceAfterLoad(source);
      }}
      onError={() => {
        forgetCachedImageSource(source);
        if (source === resolvedFallbackSource) {
          setResolvedFallbackSource("");
          return;
        }

        const nextIndex = sourceIndex + 1;
        if (nextIndex < sources.length) {
          setSourceIndex(nextIndex);
          return;
        }

        // Jogos migrados para `store_item_assets` podem publicar somente a
        // URL com hash. Resolver apenas depois dos fallbacks preserva o source
        // do primeiro paint e evita trocar uma capa que já carregou.
        setSourceIndex(sources.length);
        const requestId = ++fallbackRequestRef.current;
        void resolveSteamHeaderSource(game.appId).then((resolvedSource) => {
          if (
            requestId === fallbackRequestRef.current &&
            resolvedSource &&
            !sources.includes(resolvedSource)
          ) {
            setResolvedFallbackSource(resolvedSource);
          }
        });
      }}
    />
  );
});

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
  onHoverEnter,
  onGameContextMenu,
}: CatalogueListItemProps) {
  const { appearance } = useSettings();
  const isWindowMaximized = useWindowMaximized();
  const itemRef = useRef<HTMLElement | null>(null);
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
  const genresRef = useRef<HTMLSpanElement | null>(null);
  const genresMeasureRef = useRef<HTMLSpanElement | null>(null);
  const lastGenresWidthRef = useRef<number | null>(null);
  // A linha visível nunca renderiza mais pills do que cabe: a contagem sai da
  // linha-espelho fora do fluxo. Antes o card pintava todas e recolhia depois
  // de medir — era esse recolhimento que aparecia na tela.
  const [genreDisplay, setGenreDisplay] = useState(() => ({
    count: maxGenreLabels.length <= 1 ? maxGenreLabels.length : 1,
    key: genreLabelsKey,
  }));
  const visibleGenreCount =
    genreDisplay.key === genreLabelsKey ? genreDisplay.count : Math.min(maxGenreLabels.length, 1);
  const renderedGenreLabels = maxGenreLabels.slice(0, visibleGenreCount);

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
      // Maximizado: até 5 pills para não virar tapete de chips no card mais largo
      const cappedCount = isWindowMaximized ? Math.min(fittingCount, 5) : fittingCount;
      const nextCount = Math.max(1, cappedCount);
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
  }, [genreLabelsKey, isWindowMaximized, maxGenreLabels.length]);


  return (
    <article
      ref={itemRef}
      className={`catalogue-card catalogue-card--list${isAdding ? " catalogue-card--adding" : ""}`}
      data-catalogue-game-id={game.id}
      aria-busy={isAdding || isRemoving}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!onGameContextMenu) return;
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="catalogue-card__button catalogue-card__button--list"
        aria-label={game.title}
        onClick={() => onOpenGame(game)}
        onFocus={() => {
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
        onPointerLeave={() => {
          onHoverGame(null);
        }}
      >
        <span className="catalogue-card__cover" aria-hidden="true">
          <CatalogueHeaderImage game={game} />
        </span>
        <span className="catalogue-card__list-content">
          <strong>{game.title}</strong>
          <span className="catalogue-card__genres" ref={genresRef}>
            {renderedGenreLabels.map((tag, index) => (
              <span className="catalogue-card__genre-chip" key={`${tag}-${index}`}>
                {tag}
              </span>
            ))}
            {/* Linha-espelho: mesmas pills, fora do fluxo e invisível. Só ela
                é medida — a linha de cima já nasce com a contagem certa. */}
            <span
              className="catalogue-card__genres-measure"
              ref={genresMeasureRef}
              aria-hidden="true"
            >
              {maxGenreLabels.map((tag, index) => (
                <span
                  className="catalogue-card__genre-chip"
                  key={`measure-${tag}-${index}`}
                >
                  {tag}
                </span>
              ))}
            </span>
          </span>
        </span>
      </button>
      {isAdded && (
        <div className="catalogue-card__actions">
          <button
            type="button"
            className="catalogue-card__added-status"
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
                className="catalogue-card__remove-spinner"
                aria-hidden="true"
              />
            ) : (
              <>
                <CircleCheck
                  className="catalogue-card__added-check"
                  size={20}
                  aria-hidden="true"
                />
                <Trash2
                  className="catalogue-card__added-trash"
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

const CatalogueGridCard = memo(function CatalogueGridCard({
  game,
  isAdded,
  isAdding = false,
  isRemoving = false,
  onOpenGame,
  onHoverGame,
  onHoverEnter,
  onGameContextMenu,
}: CatalogueListItemProps) {
  const { appearance } = useSettings();
  const isEnglish = appearance.language === "en";
  const cardRef = useRef<HTMLElement | null>(null);
  // Mesma guarda do preview do catálogo (`getSteamReviewScore`): sem amostra
  // de review, a razão volta 0 e viraria uma nota 0,0 falsa.
  const reviewScore = getSteamReviewScore(game);
  const ratingText = reviewScore
    ? ((reviewScore.percent / 100) * 5).toFixed(1)
    : null;
  return (
    <article
      ref={cardRef}
      className={`catalogue-card catalogue-card--grid${isAdding ? " catalogue-card--adding" : ""}`}
      data-catalogue-game-id={game.id}
      aria-busy={isAdding || isRemoving}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!onGameContextMenu) return;
        onGameContextMenu(game, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="catalogue-card__button catalogue-card__button--grid"
        aria-label={game.title}
        onClick={() => onOpenGame(game)}
        onFocus={() => {
          onHoverGame(game, { immediate: true, anchor: cardRef.current });
        }}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
            onHoverGame(null);
          }
        }}
        onPointerEnter={(event) =>
          onHoverEnter(game, cardRef.current, event.clientX, event.clientY)
        }
        onPointerLeave={() => {
          onHoverGame(null);
        }}
      >
        <span className="catalogue-card__cover" aria-hidden="true">
          <CatalogueHeaderImage game={game} />
        </span>
          <span className="catalogue-card__grid-body">
            <span className="catalogue-card__title-row">
              <span className="catalogue-card__title">
                {game.title}
                {isAdded && (
                  <span className="catalogue-card__library-status">
                    {isEnglish
                      ? " is already in your library."
                      : " está na sua biblioteca."}
                  </span>
                )}
              </span>
            {ratingText ? (
              <span className="catalogue-card__rating" aria-label={ratingText}>
                <Flame
                  size={16}
                  fill="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span>{ratingText}</span>
              </span>
              ) : null}
          </span>
        </span>
      </button>
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
  const listRef = useRef<HTMLDivElement>(null);
  // Última posição em que o cursor foi visto de fato se mexendo.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

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
      // foi o conteúdo (troca de aba, lista assentando), não o usuário.
      const movedByLayout = previous?.x === x && previous?.y === y;

      onHoverGame(game, {
        anchor,
        pointer: { x, y },
        settled: !movedByLayout,
      });
    },
    [onHoverGame]
  );

  // Sem virtualização de propósito: a página do catálogo entrega no máximo
  // `cataloguePageSize` (21) itens. As capas usam `<img>` nativo e são deixadas
  // inteiramente a cargo do carregador do WebView.
  const isGrid = viewMode === "grid";
  return (
    <div
      className={`catalogue-list ${isGrid ? "catalogue-list--cards" : ""}`}
      ref={listRef}
      onPointerMove={(event) => {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      }}
    >
      {games.map((game) =>
        isGrid ? (
          <CatalogueGridCard
            game={game}
            key={game.id}
            isAdded={addedGameAppIds.has(game.appId)}
            isAdding={addingGameId === game.id}
            isRemoving={removingGameId === game.id}
            onOpenGame={onOpenGame}
            onHoverGame={onHoverGame}
            onRemoveGame={onRemoveGame}
            onHoverEnter={handleHoverEnter}
            onGameContextMenu={onGameContextMenu}
          />
        ) : (
          <CatalogueListItem
            game={game}
            key={game.id}
            isAdded={addedGameAppIds.has(game.appId)}
            isAdding={addingGameId === game.id}
            isRemoving={removingGameId === game.id}
            onOpenGame={onOpenGame}
            onHoverGame={onHoverGame}
            onRemoveGame={onRemoveGame}
            onHoverEnter={handleHoverEnter}
            onGameContextMenu={onGameContextMenu}
          />
        )
      )}
    </div>
  );
}

export { CatalogueListLoadingState };
