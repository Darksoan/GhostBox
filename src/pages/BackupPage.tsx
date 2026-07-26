import { useEffect, useMemo, useState } from "react";
import {
  CloudCheck,
  RotateCcw,
} from "lucide-react";
import type { GhostBoxGame } from "../data";
import type { BackupSettings } from "../types";
import { useSettings } from "../context/settings";
import { useOverlay } from "../context/OverlayContext";
import { BackupListLoadingState, EmptyState } from "../components/ui/LoadingStates";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import { gameHeaderOnlySources, layeredImageStyle } from "../utils/image";
import { ghostboxApi } from "../lib/ghostboxApi";
import type { CloudSave } from "../lib/ghostboxApi.types";

type BackupPageProps = {
  games: GhostBoxGame[];
  backupSettings?: BackupSettings | null;
};

type BackupListItem = {
  appId: string;
  title: string;
  game?: GhostBoxGame;
  cloudSave: CloudSave;
};

function formatBackupDate(value: string | undefined, language: "pt" | "en") {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cloudSaveDate(save: CloudSave) {
  return save.updatedAt || save.createdAt || "";
}

function isSteamTitlePlaceholder(title: string | undefined, appId: string) {
  if (!title) return true;
  return new RegExp(`^Steam(?: App)? ${appId}$`, "i").test(title.trim());
}

function createBackupRestoreGame(appId: string, title: string): GhostBoxGame {
  return {
    appId,
    id: `steam-${appId}`,
    title,
    subtitle: "",
    status: "discover",
    hours: 0,
    rating: 0,
    size: "",
    release: "",
    progress: 0,
    accent: "",
    cover: "",
    hero: "",
    coverUrl: "",
    heroUrl: "",
    coverFallbacks: [],
    heroFallbacks: [],
    logo: "",
    tags: [],
    genres: [],
    screenshots: [],
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
  };
}

function BackupGameIcon({
  appId,
  game,
  title,
}: {
  appId: string;
  game?: GhostBoxGame;
  title: string;
}) {
  const iconGame = game ?? createBackupRestoreGame(appId, title);
  const rawHeaderSources = useMemo(
    () => gameHeaderOnlySources(iconGame),
    [iconGame],
  );
  const headerSources = useCachedImageSources(rawHeaderSources);
  const { source: headerSource, loaded } = useLoadableImageCover(headerSources);
  const displayedSources =
    loaded && headerSource ? [headerSource] : [];

  if (displayedSources.length > 0) {
    return (
      <span
        className="backup-list__game-header"
        style={layeredImageStyle(displayedSources, "")}
        aria-hidden="true"
      />
    );
  }

  return <CloudCheck className="backup-list__icon" size={28} aria-hidden="true" />;
}

export function BackupPage({ games, backupSettings = null }: BackupPageProps) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const language = appearance.language;
  const [restoringBackupPath, setRestoringBackupPath] = useState<string | null>(
    null,
  );
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [isCloudSavesLoading, setIsCloudSavesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsCloudSavesLoading(true);

    void ghostboxApi
      .listCloudSaves()
      .then((saves) => {
        if (cancelled) return;
        setCloudSaves(saves);

        const cloudBackupAppIds = new Set(saves.map((save) => save.appId));
        const libraryGameAppIds = new Set(games.map((game) => game.appId));
        const staleRecordAppIds = Object.keys(
          backupSettings?.backupRecords ?? {},
        ).filter(
          (appId) => libraryGameAppIds.has(appId) && !cloudBackupAppIds.has(appId),
        );

        for (const appId of staleRecordAppIds) {
          void ghostboxApi.removeBackupRecord(appId).catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setCloudSaves([]);
      })
      .finally(() => {
        if (!cancelled) setIsCloudSavesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backupSettings, games]);

  const backupGames = useMemo(() => {
    const gamesByAppId = new Map(games.map((game) => [game.appId, game]));
    const cloudSavesByAppId = new Map<string, CloudSave[]>();

    for (const save of cloudSaves) {
      const entries = cloudSavesByAppId.get(save.appId) ?? [];
      entries.push(save);
      cloudSavesByAppId.set(save.appId, entries);
    }

    for (const entries of cloudSavesByAppId.values()) {
      entries.sort(
        (a, b) => Date.parse(cloudSaveDate(b)) - Date.parse(cloudSaveDate(a)),
      );
    }

    return [...cloudSavesByAppId.entries()]
      .map<BackupListItem>(([appId, saves]) => {
        const game = gamesByAppId.get(appId);
        const cloudTitle = saves.find(
          (save) => !isSteamTitlePlaceholder(save.gameTitle, appId),
        )?.gameTitle;

        return {
          appId,
          title: game?.title ?? cloudTitle ?? appId,
          game,
          cloudSave: saves[0],
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [cloudSaves, games]);

  const handleRestoreCloudBackup = async (
    appId: string,
    title: string,
    save: CloudSave,
  ) => {
    const busyKey = `cloud:${save.id}`;
    if (restoringBackupPath) return;

    const confirmed = window.confirm(
      language === "en"
        ? `Restore this cloud backup for ${title}? Current saves, achievements, and playtime for this game on this PC may be replaced.`
        : `Restaurar este backup em nuvem de ${title}? Saves, conquistas e tempo de jogo atuais deste jogo neste PC podem ser substituídos.`,
    );
    if (!confirmed) return;

    const game =
      games.find((candidate) => candidate.appId === appId) ??
      createBackupRestoreGame(appId, title);

    setRestoringBackupPath(busyKey);
    try {
      const result = await ghostboxApi.restoreCloudSave(game, save.id);
      if (!result?.success) {
        throw new Error(
          language === "en"
            ? "Failed to restore cloud backup."
            : "Falha ao restaurar backup em nuvem.",
        );
      }
      showToast(
        language === "en"
          ? "Cloud backup restored"
          : "Backup em nuvem restaurado",
        language === "en"
          ? `${title} was restored from the selected cloud backup.`
          : `${title} foi restaurado a partir do backup em nuvem selecionado.`,
        "success",
      );
    } catch (error) {
      showToast(
        language === "en"
          ? "Failed to restore cloud backup"
          : "Falha ao restaurar backup em nuvem",
        error instanceof Error ? error.message : "",
        "error",
      );
    } finally {
      setRestoringBackupPath(null);
    }
  };

  return (
    <section className="backup-page content-section content-section--full">
      {backupGames.length > 0 ? (
        <ul
          className="backup-list"
          aria-label={
            language === "en"
              ? "Games with automatic backup"
              : "Jogos com backup automático"
          }
        >
          {backupGames.map(
            ({ appId, title, game, cloudSave }) => {
              const latestBackupDate = formatBackupDate(
                cloudSaveDate(cloudSave),
                language,
              );
              const isBusy = Boolean(restoringBackupPath);
              return (
                <li
                  key={appId}
                  className="backup-list__item backup-list__item--success"
                >
                  <div className="backup-list__content">
                    <BackupGameIcon
                      appId={appId}
                      game={game}
                      title={title}
                    />
                    <div className="backup-list__copy">
                      <strong>{title}</strong>
                      {latestBackupDate && <small>{latestBackupDate}</small>}
                    </div>

                    <div className="backup-list__actions">
                      <button
                        type="button"
                        className="backup-list__action-button"
                        disabled={isBusy}
                        aria-label={
                          language === "en"
                            ? `Restore ${title}`
                            : `Restaurar ${title}`
                        }
                        onClick={() => {
                          void handleRestoreCloudBackup(appId, title, cloudSave);
                        }}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        isCloudSavesLoading ? (
          <div className="backup-page__empty backup-page__loading-state" role="status">
            <BackupListLoadingState count={4} />
          </div>
        ) : (
          <EmptyState
            className="backup-page__empty"
            title={t("backup.emptyTitle")}
          />
        )
      )}
    </section>
  );
}
