import { useCallback, useEffect, useMemo, useState } from "react";
import { loadGames, type GhostBoxGame } from "../data";
import { useSettings } from "../context/settings";
import { EmptyState, NotificationsFeedLoadingState } from "../components/ui/LoadingStates";
import { ghostboxApi } from "../lib/ghostboxApi";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import { gameHeaderOnlySources, layeredImageStyle } from "../utils/image";
import { writeNotificationsLastSeenAt } from "../utils/storage";

const recentlyAddedLimit = 200;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatDateGroup(timestamp: number | undefined, locale: string, language: "pt" | "en") {
  const date = timestamp ? new Date(timestamp) : new Date(0);
  const today = startOfDay(new Date());
  const groupDay = startOfDay(date);
  const dayDifference = Math.round((today.getTime() - groupDay.getTime()) / 86_400_000);
  const dateText = date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (dayDifference === 0) {
    return { key: dateText, label: language === "en" ? "Today" : "Hoje", dateText };
  }

  if (dayDifference === 1) {
    return { key: dateText, label: language === "en" ? "Yesterday" : "Ontem", dateText };
  }

  if (dayDifference > 1 && dayDifference < 7) {
    return { key: dateText, label: language === "en" ? "This week" : "Esta semana", dateText };
  }

  return { key: dateText, label: dateText, dateText };
}

type NotificationsPageProps = {
  onOpenGame: (game: GhostBoxGame) => void;
};

function NotificationGameItem({
  game,
  onOpenGame,
}: {
  game: GhostBoxGame;
  onOpenGame: (game: GhostBoxGame) => void;
}) {
  const rawHeaderSources = useMemo(() => gameHeaderOnlySources(game), [game]);
  const headerSources = useCachedImageSources(rawHeaderSources);
  const { source: coverSource, loaded } = useLoadableImageCover(headerSources);
  const displayedCoverSources = loaded && coverSource ? [coverSource] : [];

  function getGameDeveloperLabel(game: GhostBoxGame) {
    return game.developers?.[0] || "";
  }

  return (
    <button
      type="button"
      className="notification-game"
      onClick={() => onOpenGame(game)}
    >
      <span
        className={`notification-game__cover${loaded ? " notification-game__cover--loaded" : ""}`}
        style={layeredImageStyle(displayedCoverSources, "")}
        aria-hidden="true"
      />
      <div className="notification-game__content">
        <strong>{game.title}</strong>
        {getGameDeveloperLabel(game) ? <span>{getGameDeveloperLabel(game)}</span> : null}
      </div>
    </button>
  );
}

export function NotificationsPage({ onOpenGame }: NotificationsPageProps) {
  const { appearance, t } = useSettings();
  const locale = appearance.language === "en" ? "en-US" : "pt-BR";
  const [recentGames, setRecentGames] = useState<GhostBoxGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const loadRecentGames = useCallback((showLoading = true) => {
    let cancelled = false;

    if (showLoading) setIsLoading(true);
    const request = loadGames({ limit: recentlyAddedLimit, sort: "recentlyAdded" })
      .then((database) => {
        if (!cancelled) setRecentGames(database.games);
      })
      .catch(() => {
        if (!cancelled) setRecentGames([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      void request;
    };
  }, []);

  const groupedGames = useMemo(() => {
    const groups = new Map<string, { label: string; dateText: string; games: GhostBoxGame[] }>();

    for (const game of recentGames) {
      const date = formatDateGroup(game.databaseAddedAt, locale, appearance.language);
      const currentGroup = groups.get(date.key);
      groups.set(date.key, {
        label: currentGroup?.label ?? date.label,
        dateText: currentGroup?.dateText ?? date.dateText,
        games: [...(currentGroup?.games ?? []), game],
      });
    }

    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [appearance.language, locale, recentGames]);

  useEffect(() => {
    return loadRecentGames();
  }, [loadRecentGames]);

  useEffect(() => {
    // Visiting the page clears the titlebar badge.
    writeNotificationsLastSeenAt(Date.now());
  }, []);

  useEffect(() => {
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      loadRecentGames(false);
    });
  }, [loadRecentGames]);

  return (
    <section className="notifications-page content-section content-section--full">
      {isLoading ? (
        <NotificationsFeedLoadingState count={3} />
      ) : groupedGames.length ? (
        <div className="notifications-feed">
          {groupedGames.map((group) => {
            const isOpen = openGroups.has(group.key);

            return (
              <section className="notification-group" key={group.key}>
                <button
                  type="button"
                  className={`notification-group__trigger ${isOpen ? "notification-group__trigger--open" : ""}`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    });
                  }}
                >
                  <span className="notification-group__copy">
                    <strong>{t("notifications.groupTitle")}</strong>
                    <small>
                      <span>{group.label}</span>
                      <span>{group.dateText}</span>
                    </small>
                  </span>
                  <span className="notification-group__count">
                    {group.games.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="notifications-list notifications-list--games">
                    {group.games.map((game) => (
                      <NotificationGameItem
                        key={game.id}
                        game={game}
                        onOpenGame={onOpenGame}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState
          className="notifications-page__empty"
          title={appearance.language === "en" ? "Nothing new yet" : "Nada novo por enquanto"}
        />
      )}
    </section>
  );
}
