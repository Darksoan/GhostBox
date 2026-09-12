import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Cup } from "reicon-react";
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

interface GameCardProps {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
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
  onHoverGame,
  portrait = false,
  showAchievements = false,
  libraryCoverFade = false,
}: GameCardProps) {
  const areMetricsUnlocked = useMetricsUnlocked();
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
  const achievementTotal = showAchievements ? getAchievementTotal(game) : 0;
  const achievementUnlocked = showAchievements
    ? Math.min(getUnlockedAchievementCount(game), achievementTotal)
    : 0;
  const achievementProgress =
    achievementTotal > 0
      ? Math.round((achievementUnlocked / achievementTotal) * 100)
      : 0;
  // O card ainda pode estar aguardando o enriquecimento no primeiro paint.
  // Enquanto não houver total, não exibe o badge vazio "0 / 0"; ao chegar um
  // schema válido, ele aparece normalmente no próximo render.
  const hasAchievementBadge =
    showAchievements && hasAvailableAchievements(game);
  const showLockedBadge = hasAchievementBadge && !areMetricsUnlocked;

  const handleContextMenu = (event: React.MouseEvent) => {
    if (onContextMenu) {
      event.preventDefault();
      onContextMenu(game, event.clientX, event.clientY);
    }
  };

  // Hover/focus da capa: além de adiantar os assets do modal, reverifica as
  // conquistas (conta + schema) para o badge não ficar preso no 0 até o
  // modal abrir. O dedupe mora no refresh (inFlight + 1/appId/versão stats).
  const handleHoverEnrich = () => {
    preloadGameModalAssets(game, 0, { nativeResolve: false });
    if (showAchievements && !showLockedBadge) onHoverGame?.(game);
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
      <div
        className={`game-card__cover ${coverSources.length ? "game-card__cover--loaded" : ""}`}
        style={layeredImageStyle(
          coverSources,
          "",
          portrait ? "auto 100%" : "100% 100%",
          portrait ? "auto 106%" : "100% 100%",
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
  onGameContextMenu,
  onHoverGame,
  portrait = false,
  showAchievements = false,
  activeSessionAppIds = new Set(),
  libraryCoverFade = false,
  animateLayout = false,
}: GameGridProps) {
  // Windowing progressivo: sem virtualização total (que bateria com o layout
  // CSS grid auto-fill + FLIP), renderizamos a lista em páginas acionadas por
  // um sentinel IntersectionObserver. O custo de DOM/render no primeiro paint
  // deixa de escalar com a biblioteca inteira — só com o viewport. Combinado
  // com `content-visibility:auto` nos cards, os itens já renderizados mas fora
  // da tela seguem baratos.
  const INITIAL_PAGE = 48;
  const PAGE_SIZE = 48;
  const [renderCount, setRenderCount] = useState(() =>
    Math.min(INITIAL_PAGE, visibleGames.length),
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const renderedGames = useMemo(
    () => visibleGames.slice(0, renderCount),
    [visibleGames, renderCount],
  );

  useEffect(() => {
    setRenderCount(Math.min(INITIAL_PAGE, visibleGames.length));
  }, [visibleGames]);

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
