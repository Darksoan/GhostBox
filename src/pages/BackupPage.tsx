import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { KeyboardEvent } from "react";
import {
  ChevronLeft,
  Cloud,
  CloudAlert,
  CloudCheck,
  Pin,
  PinOff,
  RotateCcw,
  Trash,
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
  cloudSaves: CloudSave[];
};

type BackupVersionItem = { date: string; save: CloudSave };

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
  fallback,
}: {
  appId: string;
  game?: GhostBoxGame;
  title: string;
  fallback: "success" | "missing";
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

  return fallback === "success" ? (
    <CloudCheck className="backup-list__icon" size={28} aria-hidden="true" />
  ) : (
    <CloudAlert className="backup-list__icon" size={28} aria-hidden="true" />
  );
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
  const [expandedBackupAppIds, setExpandedBackupAppIds] = useState<Set<string>>(
    () => new Set(),
  );

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
          cloudSaves: saves,
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

  const handleDeleteCloudBackup = async (title: string, save: CloudSave) => {
    const busyKey = `cloud:${save.id}`;
    if (restoringBackupPath) return;

    const confirmed = window.confirm(
      language === "en"
        ? `Delete this cloud backup for ${title}? This cannot be undone.`
        : `Excluir este backup em nuvem de ${title}? Isso não pode ser desfeito.`,
    );
    if (!confirmed) return;

    setRestoringBackupPath(busyKey);
    try {
      const result = await ghostboxApi.deleteCloudSave(save.id);
      if (!result?.success) {
        throw new Error(
          result?.error ||
            (language === "en"
              ? "Failed to delete cloud backup."
              : "Falha ao excluir backup em nuvem."),
        );
      }
      setCloudSaves((current) => current.filter((item) => item.id !== save.id));
      showToast(
        language === "en" ? "Cloud backup deleted" : "Backup em nuvem excluído",
        language === "en"
          ? `${title} cloud backup was removed.`
          : `O backup em nuvem de ${title} foi removido.`,
        "success",
      );
    } catch (error) {
      showToast(
        language === "en"
          ? "Failed to delete cloud backup"
          : "Falha ao excluir backup em nuvem",
        error instanceof Error ? error.message : "",
        "error",
      );
    } finally {
      setRestoringBackupPath(null);
    }
  };

  const handleToggleCloudBackupPinned = async (
    title: string,
    save: CloudSave,
  ) => {
    const pinned = !Boolean(save.pinned);
    const busyKey = `cloud-pin:${save.id}`;
    if (restoringBackupPath) return;

    setRestoringBackupPath(busyKey);
    try {
      const result = await ghostboxApi.setCloudSavePinned(save.id, pinned);
      if (!result?.save) {
        throw new Error(
          language === "en"
            ? "Failed to update cloud backup."
            : "Falha ao atualizar backup em nuvem.",
        );
      }
      setCloudSaves((current) =>
        current.map((item) => (item.id === save.id ? result.save : item)),
      );
      showToast(
        pinned
          ? language === "en"
            ? "Cloud backup pinned"
            : "Backup em nuvem fixado"
          : language === "en"
            ? "Cloud backup unpinned"
            : "Backup em nuvem desafixado",
        pinned
          ? language === "en"
            ? `${title} cloud backup will not be replaced by automatic rotation.`
            : `O backup em nuvem de ${title} não será substituído pela rotação automática.`
          : language === "en"
            ? `${title} cloud backup can be replaced by future automatic backups.`
            : `O backup em nuvem de ${title} poderá ser substituído por backups automáticos futuros.`,
        "success",
      );
    } catch (error) {
      showToast(
        language === "en"
          ? "Failed to update cloud backup"
          : "Falha ao atualizar backup em nuvem",
        error instanceof Error ? error.message : "",
        "error",
      );
    } finally {
      setRestoringBackupPath(null);
    }
  };

  const toggleBackupVersions = (appId: string) => {
    setExpandedBackupAppIds((current) => {
      const next = new Set(current);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    appId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleBackupVersions(appId);
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
            ({ appId, title, game, cloudSaves: gameCloudSaves }) => {
              const versionItems: BackupVersionItem[] = gameCloudSaves
                .map((save) => ({
                  date: cloudSaveDate(save),
                  save,
                }))
                .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
              const latestBackupDate = formatBackupDate(
                versionItems[0]?.date,
                language,
              );
              const hasSuccessfulBackup = versionItems.length > 0;
              const isExpanded = expandedBackupAppIds.has(appId);
              const versionsListId = `backup-versions-${appId}`;
              return (
                <li
                  key={appId}
                  className={`backup-list__item ${
                    hasSuccessfulBackup
                      ? "backup-list__item--success"
                      : "backup-list__item--missing"
                  } ${isExpanded ? "backup-list__item--expanded" : ""}`}
                >
                  <div
                    className="backup-list__content"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-controls={versionsListId}
                    onClick={() => toggleBackupVersions(appId)}
                    onKeyDown={(event) => handleCardKeyDown(event, appId)}
                  >
                    <BackupGameIcon
                      appId={appId}
                      game={game}
                      title={title}
                      fallback={hasSuccessfulBackup ? "success" : "missing"}
                    />
                    <div className="backup-list__copy">
                      <strong>{title}</strong>
                      {latestBackupDate && <small>{latestBackupDate}</small>}
                    </div>

                    <div className="backup-list__actions">
                      {versionItems.length > 0 && (
                        <ChevronLeft
                          className="backup-list__chevron"
                          size={18}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                  {versionItems.length > 0 && (
                    <div
                      className={`backup-list__versions-wrapper ${isExpanded ? "backup-list__versions-wrapper--expanded" : ""}`}
                      aria-hidden={!isExpanded}
                      style={
                        {
                          "--backup-versions-height": `${versionItems.length * 58 + 16}px`,
                        } as CSSProperties
                      }
                    >
                      <ul
                        id={versionsListId}
                        className="backup-list__versions"
                        aria-label={
                          language === "en"
                            ? `${title} backup versions`
                            : `Versões de backup de ${title}`
                        }
                      >
                        {versionItems.map((version, index) => {
                          const entryDate = formatBackupDate(
                            version.date,
                            language,
                          );
                          const entryLabel =
                            entryDate ||
                            (language === "en"
                              ? `Version ${index + 1}`
                              : `Versão ${index + 1}`);
                          const isLatest = index === 0;
                          const busyKey = `cloud:${version.save.id}`;
                          const isBusy = Boolean(restoringBackupPath);
                          const isPinned = Boolean(version.save.pinned);

                          return (
                            <li className="backup-list__version" key={busyKey}>
                              <Cloud
                                className="backup-list__version-icon"
                                size={16}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                              <div className="backup-list__version-copy">
                                <strong>{entryLabel}</strong>
                                <span>
                                  {isLatest
                                    ? language === "en"
                                      ? "Most recent"
                                      : "Mais recente"
                                    : language === "en"
                                      ? "Older backup"
                                      : "Backup antigo"}
                                  {isPinned
                                    ? language === "en"
                                      ? " - pinned"
                                      : " - fixado"
                                    : ""}
                                </span>
                              </div>
                              <div className="backup-list__version-actions">
                                <button
                                  type="button"
                                  className={`backup-list__action-button ${isPinned ? "backup-list__action-button--pinned" : ""}`}
                                  disabled={isBusy}
                                  aria-label={
                                    isPinned
                                      ? language === "en"
                                        ? `Unpin ${entryLabel}`
                                        : `Desafixar ${entryLabel}`
                                      : language === "en"
                                        ? `Pin ${entryLabel}`
                                        : `Fixar ${entryLabel}`
                                  }
                                  title={
                                    isPinned
                                      ? language === "en"
                                        ? "Allow automatic replacement"
                                        : "Permitir substituição automática"
                                      : language === "en"
                                        ? "Keep this backup"
                                        : "Manter este backup"
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleCloudBackupPinned(
                                      title,
                                      version.save,
                                    );
                                  }}
                                >
                                  {isPinned ? (
                                    <PinOff size={16} aria-hidden="true" />
                                  ) : (
                                    <Pin size={16} aria-hidden="true" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="backup-list__action-button"
                                  disabled={isBusy}
                                  aria-label={
                                    language === "en"
                                      ? `Restore ${entryLabel}`
                                      : `Restaurar ${entryLabel}`
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleRestoreCloudBackup(
                                      appId,
                                      title,
                                      version.save,
                                    );
                                  }}
                                >
                                  <RotateCcw size={16} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="backup-list__action-button backup-list__action-button--danger"
                                  disabled={isBusy}
                                  aria-label={
                                    language === "en"
                                      ? `Delete ${entryLabel}`
                                      : `Excluir ${entryLabel}`
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteCloudBackup(
                                      title,
                                      version.save,
                                    );
                                  }}
                                >
                                  <Trash size={16} aria-hidden="true" />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            },
          )}
        </ul>
      ) : (
        isCloudSavesLoading ? (
          <div className="backup-page__empty backup-page__loading-skeleton" role="status">
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
