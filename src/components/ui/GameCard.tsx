import { memo, useEffect, useRef } from "react";
import { Clock, CloudCheck, Trophy } from "lucide-react";
import type { PirateGame } from "../../data";
import {
  useCachedImageSources,
  useLoadableImageState,
} from "../../hooks/useCachedImageSources";
import type { BackupRootStatus } from "../../types";
import {
  layeredImageStyle,
  gameHeaderOnlySources,
  gamePortraitSources,
  gameStyle,
  preloadGameModalAssets,
} from "../../utils/image";
import { formatCompactPlaytime } from "../../utils/time";
import { GameGridLoadingState } from "./LoadingStates";

interface GameCardProps {
  game: PirateGame;
  onOpenGame: (game: PirateGame) => void;
  onContextMenu?: (game: PirateGame, x: number, y: number) => void;
  portrait?: boolean;
  showAchievements?: boolean;
  showAchievementSummary?: boolean;
  showBackupStatus?: boolean;
  hasBackup?: boolean;
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
  backupRootStatus = null,
  libraryCoverFade = false,
}: GameCardProps) {
  const headerSources = useCachedImageSources(
    portrait ? gamePortraitSources(game) : gameHeaderOnlySources(game)
  );
  const coverImage = useLoadableImageState(headerSources);
  const previousCoverSourceRef = useRef(coverImage.loaded ? coverImage.source : "");

  useEffect(() => {
    if (coverImage.loaded && coverImage.source) {
      previousCoverSourceRef.current = coverImage.source;
    }
  }, [coverImage.loaded, coverImage.source]);

  const coverSource = coverImage.loaded
    ? coverImage.source
    : previousCoverSourceRef.current;
  const coverSources = coverSource ? [coverSource] : [];
  const achievementTotal =
    game.achievementList?.length || game.achievements.total;
  const achievementUnlocked = Math.min(
    game.achievementList?.length
      ? game.achievementList.filter(
          (achievement) => achievement.unlocked === true
        ).length
      : game.achievements.unlocked,
    achievementTotal
  );
  const achievementProgress =
    achievementTotal > 0 ? (achievementUnlocked / achievementTotal) * 100 : 0;
  const playtimeInMilliseconds = game.playTimeInMilliseconds ?? game.hours * 3_600_000;
  const hasPlaytime = playtimeInMilliseconds > 0;
  const showAchievementProgress = showAchievements && achievementTotal > 0;
  const showAchievementSummaryBadge =
    showAchievementSummary && (achievementTotal > 0 || hasPlaytime);

  const handleContextMenu = (event: React.MouseEvent) => {
    if (onContextMenu) {
      event.preventDefault();
      onContextMenu(game, event.clientX, event.clientY);
    }
  };

  return (
    <article
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
              <CloudCheck size={15} strokeWidth={2.4} />
            ) : (
              <CloudCheck size={15} strokeWidth={2.4} />
            )}
          </div>
        )}
         {showAchievementProgress && (
          <div
            className="game-card__achievement-progress"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${formatCompactPlaytime(playtimeInMilliseconds)} jogadas`}
          >
            <div className="game-card__achievement-progress-count">
              <Trophy size={16} strokeWidth={2.35} />
              <span>
                {achievementUnlocked} / {achievementTotal}
              </span>
              <span className="game-card__summary-metric">
                <Clock size={16} strokeWidth={2.35} />
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
        )}
        {showAchievementSummaryBadge && !showAchievementProgress && (
          <div
            className="game-card__achievement-badge"
            aria-label={`${achievementUnlocked} de ${achievementTotal} conquistas desbloqueadas, ${formatCompactPlaytime(playtimeInMilliseconds)} jogadas`}
          >
            {achievementTotal > 0 && (
              <span className="game-card__summary-metric">
                <Trophy size={14} strokeWidth={2.35} />
                <span>
                  {achievementUnlocked} / {achievementTotal}
                </span>
              </span>
            )}
            <span className="game-card__summary-metric">
              <Clock size={14} strokeWidth={2.35} />
              <span>{formatCompactPlaytime(playtimeInMilliseconds)}</span>
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
  games: PirateGame[];
  className?: string;
  dense?: boolean;
  onOpenGame: (game: PirateGame) => void;
  onGameContextMenu?: (game: PirateGame, x: number, y: number) => void;
  portrait?: boolean;
  showAchievements?: boolean;
  showAchievementSummary?: boolean;
  showBackupStatus?: boolean;
  hasBackupByAppId?: Set<string>;
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
          backupRootStatus={backupRootStatus}
          libraryCoverFade={libraryCoverFade}
        />
      ))}
    </div>
  );
}

export { GameGridLoadingState };
