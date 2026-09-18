import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Cup, Play } from "reicon-react";
import type { GhostBoxGame } from "../../data";
import {
  useCachedImageSources,
  useLoadableImageState,
} from "../../hooks/useCachedImageSources";
import {
  layeredImageStyle,
  gameHeaderOnlySources,
  gamePortraitPreviewSources,
  gameStyle,
  preloadGameModalAssets,
} from "../../utils/image";
import {
  getAchievementTotal,
  getUnlockedAchievementCount,
  hasAvailableAchievements,
} from "../../utils/achievementStats";
import { GameGridLoadingState } from "./LoadingStates";
import { useFlipLayout } from "../../hooks/useFlipLayout";
import { useMetricsUnlocked } from "../../context/MetricsVisibilityContext";
import { loadGameAchievementDetailsCached } from "../../utils/gameCache";
import { mergeAchievementDetailsIntoGame } from "../../utils/steamAchievementMerge";

interface GameCardProps {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
  onPlayGame?: (game: GhostBoxGame) => void | Promise<void>;
  canPlay?: boolean;
  isLaunching?: boolean;
  isSessionActive?: boolean;
  /** Recheck de conquistas da conta ao hover/focus da capa. */
  onHoverGame?: (game: GhostBoxGame) => void;
  portrait?: boolean;
  showAchievements?: boolean;
  active?: boolean;
  libraryCoverFade?: boolean;
}

export const GameCard = memo(function GameCard({
  game,
  onOpenGame,
  onContextMenu,
  onPlayGame,
  canPlay = false,
  isLaunching = false,
  isSessionActive = false,
  onHoverGame,
  portrait = false,
  showAchievements = false,
  libraryCoverFade = false,
}: GameCardProps) {
  const areMetricsUnlocked = useMetricsUnlocked();
  const [hoverAchievementDetails, setHoverAchievementDetails] = useState<GhostBoxGame | null>(null);
  const badgeGame = useMemo(
    () => hoverAchievementDetails?.appId === game.appId
      ? mergeAchievementDetailsIntoGame(game, hoverAchievementDetails)
      : game,
    [game, hoverAchievementDetails],
  );
  const cardRef = useRef<HTMLElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  const rawHeaderSources = useMemo(
    () =>
      portrait ? gamePortraitPreviewSources(game) : gameHeaderOnlySources(game),
    [game, portrait],
  );
  const headerSources = useCachedImageSources(
    shouldLoadCover ? rawHeaderSources : [],
  );
  const coverImage = useLoadableImageState(headerSources);
  const previousCoverSourceRef = useRef(
    coverImage.loaded ? coverImage.source : "",
  );

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
      { rootMargin: "420px 0px", threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoadCover]);

  useEffect(() => {
    if (coverImage.loaded && coverImage.source) {
      previousCoverSourceRef.current = coverImage.source;
    }
  }, [coverImage.loaded, coverImage.source]);

  const coverSource = coverImage.loaded
    ? coverImage.source
    : previousCoverSourceRef.current;
  const coverSources = coverSource ? [coverSource] : [];

  // Lista de schema pode chegar antes dos flags pessoais. O resumo da conta
  // continua sendo piso da contagem; usar só a lista fazia 1/34 virar 0/34 no
  // card até o modal executar sua fusão completa.
  const achievementTotal = showAchievements ? getAchievementTotal(badgeGame) : 0;
  const achievementUnlocked = showAchievements
    ? Math.min(getUnlockedAchievementCount(badgeGame), achievementTotal)
    : 0;
  const achievementProgress =
    achievementTotal > 0
      ? Math.round((achievementUnlocked / achievementTotal) * 100)
      : 0;
  // O card ainda pode estar aguardando o enriquecimento no primeiro paint.
  // Enquanto não houver total, não exibe o badge vazio "0 / 0"; ao chegar um
  // schema válido, ele aparece normalmente no próximo render.
  const hasAchievementBadge =
    showAchievements && hasAvailableAchievements(badgeGame);
  const showLockedBadge = hasAchievementBadge && !areMetricsUnlocked;
  const showPlayAction = Boolean(onPlayGame && canPlay);
  const playIsDisabled = isLaunching || isSessionActive;
  const playLabel = isSessionActive
    ? `${game.title} já está em execução`
    : isLaunching
      ? `Iniciando ${game.title}`
      : `Jogar ${game.title}`;

  const handleContextMenu = (event: React.MouseEvent) => {
    if (onContextMenu) {
      event.preventDefault();
      onContextMenu(game, event.clientX, event.clientY);
    }
  };

  const handlePlayClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (playIsDisabled) return;
    void onPlayGame?.(game);
  };

  // Hover/focus da capa: além de adiantar os assets do modal, reverifica as
  // conquistas (conta + schema) para o badge não ficar preso no 0 até o
  // modal abrir. O dedupe mora no refresh (inFlight + 1/appId/versão stats).
  const handleHoverEnrich = () => {
    preloadGameModalAssets(game, 0, { nativeResolve: false });
    if (showAchievements && areMetricsUnlocked) {
      onHoverGame?.(game);
      // Atualiza também cards Steam que não pertencem às listas locais do
      // contexto, sem esperar a fila de enriquecimento da biblioteca inteira.
      void loadGameAchievementDetailsCached(game.appId || game.id)
        .then((details) => {
          if (details) setHoverAchievementDetails(details);
        })
        .catch(() => undefined);
    }
  };

  return (
    <article
      ref={cardRef}
      data-layout-id={game.id}
      className={`game-card${libraryCoverFade ? " game-card--library-cover-fade" : ""}${showLockedBadge ? " game-card--locked" : ""}`}
      style={gameStyle(game)}
      onClick={() => onOpenGame(game)}
      onFocus={handleHoverEnrich}
      onMouseEnter={handleHoverEnrich}
      onContextMenu={handleContextMenu}
    >
      {!coverSource && (
        <div className="game-card__cover-skeleton skeleton" aria-hidden="true" />
      )}
      <div
        className={`game-card__cover ${coverSources.length ? "game-card__cover--loaded" : ""}`}
        style={layeredImageStyle(
          coverSources,
          "",
          portrait ? "auto 100%" : "100% 100%",
          portrait ? "auto 104%" : "100% 100%",
        )}
      >
        {hasAchievementBadge && !showLockedBadge && (
          <div
            className="game-card__achievement-badges"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${achievementProgress}%`}
          >
            <span className="game-card__summary-metric">
              <Cup size={16} weight="Filled" strokeWidth={2.0} />
              <span>
                {achievementUnlocked} / {achievementTotal}
              </span>
            </span>
            <span className="game-card__achievement-percentage">
              {achievementProgress}%
            </span>
            <span className="game-card__achievement-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${achievementProgress / 100})` }} />
            </span>
          </div>
        )}
      </div>
      {showPlayAction && (
        <button
          type="button"
          className="game-card__play-button"
          aria-label={playLabel}
          aria-busy={isLaunching}
          disabled={playIsDisabled}
          onClick={handlePlayClick}
        >
          <Play size={32} weight="Filled" aria-hidden="true" />
        </button>
      )}
      <div className="game-card__backdrop">
        <div className="game-card__content">
          <div className="game-card__title-container">
            <h4>{game.title}</h4>
          </div>
        </div>
      </div>
    </article>
  );
});

interface GameGridProps {
  games: GhostBoxGame[];
  className?: string;
  dense?: boolean;
  onOpenGame: (game: GhostBoxGame) => void;
  onPlayGame?: (game: GhostBoxGame) => void | Promise<void>;
  playableGameAppIds?: ReadonlySet<string>;
  launchingGameId?: string | null;
  onGameContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
  onHoverGame?: (game: GhostBoxGame) => void;
  portrait?: boolean;
  showAchievements?: boolean;
  activeSessionAppIds?: Set<string>;
  libraryCoverFade?: boolean;
  animateLayout?: boolean;
}

export function GameGrid({
  games: visibleGames,
  className = "",
  dense = false,
  onOpenGame,
  onPlayGame,
  playableGameAppIds,
  launchingGameId,
  onGameContextMenu,
  onHoverGame,
  portrait = false,
  showAchievements = false,
  activeSessionAppIds = new Set(),
  libraryCoverFade = false,
  animateLayout = false,
}: GameGridProps) {
  // Paginação progressiva mantém o primeiro paint pequeno. O orçamento só
  // cresce: atualizar detalhes/conquistas não pode desmontar as páginas já
  // visíveis e encolher a grade durante a rolagem.
  const INITIAL_PAGE = 48;
  const PAGE_SIZE = 48;
  const [renderCount, setRenderCount] = useState(INITIAL_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const renderedGames = useMemo(
    () => visibleGames.slice(0, renderCount),
    [visibleGames, renderCount],
  );

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (renderCount >= visibleGames.length) return;
    if (typeof IntersectionObserver === "undefined") {
      setRenderCount(visibleGames.length);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRenderCount((current) =>
            Math.min(current + PAGE_SIZE, visibleGames.length),
          );
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [renderCount, visibleGames.length]);

  const layoutKey = useMemo(
    () => renderedGames.map((game) => game.id).join("|"),
    [renderedGames],
  );
  const gridRef = useFlipLayout<HTMLDivElement>(layoutKey, animateLayout);

  return (
    <div
      ref={gridRef}
      className={`game-grid ${dense ? "game-grid--dense" : ""} ${portrait ? "game-grid--portrait" : ""} ${className}`.trim()}
    >
      {renderedGames.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onOpenGame={onOpenGame}
          onPlayGame={onPlayGame}
          canPlay={playableGameAppIds?.has(game.appId) ?? false}
          isLaunching={
            launchingGameId === game.id || launchingGameId === game.appId
          }
          isSessionActive={
            activeSessionAppIds.has(game.appId) || activeSessionAppIds.has(game.id)
          }
          onContextMenu={onGameContextMenu}
          onHoverGame={onHoverGame}
          portrait={portrait}
          showAchievements={showAchievements}
          active={activeSessionAppIds.has(game.appId)}
          libraryCoverFade={libraryCoverFade}
        />
      ))}
      {renderCount < visibleGames.length && (
        <div ref={sentinelRef} className="game-grid__sentinel" aria-hidden="true" />
      )}
    </div>
  );
}

export { GameGridLoadingState };
