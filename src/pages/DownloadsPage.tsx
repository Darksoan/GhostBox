import { FolderOpen, LoaderCircle, Pause, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  const { appearance, t } = useSettings();
  const coverSources = useCachedImageSources(task.headerSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(coverSources);
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
          : "";
  const showsProgress = task.status === "downloading" || task.status === "paused" || task.status === "queued";
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";

  return (
    <section
      className={`downloads-hero downloads-hero--${task.status}${isDragging ? " downloads-hero--dragging" : ""}${isDragOver ? " downloads-hero--drag-over" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-drop-placement="hero"
    >
      <span
        className={`downloads-hero__cover${headerLoaded && headerSource ? " downloads-hero__cover--loaded" : ""}`}
        style={layeredImageStyle(headerLoaded && headerSource ? [headerSource] : emptyImageSources, "")}
        aria-hidden="true"
      />
      <span className="downloads-hero__scrim" aria-hidden="true" />
      <div className="downloads-hero__content">
        <div className="downloads-hero__main">
          <strong className="downloads-hero__title">{task.title}</strong>
          {statusLabel && <span className="downloads-hero__status-pill">{statusLabel}</span>}
        </div>

        {showsProgress && (
          <span className="downloads-hero__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        )}

        {showsProgress && (
          <span className="downloads-hero__meta">
            <span className="downloads-hero__meta-item">
              {formatBytes(task.bytesDownloaded)} / {task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}
            </span>
            {task.status === "downloading" && (
              <>
                <span className="downloads-hero__meta-item">{etaLabel}</span>
                <span className="downloads-hero__meta-item">{formatSpeed(task.speedBytesPerSecond)}</span>
              </>
            )}
            <span className="downloads-hero__meta-item">{progressPercent}%</span>
          </span>
        )}

        <div className="downloads-hero__actions">
          {canPause && (
            <button type="button" className="downloads-hero__action" onClick={() => onPause(task.id)} aria-label={t("downloads.pause")}>
              <Pause size={16} strokeWidth={2} /> <span>{t("downloads.pause")}</span>
            </button>
          )}
          {canResume && (
            <button type="button" className="downloads-hero__action" onClick={() => onResume(task.id)} aria-label={t("downloads.resume")}>
              <Play size={16} strokeWidth={2} /> <span>{t("downloads.resume")}</span>
            </button>
          )}
          <button type="button" className="downloads-hero__action downloads-hero__action--ghost" onClick={() => onOpen(task.id)} aria-label={t("downloads.details.open", { title: task.title })}>
            {appearance.language === "en" ? "Detalhes" : "Detalhes"}
          </button>
        </div>
      </div>
    </section>
  );
}

function DownloadCard({
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
          : task.status === "error"
            ? t("downloads.statusError")
            : "";
  const downloadedAt = formatDownloadTimestamp(task.startedAt ?? task.queuedAt, appearance.language);
  const showsProgress = task.status === "downloading" || task.status === "paused" || task.status === "queued";
  const showsLiveSpeed = task.status === "downloading";

  const metaItems = (
    showsProgress
      ? [
          task.status === "downloading" ? "" : statusLabel,
          `${formatBytes(task.bytesDownloaded)} / ${task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}`,
          showsLiveSpeed ? etaLabel : "",
          showsLiveSpeed ? formatSpeed(task.speedBytesPerSecond) : "",
        ]
      : [
          task.status === "error" ? statusLabel : "",
          task.status === "completed"
            ? t("downloads.totalDownloaded", { size: formatBytes(task.totalBytesDownloaded ?? 0) })
            : "",
          task.status === "completed" && task.failedFiles
            ? t("downloads.failedFiles", { count: task.failedFiles })
            : "",
        ]
  ).filter(Boolean);
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const canCancel = task.status === "downloading" || task.status === "queued" || task.status === "paused";
  const canRemove = task.status === "error";
  const hasControls = canPause || canResume || canCancel || canRemove;
  const controls = (
    <span className="download-card__controls">
      {canPause ? (
        <button type="button" className="download-card__icon-button" onClick={() => onPause(task.id)} aria-label={t("downloads.pause")} title={t("downloads.pause")}>
          <Pause size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canResume ? (
        <button type="button" className="download-card__icon-button" onClick={() => onResume(task.id)} aria-label={t("downloads.resume")} title={t("downloads.resume")}>
          <Play size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" className="download-card__icon-button download-card__icon-button--danger" onClick={() => onOpen(task.id)} aria-label={t("downloads.cancel")} title={t("downloads.cancel")}>
          <X size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canRemove ? (
        <button type="button" className="download-card__remove" onClick={() => removeDownloadTask(task.id)} aria-label={t("downloads.remove")} title={t("downloads.remove")}>
          <X size={15} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );

  const coverSources = useCachedImageSources(task.headerSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(coverSources);

  return (
    <article
      className={`download-card download-card--${task.status}${hasControls ? "" : " download-card--no-controls"}${isDragging ? " download-card--dragging" : ""}${isDragOver ? " download-card--drag-over" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-task-id={task.id}
      data-status={task.status}
    >
      <button type="button" className="download-card__open" onClick={() => onOpen(task.id)} aria-label={t("downloads.details.open", { title: task.title })} />
      <span className="download-card__cover-slot" aria-hidden="true">
        <span
          className={`download-card__cover${headerLoaded && headerSource ? " download-card__cover--loaded" : " download-card__cover--loading"}`}
          style={layeredImageStyle(headerLoaded && headerSource ? [headerSource] : emptyImageSources, "")}
        />
      </span>

      <div className="download-card__content">
        {showsProgress ? null : (
          <div className="download-card__finished">
            <span className="download-card__date">{downloadedAt}</span>
            {task.status === "completed" ? (
              <span className="download-card__quick-actions">
                <span className="download-card__quick-action-wrap">
                  <button type="button" className="download-card__quick-action" onClick={() => onOpenFolder(task)} aria-label={t("downloads.openFolder")}>
                    <FolderOpen size={15} strokeWidth={2} />
                  </button>
                  <span className="download-card__quick-action-tooltip" role="tooltip">
                    {t("downloads.openFolder")}
                  </span>
                </span>
                <span className="download-card__quick-action-wrap">
                  <button type="button" className="download-card__quick-action download-card__quick-action--danger" onClick={() => onUninstall(task.id)} aria-label={t("downloads.uninstall")}>
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                  <span className="download-card__quick-action-tooltip" role="tooltip">
                    {t("downloads.uninstall")}
                  </span>
                </span>
                <span className="download-card__quick-action-wrap">
                  <button type="button" className="download-card__quick-action" onClick={() => onLaunch(task)} disabled={launching} aria-busy={launching} aria-label={t("downloads.launch")}>
                    {launching ? <LoaderCircle className="download-card__launch-spinner" size={15} strokeWidth={2} aria-hidden="true" /> : <Play size={15} strokeWidth={2} />}
                  </button>
                  <span className="download-card__quick-action-tooltip" role="tooltip">
                    {t("downloads.launch")}
                  </span>
                </span>
              </span>
            ) : null}
          </div>
        )}

        <strong className="download-card__title">{task.title}</strong>

        {showsProgress ? (
          <span className="download-card__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        ) : null}

        <span className="download-card__meta-line">
          {metaItems.map((item) => (
            <span key={item} className="download-card__meta-item">
              {item}
            </span>
          ))}
        </span>

        {task.status === "error" ? <span className="download-card__error">{task.errorMessage ?? t("downloads.genericError")}</span> : null}

        {task.staleManifest ? (
          <span className="download-card__stale">
            <span className="download-card__stale-detail">
              {t("downloads.staleManifestDetail", {
                depots: task.staleManifest.depots.map((depot) => depot.depotId).join(", "),
                buildId: task.staleManifest.publicBuildId || "--",
              })}
            </span>
            <button type="button" className="download-card__stale-action" onClick={() => onRetryStale(task.id)}>
              {t("downloads.staleManifestDownloadAnyway")}
            </button>
          </span>
        ) : null}
      </div>

      {hasControls ? controls : null}
    </article>
  );
}

export function DownloadsPage() {
  const { t, appearance } = useSettings();
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
    // Prevent ghost image issues with buttons
    if (e.currentTarget instanceof HTMLElement) {
      setTimeout(() => {
        e.currentTarget.classList.add("download-card--dragging");
      }, 0);
    }
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
              <div className="downloads-page__section-header">
                <h3 className="downloads-page__section-title">{appearance.language === "en" ? "Queue" : "Fila"}</h3>
                <span className="downloads-page__section-count">{queuedTasks.length}</span>
              </div>
              <div className="downloads-page__list">
                {queuedTasks.map((task) => (
                  <DownloadCard
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
              <div className="downloads-page__section-header">
                <h3 className="downloads-page__section-title">{appearance.language === "en" ? "Paused" : "Pausados"}</h3>
                <span className="downloads-page__section-count">{pausedTasks.length}</span>
              </div>
              <div className="downloads-page__list">
                {pausedTasks.map((task) => (
                  <DownloadCard
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
              <div className="downloads-page__section-header">
                <h3 className="downloads-page__section-title">{appearance.language === "en" ? "Completed" : "Concluídos"}</h3>
                <span className="downloads-page__section-count">{historyTasks.length}</span>
              </div>
              <div className="downloads-page__list">
                {historyTasks.map((task) => (
                  <DownloadCard
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
