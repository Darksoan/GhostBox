import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { useSettings } from "../context/settings";
import {
  clearFinishedDownloadTasks,
  downloadTasksChangedEvent,
  readDownloadTasks,
  removeDownloadTask,
  type DownloadTask,
} from "../lib/downloadManager";
import { formatBytes, formatSpeed } from "../utils/formatBytes";

const depotStatusKeys: Record<string, string> = {
  starting: "downloads.status.starting",
  "key-resolved": "downloads.status.keyResolved",
  "loading-manifest": "downloads.status.loadingManifest",
  "manifest-loaded": "downloads.status.manifestLoaded",
  "connecting-steam": "downloads.status.connectingSteam",
  "steam-connected": "downloads.status.steamConnected",
  "cdn-ready": "downloads.status.cdnReady",
  "starting-depot": "downloads.status.startingDepot",
};

const statusRank: Record<DownloadTask["status"], number> = {
  downloading: 0,
  queued: 1,
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
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onRemove: (id: string) => void;
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
        : task.status === "completed"
          ? t("downloads.statusCompleted")
          : t("downloads.statusError");
  const depotStatusKey = task.depotStatus ? depotStatusKeys[task.depotStatus] : undefined;
  const canRemove = task.status !== "downloading";

  return (
    <article className={`download-card download-card--${task.status}`}>
      <div className="download-card__header">
        {task.coverUrl ? (
          <img className="download-card__cover" src={task.coverUrl} alt="" />
        ) : (
          <span
            className="download-card__cover download-card__cover--empty"
            aria-hidden="true"
          />
        )}
        <div className="download-card__title-group">
          <strong>{task.title}</strong>
          <span className="download-card__status-pill">{statusLabel}</span>
        </div>
        {canRemove && (
          <button
            type="button"
            className="download-card__remove"
            onClick={() => onRemove(task.id)}
            aria-label={t("downloads.remove")}
          >
            <X size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {task.status === "downloading" && (
        <>
          <div className="download-card__progress-track">
            <div
              className="download-card__progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="download-card__meta">
            <span>
              {formatBytes(task.bytesDownloaded)} /{" "}
              {task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}
            </span>
            <span>{formatSpeed(task.speedBytesPerSecond)}</span>
            <span>{t("downloads.remaining", { size: formatBytes(remaining) })}</span>
          </div>
          <small className="download-card__depot-caption">
            {task.depotTotal > 0
              ? t("downloads.depotOf", { index: task.depotIndex, total: task.depotTotal })
              : ""}
            {depotStatusKey ? ` · ${t(depotStatusKey)}` : ""}
          </small>
        </>
      )}

      {task.status === "completed" && (
        <div className="download-card__meta">
          <span>
            {t("downloads.totalDownloaded", {
              size: formatBytes(task.totalBytesDownloaded ?? 0),
            })}
          </span>
          {task.failedFiles ? (
            <span>{t("downloads.failedFiles", { count: task.failedFiles })}</span>
          ) : null}
        </div>
      )}

      {task.status === "error" && (
        <p className="download-card__error">{task.errorMessage ?? t("downloads.genericError")}</p>
      )}
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
      <header className="downloads-page__header">
        <div>
          <h2>{t("downloads.title")}</h2>
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
