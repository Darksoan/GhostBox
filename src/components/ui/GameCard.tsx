import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Clock, CloudCheck, Trophy } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import {
  useCachedImageSources,
  useLoadableImageState,
} from "../../hooks/useCachedImageSources";
import type { BackupRootStatus } from "../../types";
import {
  layeredImageStyle,
  gameHeaderOnlySources,
  gamePortraitPreviewSources,
  gameStyle,
  preloadGameModalAssets,
} from "../../utils/image";
import { formatCompactPlaytime } from "../../utils/time";
import { GameGridLoadingState } from "./LoadingStates";

interface GameCardProps {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
  onContextMenu?: (game: GhostBoxGame, x: number, y: number) => void;
  portrait?: boolean;
  showAchievements?: boolean;
  showAchievementSummary?: boolean;
  showBackupStatus?: boolean;
  hasBackup?: boolean;
  active?: boolean;
  backupRootStatus?: BackupRootStatus | null;
  libraryCoverFade?: boolean;
}

export const GameCard = memo(function GameCard({
  game,
  onOpenGame,
  onContextMenu,
  portrait = false,
  showAchievements = false,
  showAchievementSummary = false,
  showBackupStatus = false,
  hasBackup = false,
  active = false,
  backupRootStatus = null,
  libraryCoverFade = false,
}: GameCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [shouldLoadCover, setShouldLoadCover] = useState(false);
  const rawHeaderSources = useMemo(
    () => (portrait ? gamePortraitPreviewSources(game) : gameHeaderOnlySources(game)),
    [game, portrait]
  );
  const headerSources = useCachedImageSources(shouldLoadCover ? rawHeaderSources : []);
  const coverImage = useLoadableImageState(headerSources);
  const previousCoverSourceRef = useRef(coverImage.loaded ? coverImage.source : "");

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

  useEffect(() => {
    if (coverImage.loaded && coverImage.source) {
      previousCoverSourceRef.current = coverImage.source;
    }
  }, [coverImage.loaded, coverImage.source]);

  const coverSource = coverImage.loaded
    ? coverImage.source
    : previousCoverSourceRef.current;
  const coverSources = coverSource ? [coverSource] : [];

  const shouldComputeAchievementData = showAchievements || showAchievementSummary;
  const achievementListTotal = shouldComputeAchievementData
    ? game.achievementList?.length ?? 0
    : 0;
  const achievementTotal = shouldComputeAchievementData
    ? Math.max(
        achievementListTotal,
        game.achievements.total,
        game.achievements.unlocked
      )
    : 0;
  const achievementUnlocked = shouldComputeAchievementData
    ? Math.min(
        achievementListTotal > 0
          ? (game.achievementList ?? []).filter(
              (achievement) => achievement.unlocked === true
            ).length
          : game.achievements.unlocked,
        achievementTotal
      )
    : 0;
  const achievementProgress =
    achievementTotal > 0 ? (achievementUnlocked / achievementTotal) * 100 : 0;
  const playtimeInMilliseconds = game.playTimeInMilliseconds ?? game.hours * 3_600_000;
  const compactPlaytime =
    playtimeInMilliseconds > 0 ? formatCompactPlaytime(playtimeInMilliseconds) : "0h";
  const showAchievementProgress = showAchievements && achievementTotal > 0;
  const showAchievementSummaryBadge = showAchievementSummary;

  const handleContextMenu = (event: React.MouseEvent) => {
    if (onContextMenu) {
      event.preventDefault();
      onContextMenu(game, event.clientX, event.clientY);
    }
  };

  return (
    <article
      ref={cardRef}
      className={`game-card${libraryCoverFade ? " game-card--library-cover-fade" : ""}`}
      style={gameStyle(game)}
      onClick={() => onOpenGame(game)}
      onFocus={() => preloadGameModalAssets(game)}
      onMouseEnter={() => preloadGameModalAssets(game)}
      onContextMenu={handleContextMenu}
    >
      <div
        className={`game-card__cover ${coverSources.length ? "game-card__cover--loaded" : ""}`}
        style={layeredImageStyle(
          coverSources,
          "",
          portrait ? "cover" : "100% 100%"
        )}
      >
        {showBackupStatus && (
          <div
            className={`game-card__backup-badge ${backupRootStatus?.status === "ok" && hasBackup ? "game-card__backup-badge--success" : "game-card__backup-badge--error"}`}
            aria-label={
              backupRootStatus?.status === "ok" && hasBackup
                ? "Backup disponível"
                : "Backup dessincronizado"
            }
          >
            {backupRootStatus?.status === "ok" && hasBackup ? (
              <CloudCheck size={15} strokeWidth={2.0} />
            ) : (
              <CloudCheck size={15} strokeWidth={2.0} />
            )}
          </div>
        )}
        {active && (
          <span className="game-card__active-badge" aria-label="Playing now">
            Playing
          </span>
        )}
        {showAchievementProgress && (
          <div
            className="game-card__achievement-progress"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${compactPlaytime} jogadas`}
          >
            <div className="game-card__achievement-progress-count">
              <Trophy size={16} strokeWidth={2.0} />
              <span>
                {achievementUnlocked} / {achievementTotal}
              </span>
              <span className="game-card__summary-metric">
                <Clock size={16} strokeWidth={2.0} />
                <span>{compactPlaytime}</span>
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
        {showAchievementSummaryBadge && !showAchievementProgress && (
          <div
            className="game-card__achievement-badge"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${compactPlaytime} jogadas`}
          >
            <span className="game-card__summary-metric">
              <Trophy size={16} strokeWidth={2.0} />
              <span>
                {achievementUnlocked} / {achievementTotal}
              </span>
            </span>
            <span className="game-card__summary-metric">
              <Clock size={16} strokeWidth={2.0} />
              <span>{compactPlaytime}</span>
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
  portrait?: boolean;
  showAchievements?: boolean;
  showAchievementSummary?: boolean;
  showBackupStatus?: boolean;
  hasBackupByAppId?: Set<string>;
  activeSessionAppIds?: Set<string>;
  backupRootStatus?: BackupRootStatus | null;
  libraryCoverFade?: boolean;
}

export function GameGrid({
  games: visibleGames,
  className = "",
  dense = false,
  onOpenGame,
  onGameContextMenu,
  portrait = false,
  showAchievements = false,
  showAchievementSummary = false,
  showBackupStatus = false,
  hasBackupByAppId = new Set(),
  activeSessionAppIds = new Set(),
  backupRootStatus = null,
  libraryCoverFade = false,
}: GameGridProps) {
  return (
    <div
      className={`game-grid ${dense ? "game-grid--dense" : ""} ${portrait ? "game-grid--portrait" : ""} ${className}`.trim()}
    >
      {visibleGames.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onOpenGame={onOpenGame}
          onContextMenu={onGameContextMenu}
          portrait={portrait}
          showAchievements={showAchievements}
          showAchievementSummary={showAchievementSummary}
          showBackupStatus={showBackupStatus}
          hasBackup={hasBackupByAppId.has(game.appId)}
          active={activeSessionAppIds.has(game.appId)}
          backupRootStatus={backupRootStatus}
          libraryCoverFade={libraryCoverFade}
        />
      ))}
    </div>
  );
}

export { GameGridLoadingState };
