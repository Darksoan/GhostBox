import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { useSettings } from "../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import {
  clearFinishedDownloadTasks,
  cancelDownloadTask,
  downloadTasksChangedEvent,
  pauseDownloadTask,
  readDownloadTasks,
  removeDownloadTask,
  resumeDownloadTask,
  type DownloadTask,
} from "../lib/downloadManager";
import { formatBytes, formatSpeed } from "../utils/formatBytes";
import { layeredImageStyle } from "../utils/image";

const emptyImageSources: string[] = [];

const statusRank: Record<DownloadTask["status"], number> = {
  downloading: 0,
  queued: 1,
  paused: 1,
  error: 2,
  completed: 2,
};

function sortTasks(tasks: DownloadTask[]): DownloadTask[] {
  return [...tasks].sort((left, right) => {
    const rankDiff = statusRank[left.status] - statusRank[right.status];
    if (rankDiff !== 0) return rankDiff;
    if (left.status === "queued" && right.status === "queued") {
      return left.queuedAt - right.queuedAt;
    }
    return (right.finishedAt ?? 0) - (left.finishedAt ?? 0);
  });
}

function DownloadCard({
  task,
  queuePosition,
  onRemove,
  onPause,
  onResume,
  onCancel,
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onRemove: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useSettings();
  const progressPercent =
    task.bytesTotal > 0
      ? Math.min(100, Math.round((task.bytesDownloaded / task.bytesTotal) * 100))
      : 0;
  const remaining = Math.max(0, task.bytesTotal - task.bytesDownloaded);
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
  const canRemove = task.status !== "downloading";
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const canCancel = task.status === "downloading" || task.status === "queued" || task.status === "paused";

  const coverSources = useCachedImageSources(task.headerSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(
    coverSources,
    { appId: task.appId, kind: "header" },
  );

  return (
    <article
      className={`download-card download-card--${task.status}${
        task.status === "downloading" || task.status === "paused" ? " download-card--with-progress" : ""
      }`}
    >
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
          {task.status === "error" ? (
            <span className="download-card__error">
              {task.errorMessage ?? t("downloads.genericError")}
            </span>
          ) : null}
        </span>

        <span className="download-card__side">
          <span className="download-card__status">{statusLabel}</span>
          {task.status === "downloading" ? (
            <span className="download-card__speed">
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
              onClick={() => onCancel(task.id)}
              aria-label={t("downloads.cancel")}
              title={t("downloads.cancel")}
            >
              <X size={15} strokeWidth={2} />
            </button>
          ) : null}
          {canRemove && !canCancel ? (
            <button
              type="button"
              className="download-card__icon-button"
              onClick={() => onRemove(task.id)}
              aria-label={t("downloads.remove")}
              title={t("downloads.remove")}
            >
              <X size={15} strokeWidth={2} />
            </button>
          ) : null}
        </span>
      </span>

      {task.status === "downloading" || task.status === "paused" ? (
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
            <span className="download-card__progress-count">
              {t("downloads.remaining", { size: formatBytes(remaining) })}
            </span>
          </span>
        </div>
      ) : null}
    </article>
  );
}

export function DownloadsPage() {
  const { t } = useSettings();
  const [tasks, setTasks] = useState<DownloadTask[]>(() => readDownloadTasks());

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

  return (
    <section className="downloads-page content-section content-section--full">
      <header className="downloads-page__header content-section__header">
        <div>
          <h3>{t("downloads.title")}</h3>
          <p>{t("downloads.description")}</p>
        </div>
        <button
          type="button"
          className="downloads-page__clear"
          onClick={() => clearFinishedDownloadTasks()}
          disabled={!hasFinishedTasks}
        >
          {t("downloads.clear")}
        </button>
      </header>

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
              onRemove={removeDownloadTask}
              onPause={pauseDownloadTask}
              onResume={resumeDownloadTask}
              onCancel={cancelDownloadTask}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="downloads-page__empty"
          title={t("downloads.emptyTitle")}
          description={t("downloads.emptyMessage")}
        />
      )}
    </section>
  );
}
