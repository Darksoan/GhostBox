import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { DownloadDetailsModal } from "../components/modals/DownloadDetailsModal";
import { useSettings } from "../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import {
  clearFinishedDownloadTasks,
  downloadTasksChangedEvent,
  pauseDownloadTask,
  readDownloadTasks,
  resumeDownloadTask,
  type DownloadTask,
} from "../lib/downloadManager";
import { formatBytes, formatSpeed } from "../utils/formatBytes";
import { layeredImageStyle } from "../utils/image";

const emptyImageSources: string[] = [];

const statusRank: Record<DownloadTask["status"], number> = {
  downloading: 0,
  queued: 0,
  paused: 0,
  error: 1,
  completed: 1,
};

function isActiveTask(task: DownloadTask) {
  return task.status === "downloading" || task.status === "queued" || task.status === "paused";
}

function sortTasks(tasks: DownloadTask[]): DownloadTask[] {
  return [...tasks].sort((left, right) => {
    const rankDiff = statusRank[left.status] - statusRank[right.status];
    if (rankDiff !== 0) return rankDiff;
    if (isActiveTask(left) && isActiveTask(right)) {
      return left.queuedAt - right.queuedAt;
    }
    return (right.finishedAt ?? 0) - (left.finishedAt ?? 0);
  });
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";

  const totalSeconds = Math.ceil(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

function formatDownloadTimestamp(timestamp: number | undefined, language: "pt" | "en") {
  if (!timestamp || !Number.isFinite(timestamp)) return "--";

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function DownloadCard({
  task,
  queuePosition,
  onPause,
  onResume,
  onOpen,
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { appearance, t } = useSettings();
  const progressPercent =
    task.bytesTotal > 0
      ? Math.min(100, Math.round((task.bytesDownloaded / task.bytesTotal) * 100))
      : 0;
  const eta =
    typeof task.estimatedSecondsRemaining === "number"
      ? formatEta(task.estimatedSecondsRemaining)
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
            : t("downloads.statusError");
  const downloadedAt = formatDownloadTimestamp(task.startedAt ?? task.queuedAt, appearance.language);
  // Retomar passa por "queued" antes de "downloading", então os três estados precisam
  // do mesmo esqueleto: sem isso a linha de progresso pisca a cada pause/resume.
  const showsProgress =
    task.status === "downloading" || task.status === "paused" || task.status === "queued";
  const showsLiveSpeed = task.status === "downloading";
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const canCancel = task.status === "downloading" || task.status === "queued" || task.status === "paused";
  const hasControls = canPause || canResume || canCancel;
  const controls = (
    <span className="download-card__controls">
      {canPause ? (
        <button
          type="button"
          className="download-card__icon-button"
          onClick={() => onPause(task.id)}
          aria-label={t("downloads.pause")}
          title={t("downloads.pause")}
        >
          <Pause size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canResume ? (
        <button
          type="button"
          className="download-card__icon-button"
          onClick={() => onResume(task.id)}
          aria-label={t("downloads.resume")}
          title={t("downloads.resume")}
        >
          <Play size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="download-card__icon-button download-card__icon-button--danger"
          onClick={() => onOpen(task.id)}
          aria-label={t("downloads.cancel")}
          title={t("downloads.cancel")}
        >
          <X size={15} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );

  const coverSources = useCachedImageSources(task.headerSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(
    coverSources,
    { appId: task.appId, kind: "header" },
  );

  return (
    <article
      className={`download-card download-card--${task.status}${
        showsProgress ? " download-card--with-progress" : ""
      }${hasControls ? "" : " download-card--no-controls"}`}
    >
      <button
        type="button"
        className="download-card__open"
        onClick={() => onOpen(task.id)}
        aria-label={t("downloads.details.open", { title: task.title })}
      />
      <span className="download-card__cover-slot" aria-hidden="true">
        <span
          className={`download-card__cover${
            headerLoaded && headerSource
              ? " download-card__cover--loaded"
              : " download-card__cover--loading"
          }`}
          style={layeredImageStyle(
            headerLoaded && headerSource ? [headerSource] : emptyImageSources,
            "",
          )}
        />
      </span>

      <span className="download-card__main">
        <span className="download-card__meta">
          <strong>{task.title}</strong>
          <span className="download-card__date">{downloadedAt}</span>
          {task.status === "error" ? (
            <span className="download-card__error">
              {task.errorMessage ?? t("downloads.genericError")}
            </span>
          ) : null}
        </span>

        <span className="download-card__side">
          <span className="download-card__status">{statusLabel}</span>
          {showsProgress ? (
            <span
              className={`download-card__speed${
                showsLiveSpeed ? "" : " download-card__speed--hidden"
              }`}
              aria-hidden={!showsLiveSpeed}
            >
              {formatSpeed(task.speedBytesPerSecond)}
            </span>
          ) : null}
          {task.status === "completed" ? (
            <span className="download-card__speed">
              {t("downloads.totalDownloaded", {
                size: formatBytes(task.totalBytesDownloaded ?? 0),
              })}
              {task.failedFiles
                ? ` · ${t("downloads.failedFiles", { count: task.failedFiles })}`
                : ""}
            </span>
          ) : null}
        </span>

      </span>

      {showsProgress ? (
        <div className="download-card__progress-row">
          <span className="download-card__progress">
            <span className="download-card__progress-count">
              {formatBytes(task.bytesDownloaded)} /{" "}
              {task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}
            </span>
            <span
              className="download-card__progress-track"
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </span>
            <span
              className={`download-card__progress-count download-card__progress-count--eta${
                showsLiveSpeed ? "" : " download-card__progress-count--hidden"
              }`}
              aria-hidden={!showsLiveSpeed}
            >
              {t("downloads.estimatedTime", { time: eta })}
            </span>
          </span>
          {controls}
        </div>
      ) : hasControls ? (
        <div className="download-card__controls-row">{controls}</div>
      ) : null}
    </article>
  );
}

export function DownloadsPage() {
  const { t } = useSettings();
  const [tasks, setTasks] = useState<DownloadTask[]>(() => readDownloadTasks());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setTasks(readDownloadTasks());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [refresh]);

  const sortedTasks = sortTasks(tasks);
  const queuedTasks = sortedTasks.filter((task) => task.status === "queued");
  const hasFinishedTasks = tasks.some(
    (task) => task.status === "completed" || task.status === "error",
  );
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  return (
    <section className="downloads-page content-section content-section--full">
      {sortedTasks.length > 0 ? (
        <div className="downloads-page__list">
          {sortedTasks.map((task) => (
            <DownloadCard
              key={task.id}
              task={task}
              queuePosition={
                task.status === "queued"
                  ? queuedTasks.findIndex((entry) => entry.id === task.id) + 1
                  : null
              }
              onPause={pauseDownloadTask}
              onResume={resumeDownloadTask}
              onOpen={setSelectedTaskId}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="downloads-page__empty"
          title={t("downloads.emptyTitle")}
        />
      )}

      {hasFinishedTasks && (
        <div className="downloads-page__footer">
          <button
            type="button"
            className="downloads-page__clear"
            onClick={() => clearFinishedDownloadTasks()}
          >
            {t("downloads.clear")}
          </button>
        </div>
      )}

      <DownloadDetailsModal task={selectedTask} onClose={() => setSelectedTaskId(null)} />
    </section>
  );
}
