import { FolderOpen, FolderSearch, GripHorizontal, LoaderCircle, Pause, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { DownloadDetailsModal } from "../components/modals/DownloadDetailsModal";
import { useOverlay } from "../context/OverlayContext";
import { useSettings } from "../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import {
  downloadTasksChangedEvent,
  pauseDownloadTask,
  readDownloadTasks,
  removeDownloadTask,
  resumeDownloadTask,
  retryDownloadIgnoringStaleManifest,
  reorderQueuedTasks,
  reorderPausedTasks,
  reorderHistoryTasks,
  moveQueuedToPaused,
  movePausedToQueued,
  type DownloadTask,
} from "../lib/downloadManager";
import { ghostboxApi } from "../lib/ghostboxApi";
import { formatBytes, formatSpeed } from "../utils/formatBytes";
import { layeredImageStyle } from "../utils/image";

const emptyImageSources: string[] = [];
const minLaunchSpinnerMs = 700;

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const totalSeconds = Math.ceil(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatDownloadTimestamp(timestamp: number | undefined, language: "pt" | "en") {
  if (!timestamp || !Number.isFinite(timestamp)) return "--";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function DownloadsHero({
  task,
  queuePosition,
  onPause,
  onResume,
  onOpen,
  onOpenFolder,
  onUninstall,
  onLaunch,
  onRetryStale,
  launching,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenFolder: (task: DownloadTask) => void;
  onUninstall: (id: string) => void;
  onLaunch: (task: DownloadTask) => void;
  onRetryStale: (id: string) => void;
  launching: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  const { appearance, t } = useSettings();
  const heroSources = useMemo(() => {
    const appId = task.appId;
    return [
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_2x.jpg`,
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
      ...task.headerSources,
    ];
  }, [task.appId, task.headerSources]);
  const coverSources = useCachedImageSources(heroSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(coverSources, { preferOrder: true });
  const progressPercent =
    task.bytesTotal > 0 ? Math.min(100, Math.round((task.bytesDownloaded / task.bytesTotal) * 100)) : 0;
  const etaLabel =
    typeof task.estimatedSecondsRemaining === "number"
      ? t("downloads.estimatedTime", { time: formatEta(task.estimatedSecondsRemaining) })
      : t("downloads.estimatedTimeCalculating");
  const statusLabel =
    task.status === "queued"
      ? t("downloads.queuePosition", { position: queuePosition ?? 1 })
      : task.status === "downloading"
        ? t("downloads.statusDownloading")
        : task.status === "paused"
          ? t("downloads.statusPaused")
          : task.status === "completed"
            ? t("downloads.statusCompleted")
            : task.status === "error"
              ? t("downloads.statusError")
              : "";
  const downloadedAt = formatDownloadTimestamp(task.startedAt ?? task.queuedAt, appearance.language);
  const showsProgress = task.status === "downloading" || task.status === "paused" || task.status === "queued";
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const canRemove = task.status === "error";

  const metaItems = (
    showsProgress
      ? [
          `${formatBytes(task.bytesDownloaded)} / ${task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}`,
          task.status === "downloading" ? etaLabel : "",
          task.status === "downloading" ? formatSpeed(task.speedBytesPerSecond) : "",
          `${progressPercent}%`,
        ]
      : task.status === "completed"
        ? [
            downloadedAt,
            t("downloads.totalDownloaded", { size: formatBytes(task.totalBytesDownloaded ?? 0) }),
            task.failedFiles ? t("downloads.failedFiles", { count: task.failedFiles }) : "",
          ]
        : task.status === "error"
          ? [downloadedAt, task.errorMessage ?? t("downloads.genericError")]
          : []
  ).filter(Boolean);

  return (
    <section
      className={`downloads-hero downloads-hero--${task.status}${isDragging ? " downloads-hero--dragging" : ""}${isDragOver ? " downloads-hero--drag-over" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-drop-placement="hero"
    >
      <span
        className={`downloads-hero__cover${headerLoaded && headerSource ? " downloads-hero__cover--loaded" : ""}`}
        style={layeredImageStyle(headerLoaded && headerSource ? [headerSource] : emptyImageSources, "")}
        aria-hidden="true"
      />
      <span className="downloads-hero__scrim" aria-hidden="true" />
      {draggable && (
        <span
          className="downloads-hero__grip"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-hidden="true"
        >
          <GripHorizontal size={14} strokeWidth={2} />
        </span>
      )}
      <div className="downloads-hero__content">
        <div className="downloads-hero__top">
          <div className="downloads-hero__main">
            <strong className="downloads-hero__title">{task.title}</strong>
            {statusLabel && <span className="downloads-hero__status-text">{statusLabel}</span>}
          </div>

          <div className="downloads-hero__actions">
            {canPause && (
              <button type="button" className="downloads-hero__action" onClick={() => onPause(task.id)} aria-label={t("downloads.pause")}>
                <Pause size={18} strokeWidth={1.75} />
              </button>
            )}
            {canResume && (
              <button type="button" className="downloads-hero__action downloads-hero__action--primary" onClick={() => onResume(task.id)} aria-label={t("downloads.resume")}>
                <Play size={18} strokeWidth={1.75} />
              </button>
            )}
            {task.status === "completed" && (
              <>
                <button type="button" className="downloads-hero__action" onClick={() => onOpenFolder(task)} aria-label={t("downloads.openFolder")}>
                  <FolderOpen size={18} strokeWidth={1.75} />
                </button>
                <button type="button" className="downloads-hero__action" onClick={() => onUninstall(task.id)} aria-label={t("downloads.uninstall")}>
                  <Trash2 size={18} strokeWidth={1.75} />
                </button>
                <button type="button" className="downloads-hero__action downloads-hero__action--primary" onClick={() => onLaunch(task)} disabled={launching} aria-busy={launching} aria-label={t("downloads.launch")}>
                  {launching ? <LoaderCircle className="downloads-hero__launch-spinner" size={18} strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} strokeWidth={1.75} />}
                </button>
              </>
            )}
            {canRemove && (
              <button type="button" className="downloads-hero__action" onClick={() => removeDownloadTask(task.id)} aria-label={t("downloads.remove")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            )}
            <button type="button" className="downloads-hero__action" onClick={() => onOpen(task.id)} aria-label={t("downloads.details.open", { title: task.title })}>
              <FolderSearch size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {showsProgress && (
          <span className="downloads-hero__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        )}

        {metaItems.length > 0 && (
          <span className="downloads-hero__meta">
            {metaItems.map((item) => (
              <span key={item} className="downloads-hero__meta-item">
                {item}
              </span>
            ))}
          </span>
        )}

        {task.staleManifest && (
          <span className="downloads-hero__stale">
            <span className="downloads-hero__stale-detail">
              {t("downloads.staleManifestDetail", {
                depots: task.staleManifest.depots.map((depot) => depot.depotId).join(", "),
                buildId: task.staleManifest.publicBuildId || "--",
              })}
            </span>
            <button type="button" className="downloads-hero__action" onClick={() => onRetryStale(task.id)}>
              {t("downloads.staleManifestDownloadAnyway")}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

export function DownloadsPage() {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const [tasks, setTasks] = useState<DownloadTask[]>(() => readDownloadTasks());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [confirmDeleteOnOpen, setConfirmDeleteOnOpen] = useState(false);
  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setTasks(readDownloadTasks());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [refresh]);

  const openDetails = useCallback((id: string) => {
    setConfirmDeleteOnOpen(false);
    setSelectedTaskId(id);
  }, []);

  const openUninstall = useCallback((id: string) => {
    setConfirmDeleteOnOpen(true);
    setSelectedTaskId(id);
  }, []);

  const closeDetails = useCallback(() => {
    setSelectedTaskId(null);
    setConfirmDeleteOnOpen(false);
  }, []);

  const openDownloadFolder = useCallback(
    async (task: DownloadTask) => {
      try {
        await ghostboxApi.revealDownloadFolder(task.outputDir);
      } catch {
        showToast(t("downloads.openFolder"), t("downloads.openFolderError"), "error");
      }
    },
    [showToast, t]
  );

  const launchDownload = useCallback(
    async (task: DownloadTask) => {
      if (launchingTaskId) return;
      setLaunchingTaskId(task.id);
      try {
        await Promise.all([
          ghostboxApi.launchDownloadedGame(task.appId, task.title, task.downloadsRoot, task.outputDir, task.installDir),
          new Promise((resolve) => window.setTimeout(resolve, minLaunchSpinnerMs)),
        ]);
      } catch {
        showToast(t("downloads.launch"), t("downloads.launchError"), "error");
      } finally {
        setLaunchingTaskId(null);
      }
    },
    [launchingTaskId, showToast, t]
  );

  // Hero = downloading active, fallback queued, fallback paused — banner sempre no topo, demais em headers abaixo
  const activeDownloading = tasks.find((t) => t.status === "downloading") ?? null;
  const firstQueued = tasks.filter((t) => t.status === "queued")[0] ?? null;
  const firstPaused = tasks.filter((t) => t.status === "paused")[0] ?? null;
  const heroTask = activeDownloading ?? firstQueued ?? firstPaused ?? null;

  const queuedTasks = tasks.filter((t) => t.status === "queued").filter((t) => t.id !== heroTask?.id);
  const pausedTasks = tasks.filter((t) => t.status === "paused").filter((t) => t.id !== heroTask?.id);
  const historyTasks = tasks.filter((t) => t.status === "completed" || t.status === "error");

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, overId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(overId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  const handleDropOnCard = useCallback(
    (e: React.DragEvent, targetTask: DownloadTask) => {
      e.preventDefault();
      const sourceId = draggedId ?? e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetTask.id) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      const sourceTask = tasks.find((t) => t.id === sourceId);
      if (!sourceTask) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }

      // Same status reorder
      if (sourceTask.status === targetTask.status) {
        if (sourceTask.status === "queued") {
          // Need index including hero? hero is at 0, queued list excludes hero. Map correctly.
          const queuedAll = tasks.filter((t) => t.status === "queued");
          const sourceIdx = queuedAll.findIndex((t) => t.id === sourceId);
          const targetIdx = queuedAll.findIndex((t) => t.id === targetTask.id);
          if (sourceIdx !== -1 && targetIdx !== -1) reorderQueuedTasks(sourceId, targetIdx);
        } else if (sourceTask.status === "paused") {
          const targetIdx = pausedTasks.findIndex((t) => t.id === targetTask.id);
          reorderPausedTasks(sourceId, targetIdx);
        } else if (sourceTask.status === "completed" || sourceTask.status === "error") {
          const targetIdx = historyTasks.findIndex((t) => t.id === targetTask.id);
          reorderHistoryTasks(sourceId, targetIdx);
        } else if (sourceTask.status === "downloading") {
          // single, ignore
        }
      } else {
        // Cross status: queue <-> paused
        if (sourceTask.status === "queued" && targetTask.status === "paused") {
          const targetIdx = pausedTasks.findIndex((t) => t.id === targetTask.id);
          moveQueuedToPaused(sourceId, targetIdx);
        } else if (sourceTask.status === "paused" && targetTask.status === "queued") {
          const queuedAll = tasks.filter((t) => t.status === "queued");
          const targetIdx = queuedAll.findIndex((t) => t.id === targetTask.id);
          // If target is hero (queued first) need to handle offset
          // hero is excluded from queuedTasks, but queuedAll includes hero
          movePausedToQueued(sourceId, targetIdx === -1 ? 0 : targetIdx);
        } else if (sourceTask.status === "paused" && targetTask.status === "downloading") {
          // dropping paused onto hero downloading - treat as move to queued front (hero fallback)
          movePausedToQueued(sourceId, 0);
        } else if (sourceTask.status === "queued" && targetTask.status === "downloading") {
          // queued onto hero downloading - reorder queued? ignore
        } else if (sourceTask.status === "queued" && (targetTask.status === "completed" || targetTask.status === "error")) {
          // ignore cross to history
        } else if ((sourceTask.status === "completed" || sourceTask.status === "error") && targetTask.status === "queued") {
          // ignore
        }
      }

      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, tasks, pausedTasks, historyTasks]
  );

  const handleDropOnHero = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = draggedId ?? e.dataTransfer.getData("text/plain");
      if (!sourceId || !heroTask || sourceId === heroTask.id) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      const sourceTask = tasks.find((t) => t.id === sourceId);
      if (!sourceTask) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      if (sourceTask.status === "paused") {
        movePausedToQueued(sourceId, 0);
      } else if (sourceTask.status === "queued") {
        const queuedAll = tasks.filter((t) => t.status === "queued");
        const heroIdx = queuedAll.findIndex((t) => t.id === heroTask.id);
        const sourceIdx = queuedAll.findIndex((t) => t.id === sourceId);
        if (heroIdx !== -1 && sourceIdx !== -1) reorderQueuedTasks(sourceId, heroIdx);
      }
      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, tasks, heroTask]
  );

  const handleDropOnSection = useCallback(
    (e: React.DragEvent, section: "queue" | "paused" | "history") => {
      e.preventDefault();
      const sourceId = draggedId ?? e.dataTransfer.getData("text/plain");
      if (!sourceId) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      const sourceTask = tasks.find((t) => t.id === sourceId);
      if (!sourceTask) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }
      if (section === "queue" && sourceTask.status === "paused") {
        movePausedToQueued(sourceId, queuedTasks.length + (heroTask?.status === "queued" ? 1 : 0));
      } else if (section === "paused" && sourceTask.status === "queued") {
        moveQueuedToPaused(sourceId, pausedTasks.length);
      } else if (section === "queue" && sourceTask.status === "queued") {
        const queuedAll = tasks.filter((t) => t.status === "queued");
        reorderQueuedTasks(sourceId, queuedAll.length - 1);
      } else if (section === "paused" && sourceTask.status === "paused") {
        reorderPausedTasks(sourceId, pausedTasks.length - 1);
      } else if (section === "history" && (sourceTask.status === "completed" || sourceTask.status === "error")) {
        reorderHistoryTasks(sourceId, historyTasks.length - 1);
      }
      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, tasks, queuedTasks.length, pausedTasks.length, historyTasks.length, heroTask]
  );

  const hasAnyTasks = tasks.length > 0;

  return (
    <section className="downloads-page content-section content-section--full">
      {hasAnyTasks ? (
        <div className="downloads-page__stack">
          {heroTask && (
            <div
              className={`downloads-page__hero-drop ${dragOverId === heroTask.id ? "downloads-page__drop-active" : ""}`}
              onDragOver={(e) => handleDragOver(e, heroTask.id)}
              onDragLeave={handleDragLeave}
              onDrop={handleDropOnHero}
            >
              <DownloadsHero
                task={heroTask}
                queuePosition={heroTask.status === "queued" ? 1 : null}
                onPause={pauseDownloadTask}
                onResume={resumeDownloadTask}
                onOpen={openDetails}
                onOpenFolder={(t) => void openDownloadFolder(t)}
                onUninstall={openUninstall}
                onLaunch={(t) => void launchDownload(t)}
                onRetryStale={retryDownloadIgnoringStaleManifest}
                launching={launchingTaskId === heroTask.id}
                draggable={Boolean(heroTask)}
                onDragStart={(e) => handleDragStart(e, heroTask.id)}
                onDragOver={(e) => handleDragOver(e, heroTask.id)}
                onDrop={(e) => handleDropOnCard(e, heroTask)}
                onDragEnd={handleDragEnd}
                isDragging={draggedId === heroTask.id}
                isDragOver={dragOverId === heroTask.id}
              />
            </div>
          )}

          {queuedTasks.length > 0 && (
            <div
              className="downloads-page__section"
              onDragOver={(e) => handleDragOver(e, "queue-section")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnSection(e, "queue")}
            >
              <div className="downloads-page__list">
                {queuedTasks.map((task) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={tasks.filter((t) => t.status === "queued").findIndex((e) => e.id === task.id) + 1}
                    onPause={pauseDownloadTask}
                    onResume={resumeDownloadTask}
                    onOpen={openDetails}
                    onOpenFolder={(t) => void openDownloadFolder(t)}
                    onUninstall={openUninstall}
                    onLaunch={(t) => void launchDownload(t)}
                    onRetryStale={retryDownloadIgnoringStaleManifest}
                    launching={launchingTaskId === task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragOver={(e) => handleDragOver(e, task.id)}
                    onDrop={(e) => handleDropOnCard(e, task)}
                    onDragEnd={handleDragEnd}
                    isDragging={draggedId === task.id}
                    isDragOver={dragOverId === task.id}
                  />
                ))}
              </div>
            </div>
          )}

          {pausedTasks.length > 0 && (
            <div
              className="downloads-page__section"
              onDragOver={(e) => handleDragOver(e, "paused-section")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnSection(e, "paused")}
            >
              <div className="downloads-page__list">
                {pausedTasks.map((task) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={null}
                    onPause={pauseDownloadTask}
                    onResume={resumeDownloadTask}
                    onOpen={openDetails}
                    onOpenFolder={(t) => void openDownloadFolder(t)}
                    onUninstall={openUninstall}
                    onLaunch={(t) => void launchDownload(t)}
                    onRetryStale={retryDownloadIgnoringStaleManifest}
                    launching={launchingTaskId === task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragOver={(e) => handleDragOver(e, task.id)}
                    onDrop={(e) => handleDropOnCard(e, task)}
                    onDragEnd={handleDragEnd}
                    isDragging={draggedId === task.id}
                    isDragOver={dragOverId === task.id}
                  />
                ))}
              </div>
            </div>
          )}

          {historyTasks.length > 0 && (
            <div
              className="downloads-page__section"
              onDragOver={(e) => handleDragOver(e, "history-section")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnSection(e, "history")}
            >
              <div className="downloads-page__list">
                {historyTasks.map((task) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={null}
                    onPause={pauseDownloadTask}
                    onResume={resumeDownloadTask}
                    onOpen={openDetails}
                    onOpenFolder={(t) => void openDownloadFolder(t)}
                    onUninstall={openUninstall}
                    onLaunch={(t) => void launchDownload(t)}
                    onRetryStale={retryDownloadIgnoringStaleManifest}
                    launching={launchingTaskId === task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragOver={(e) => handleDragOver(e, task.id)}
                    onDrop={(e) => handleDropOnCard(e, task)}
                    onDragEnd={handleDragEnd}
                    isDragging={draggedId === task.id}
                    isDragOver={dragOverId === task.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState className="downloads-page__empty" title={t("downloads.emptyTitle")} />
      )}

      <DownloadDetailsModal task={selectedTask} onClose={closeDetails} confirmDeleteOnOpen={confirmDeleteOnOpen} confirmationOnly={confirmDeleteOnOpen} />
    </section>
  );
}
