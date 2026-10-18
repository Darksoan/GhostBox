import { ArrowDownToLine, ArrowUp, FolderOpen, LoaderCircle } from "lucide-react";
import { Pause, Play, Xmark } from "reicon-react";
import { useMemo, useRef, useState } from "react";
import { useSettings } from "../context/settings";
import { useOverlay } from "../context/OverlayContext";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import { useDownloadSpeedHistory } from "../hooks/useDownloadSpeedHistory";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import { EmptyState } from "../components/ui/LoadingStates";
import { DownloadDetailsModal } from "../components/modals/DownloadDetailsModal";
import { DownloadActivityPanel } from "../features/downloads/DownloadActivityPanel";
import { DownloadStoragePanel } from "../features/downloads/DownloadStoragePanel";
import { ghostboxApi } from "../lib/ghostboxApi";
import {
  pauseDownloadTask, resumeDownloadTask, prioritizeDownloadTask,
  type DownloadTask,
} from "../lib/downloadManager";
import { formatBytes, formatGigabytes } from "../utils/formatBytes";
import { layeredImageStyle, steamLibraryHeroSources } from "../utils/image";
import "./DownloadsPage.scss";

export function downloadPercent(task: DownloadTask) {
  return task.status === "completed" ? 100 : Number.isFinite(task.bytesTotal) && Number.isFinite(task.bytesDownloaded) && task.bytesTotal > 0
    ? Math.min(100, Math.max(0, task.bytesDownloaded / task.bytesTotal * 100)) : 0;
}

function DownloadCard({ task, queuePosition, canPrioritize, onDetails, onRemove }: {
  task: DownloadTask;
  queuePosition: number | null;
  canPrioritize: boolean;
  onDetails: () => void;
  onRemove: () => void;
}) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const heroSources = useMemo(() => steamLibraryHeroSources(task.appId), [task.appId]);
  const sources = useCachedImageSources(heroSources);
  const { source, loaded } = useLoadableImageCover(sources, { decodeBeforeCommit: true });
  const [busyAction, setBusyAction] = useState<"toggle" | "launch" | "folder" | "prioritize" | null>(null);
  const inFlight = useRef(false);
  const percent = Math.round(downloadPercent(task));
  const active = task.status === "downloading";
  const completed = task.status === "completed";
  const canPause = active || task.status === "queued";
  const canResume = task.status === "paused" || task.status === "error";
  const startsDownload = !active && !task.startedAt && task.bytesDownloaded <= 0;
  const showsProgress = canPause || task.status === "paused";
  const statusLabel = task.status === "queued"
    ? t("downloads.queuePosition", { position: queuePosition ?? 1 })
    : t(`downloads.${task.status === "paused" ? "pausedState" : task.status}`);

  const runAction = async (action: NonNullable<typeof busyAction>, work: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyAction(action);
    try {
      await work();
    } catch (error) { showToast(t("downloads.title"), String(error), "error"); }
    finally {
      inFlight.current = false;
      setBusyAction(null);
    }
  };

  return (
    <section className={`downloads-hero downloads-hero--${task.status}`} aria-label={task.title} data-download-id={task.id}>
      <span className={`downloads-hero__art${source && loaded ? " downloads-hero__art--loaded" : ""}`}
        style={layeredImageStyle(source && loaded ? [source] : [], "")} aria-hidden="true" />
      <span className="downloads-hero__scrim" aria-hidden="true" />
      <div className="downloads-hero__content">
        <div className="downloads-hero__top">
          <button type="button" className="downloads-hero__title-button" onClick={onDetails} aria-label={`${t("downloads.details")}: ${task.title}`}>
            <strong className="downloads-hero__title">{task.title}</strong>
          </button>
          <div className="downloads-hero__middle">
            <span className="downloads-hero__status-text">{active && task.bytesTotal <= 0 ? t("downloads.preparing") : statusLabel}</span>
          </div>
        </div>
        <div className="downloads-hero__controls" aria-hidden={showsProgress ? undefined : true}>
          {showsProgress && <>
            <span className={`downloads-hero__progress-track${task.bytesTotal <= 0 ? " downloads-hero__progress-track--pending" : ""}`} role="progressbar" aria-label={`${t("downloads.progress")}: ${task.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.bytesTotal > 0 ? percent : undefined}>
              <span style={{ transform: `scaleX(${percent / 100})` }} />
            </span>
            {task.bytesTotal > 0 && <span className="downloads-hero__percent">{percent}%</span>}
          </>}
        </div>
        <div className="downloads-hero__footer">
          <div className="downloads-hero__transfer-metrics">
            <span><ArrowDownToLine aria-hidden="true" />{task.status === "paused"
              ? <span>{t(task.bytesTotal > 0 ? "downloads.downloadedOf" : "downloads.downloadedAmount", {
                  downloaded: formatGigabytes(task.bytesDownloaded, appearance.language === "en" ? "en-US" : "pt-BR"),
                  total: formatGigabytes(task.bytesTotal, appearance.language === "en" ? "en-US" : "pt-BR"),
                })}</span>
              : <>{!active && t("downloads.downloaded")}<span>{formatBytes(task.bytesDownloaded)} / {task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "—"}</span></>}
            </span>
          </div>
          <div className="downloads-hero__actions">
            {canPrioritize && <button type="button" className="downloads-hero__action"
              onClick={() => void runAction("prioritize", () => prioritizeDownloadTask(task.id))}
              disabled={busyAction !== null} aria-busy={busyAction === "prioritize"} aria-label={t("downloads.prioritize")}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>}
            {(canPause || canResume) && (
              <button type="button" className="downloads-hero__action downloads-hero__toggle"
                onClick={() => void runAction("toggle", () => startsDownload && task.status === "queued"
                  ? prioritizeDownloadTask(task.id) : canPause ? pauseDownloadTask(task.id) : resumeDownloadTask(task.id))}
                disabled={busyAction !== null} aria-busy={busyAction === "toggle"}
                aria-label={t(startsDownload ? "downloads.read" : canPause ? "downloads.pause" : task.status === "error" ? "downloads.retry" : "downloads.resume")}>
                {startsDownload || canResume
                  ? <Play size={18} className="downloads-hero__play-icon" data-active="true" aria-hidden="true" />
                  : <Pause size={18} className="downloads-hero__pause-icon" data-active="true" aria-hidden="true" />}
              </button>
            )}
            {completed && (
              <button type="button" className="downloads-hero__action"
                onClick={() => void runAction("launch", async () => {
                  const result = await ghostboxApi.launchGame(task);
                  if (!result?.success) throw new Error(result?.error || t("downloads.error"));
                })}
                disabled={busyAction !== null || task.steamIntegration?.status !== "ok"}
                aria-label={t("downloads.play")} aria-busy={busyAction === "launch"}>
                {busyAction === "launch"
                  ? <LoaderCircle size={18} className="downloads-hero__launch-spinner" aria-hidden="true" />
                  : <Play size={18} className="downloads-hero__play-icon" aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="downloads-hero__action"
              onClick={() => void runAction("folder", () => ghostboxApi.revealDownloadFolder(task.outputDir))}
              disabled={!task.outputDir || busyAction !== null} aria-busy={busyAction === "folder"} aria-label={t("downloads.openFolder")}>
              <FolderOpen size={18} aria-hidden="true" />
            </button>
            <button type="button" className="downloads-hero__action downloads-hero__action--danger"
              onClick={onRemove} disabled={busyAction !== null} aria-label={t("downloads.remove")}>
              <Xmark size={18} className="downloads-hero__remove-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
        {task.errorMessage && task.status === "error" && <p className="downloads-hero__error">{task.errorMessage}</p>}
      </div>
    </section>
  );
}

export function DownloadsPage({ isActive = true }: { isActive?: boolean }) {
  const { t } = useSettings();
  const tasks = useDownloadTasks();
  const activity = useDownloadSpeedHistory();
  const [selection, setSelection] = useState<{ id: string; removing: boolean } | null>(null);
  const selected = tasks.find((task) => task.id === selection?.id);
  const queuedTasks = tasks.filter((task) => task.status === "queued");
  const pausedTasks = tasks.filter((task) => task.status === "paused");
  const activeTask = tasks.find((task) => task.status === "downloading");
  const heroTask = activeTask ?? queuedTasks[0] ?? pausedTasks[0];
  const pendingCount = tasks.filter((task) => ["downloading", "queued", "paused"].includes(task.status)).length;
  const activityTask = tasks.find((task) => task.id === activity.taskId && task.queuedAt === activity.queuedAt)
    ?? (activity.taskId === null ? heroTask : undefined);
  const lists = [
    { key: "queue", tasks: queuedTasks.filter((task) => task.id !== heroTask?.id) },
    { key: "paused", tasks: pausedTasks.filter((task) => task.id !== heroTask?.id) },
    { key: "history", tasks: tasks.filter((task) => task.status === "completed" || task.status === "error").sort((a, b) => (b.finishedAt ?? b.queuedAt) - (a.finishedAt ?? a.queuedAt)) },
  ];
  const renderCard = (task: DownloadTask) => (
    <DownloadCard task={task} key={task.id}
      queuePosition={task.status === "queued" ? queuedTasks.findIndex((entry) => entry.id === task.id) + 1 : null}
      canPrioritize={pendingCount > 1 && task.id !== heroTask?.id && (task.status === "queued" || task.status === "paused")}
      onDetails={() => setSelection({ id: task.id, removing: false })}
      onRemove={() => setSelection({ id: task.id, removing: true })}
    />
  );

  return (
    <section className="downloads-page content-section content-section--full" aria-label={t("downloads.title")}>
      <div className="downloads-page__layout">
        <div className="downloads-page__stack">
          {tasks.length > 0 ? <>
            {heroTask && <div className="downloads-page__hero-drop">{renderCard(heroTask)}</div>}
            {lists.filter((list) => list.tasks.length > 0).map((list) => (
              <div className="downloads-page__section" key={list.key}>
                <div className="downloads-page__list">{list.tasks.map(renderCard)}</div>
              </div>
            ))}
          </> : <EmptyState className="downloads-page__empty" title={t("downloads.empty")} />}
        </div>
        <aside className="downloads-page__sidebar" aria-label={t("downloads.activity")}>
          <DownloadActivityPanel task={activityTask} activity={activity} hasPendingDownloads={pendingCount > 0} />
          <DownloadStoragePanel isActive={isActive} />
        </aside>
      </div>
      {selected && <DownloadDetailsModal key={`${selected.id}-${selection?.removing}`} task={selected} initialRemoving={selection?.removing} onClose={() => setSelection(null)} />}
    </section>
  );
}
