import { useEffect, useMemo, useRef, useState } from "react";
import type { GhostBoxGame, SteamAchievement } from "../data";
import { useSettings } from "../context/settings";
import { AchievementsListLoadingState, EmptyState } from "../components/ui/LoadingStates";
import { isAchievementUnlocked } from "../utils/achievementStats";
import { loadGameAchievementDetailsCached } from "../utils/gameCache";
import {
  achievementIconFallbackSources,
  mergeAchievementDetailsIntoGame,
} from "../utils/steamAchievementMerge";
import { formatCompactPlaytime } from "../utils/time";
import { useMetricsUnlocked } from "../context/MetricsVisibilityContext";
import "./GameAchievementsPage.scss";

function formatAchievementPercent(value: number, language: string = "pt-BR") {
  const locale = language === "en" ? "en-US" : "pt-BR";
  return `${value.toLocaleString(locale, {
    minimumFractionDigits: value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  })}%`;
}

function formatUnlockedDate(value: string | undefined, language: string) {
  const time = Date.parse(value ?? "");
  if (!Number.isFinite(time)) return "";

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function AchievementListItem({
  achievement,
  highlighted,
  language,
  unlockedLabel,
}: {
  achievement: SteamAchievement;
  highlighted: boolean;
  language: string;
  unlockedLabel: (date: string) => string;
}) {
  const unlocked = isAchievementUnlocked(achievement);
  const fallbackSources = useMemo(
    () => achievementIconFallbackSources(achievement, unlocked),
    [achievement.icon, achievement.iconGray, unlocked]
  );
  const preferredSource = fallbackSources[0] ?? "";
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = fallbackSources[sourceIndex] ?? "";
  const unlockedDate = formatUnlockedDate(achievement.unlockedAt, language);
  const globalPercent =
    typeof achievement.globalPercent === "number" &&
    Number.isFinite(achievement.globalPercent)
      ? formatAchievementPercent(achievement.globalPercent, language)
      : null;

  useEffect(() => {
    setSourceIndex(0);
  }, [preferredSource]);

  return (
    <li
      className={`game-achievements-page__item ${
        unlocked ? "" : "game-achievements-page__item--locked"
      } ${highlighted ? "game-achievements-page__item--highlighted" : ""}`}
      data-achievement-id={achievement.name}
    >
      <span className="game-achievements-page__icon-wrap">
        <img
          className="game-achievements-page__icon"
          src={source}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            if (sourceIndex + 1 < fallbackSources.length) {
              setSourceIndex((index) => index + 1);
            }
          }}
        />
      </span>
      <div className="game-achievements-page__item-content">
        <strong>{achievement.title}</strong>
        {achievement.description ? <p>{achievement.description}</p> : null}
      </div>
      <div className="game-achievements-page__item-meta">
        {unlocked && unlockedDate
          ? unlockedLabel(unlockedDate)
          : globalPercent
            ? language === "en"
              ? (
                <>
                  Unlocked by <strong>{globalPercent}</strong> of players.
                </>
              )
              : (
                <>
                  Desbloqueado por <strong>{globalPercent}</strong> dos jogadores.
                </>
              )
            : null}
      </div>
    </li>
  );
}

interface GameAchievementsPageProps {
  game: GhostBoxGame;
  highlightAchievementId?: string;
  onDetailsLoaded?: (game: GhostBoxGame) => void;
}

export function GameAchievementsPage({
  game,
  highlightAchievementId,
  onDetailsLoaded,
}: GameAchievementsPageProps) {
  const { appearance, t } = useSettings();
  const areMetricsUnlocked = useMetricsUnlocked();
  const [detailGame, setDetailGame] = useState<GhostBoxGame>(game);
  const [isLoading, setIsLoading] = useState(true);
  const highlightScrolledRef = useRef(false);
  // Mesmo identificador que o modal usa: o backend resolve conquistas pelo
  // appId numérico, e `game.id` nem sempre o carrega (`steam-<appId>` sim,
  // mas ids locais podem ser qualquer coisa).
  const detailsGameId = game.appId || game.id;

  useEffect(() => {
    setDetailGame((current) => {
      const sameGame =
        current.id === game.id ||
        (Boolean(current.appId) && current.appId === game.appId);
      if (!sameGame) {
        highlightScrolledRef.current = false;
        return game;
      }
      if (current === game) return current;
      // O prop troca de identidade a cada tick de playtime/refresh da conta
      // Steam mesmo sem mudar de jogo. Substituir aqui descartava a lista de
      // schema já carregada (a cópia das listas às vezes ainda não a tem) e
      // a aba esvaziava sem novo fetch — a união nunca perde entradas.
      return mergeAchievementDetailsIntoGame(game, current);
    });
  }, [game]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    loadGameAchievementDetailsCached(detailsGameId)
      .then((details) => {
        if (cancelled || !details) return;

        setDetailGame((current) => ({
          ...mergeAchievementDetailsIntoGame(current, details),
          playTimeInMilliseconds:
            current.playTimeInMilliseconds ?? details.playTimeInMilliseconds,
        }));
        onDetailsLoaded?.(details);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [game.appId, game.id, onDetailsLoaded]);

  const achievements = useMemo(
    () =>
      [...(detailGame.achievementList ?? [])].sort(
        (left, right) =>
          Number(isAchievementUnlocked(right)) -
          Number(isAchievementUnlocked(left))
      ),
    [detailGame.achievementList]
  );

  const unlockedCount = achievements.filter(isAchievementUnlocked).length;
  const totalCount = achievements.length;
  const progressPercent =
    totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
  const playtime =
    detailGame.playTimeInMilliseconds ?? detailGame.hours * 3_600_000;

  useEffect(() => {
    if (
      isLoading ||
      !highlightAchievementId ||
      highlightScrolledRef.current
    ) {
      return;
    }

    const element = document.querySelector(
      `[data-achievement-id="${CSS.escape(highlightAchievementId)}"]`
    );
    if (!element) return;

    highlightScrolledRef.current = true;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightAchievementId, isLoading, achievements.length]);

  const unlockedLabel = (date: string) =>
    t("profile.achievementUnlockedOn", { date });

  if (!areMetricsUnlocked) {
    return (
      <section
        className="game-achievements-page"
        aria-label={t("achievements.pageAria", { title: detailGame.title })}
      >
        <EmptyState
          className="game-achievements-page__locked-state"
          title={t("metrics.lockedAchievements")}
        />
      </section>
    );
  }

  return (
    <section
      className="game-achievements-page"
      aria-label={t("achievements.pageAria", { title: detailGame.title })}
    >
      <div className="game-achievements-page__summary-section">
        <h1 className="game-achievements-page__title">{detailGame.title}</h1>
        <div className="game-achievements-page__summary-row">
          <p className="game-achievements-page__summary-playtime">
            {appearance.language === "en" ? "Play time: " : "Tempo de jogo: "}
            <strong>{formatCompactPlaytime(playtime)}</strong>
          </p>
          <p className="game-achievements-page__summary-progress-text">
            {t("achievements.progressSummary", {
              unlocked: unlockedCount,
              total: totalCount,
              percent: progressPercent,
            })}
          </p>
        </div>

        <div
          className="game-achievements-page__progress-track"
          role="progressbar"
          aria-valuenow={unlockedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount || 1}
          aria-label={t("achievements.progressSummary", {
            unlocked: unlockedCount,
            total: totalCount,
            percent: progressPercent,
          })}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="game-achievements-page__content">
        {isLoading && achievements.length === 0 ? (
          <AchievementsListLoadingState count={8} />
        ) : achievements.length === 0 ? (
          <EmptyState
            className="game-achievements-page__empty"
            title={t("achievements.empty")}
          />
        ) : (
          <ul className="game-achievements-page__list">
            {achievements.map((achievement) => (
              <AchievementListItem
                key={achievement.name || achievement.title}
                achievement={achievement}
                highlighted={achievement.name === highlightAchievementId}
                language={appearance.language}
                unlockedLabel={unlockedLabel}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
