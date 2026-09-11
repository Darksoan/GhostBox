import { ArrowDown, ArrowUp, FolderOpen, LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EmptyState } from "../components/ui/LoadingStates";
import { DownloadDeleteConfirmModal } from "../components/modals/DownloadDeleteConfirmModal";
import { useSettings } from "../context/settings";
import { useOverlay } from "../context/OverlayContext";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import {
  downloadTasksChangedEvent,
  deleteDownloadTaskFiles,
  readDownloadTasks,
  pauseDownloadTask,
  resumeDownloadTask,
  reorderQueuedTasks,
  reorderPausedTasks,
  reorderHistoryTasks,
  type DownloadTask,
} from "../lib/downloadManager";
import { ghostboxApi } from "../lib/ghostboxApi";
import { formatBytes, formatSpeed } from "../utils/formatBytes";
import { layeredImageStyle } from "../utils/image";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";

const emptyImageSources: string[] = [];
const rememberedDownloadCovers = new Map<string, string>();

function primaryDownloadTask(tasks: DownloadTask[]) {
  return tasks.find((task) => task.status === "downloading")
    ?? tasks.find((task) => task.status === "queued")
    ?? tasks.find((task) => task.status === "paused")
    ?? null;
}

function downloadCardElement(id: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-download-id]"))
    .find((element) => element.dataset.downloadId === id) ?? null;
}

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
  onRequestDelete,
  reorderIndex,
  reorderCount,
  onMove,
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onRequestDelete: (task: DownloadTask) => void;
  reorderIndex: number;
  reorderCount: number;
  onMove: (direction: "up" | "down") => void;
}) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const [launching, setLaunching] = useState(false);
  const launchInFlight = useRef(false);
  const [displayTitle, setDisplayTitle] = useState(task.title);
  useEffect(() => {
    if (!isSteamTitlePlaceholder(task.title, task.appId)) {
      setDisplayTitle(task.title);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const details =
          (await ghostboxApi.getGameDetails(task.appId).catch(() => null)) ??
          (await ghostboxApi
            .getGameStoreDetails(task.appId, appearance.language)
            .catch(() => null));
        if (
          !cancelled &&
          details?.title &&
          !isSteamTitlePlaceholder(details.title, task.appId)
        ) {
          setDisplayTitle(details.title);
          return;
        }
        if (cancelled) return;
        try {
          const result = await ghostboxApi.getGames({
            query: task.appId,
            limit: 5,
          });
          const match = result.games.find(
            (game) =>
              game.appId === task.appId &&
              !isSteamTitlePlaceholder(game.title, game.appId),
          );
          if (!cancelled && match) setDisplayTitle(match.title);
        } catch {}
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [task.appId, task.title, appearance.language]);
  const headerSources = useMemo(() => {
    const appId = task.appId;
    return {
      highDensity: [
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
        `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header_2x.jpg`,
      ],
      fallback: [
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        ...task.headerSources,
      ],
    };
  }, [task.appId, task.headerSources]);
  const highDensitySources = useCachedImageSources(headerSources.highDensity);
  const fallbackSources = useCachedImageSources(headerSources.fallback);
  const coverSources = useMemo(
    () => [...highDensitySources, ...fallbackSources],
    [highDensitySources, fallbackSources],
  );
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(coverSources);
  useLayoutEffect(() => {
    if (headerLoaded && headerSource) {
      rememberedDownloadCovers.set(task.id, headerSource);
    }
  }, [headerLoaded, headerSource, task.id]);
  const visibleHeaderSource = headerLoaded && headerSource
    ? headerSource
    : rememberedDownloadCovers.get(task.id) ?? "";
  const isCompleted = task.status === "completed";
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const progressPercent = isCompleted ? 100 :
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

  const metaItems = (
    showsProgress
      ? [
          `${formatBytes(task.bytesDownloaded)} / ${task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"}`,
          task.status === "downloading" ? etaLabel : "",
          task.status === "downloading" ? formatSpeed(task.speedBytesPerSecond) : "",
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

  const handleOpenFolder = async () => {
    if (!task.outputDir) return;
    try {
      await ghostboxApi.revealDownloadFolder(task.outputDir);
    } catch {
      showToast(t("downloads.openFolder"), t("downloads.openFolderError"), "error");
    }
  };

  const handleLaunch = async () => {
    if (!isCompleted || launchInFlight.current) return;
    launchInFlight.current = true;
    setLaunching(true);
    try {
      await ghostboxApi.launchDownloadedGame(
        task.appId, displayTitle, task.downloadsRoot, task.outputDir, task.installDir,
      );
    } catch {
      showToast(t("downloads.launch"), t("downloads.launchError"), "error");
    } finally {
      launchInFlight.current = false;
      setLaunching(false);
    }
  };

  return (
    <section
      className={`downloads-hero downloads-hero--${task.status}`}
      aria-label={displayTitle}
      data-download-id={task.id}
    >
      <span
        className={`downloads-hero__cover${visibleHeaderSource ? " downloads-hero__cover--loaded" : ""}`}
        style={layeredImageStyle(visibleHeaderSource ? [visibleHeaderSource] : emptyImageSources, "")}
        aria-hidden="true"
      />
      <div className="downloads-hero__content">
        <div className="downloads-hero__top">
          <strong className="downloads-hero__title">{displayTitle}</strong>
          {(showsProgress || isCompleted) && (
            <span className="downloads-hero__percent">{progressPercent}%</span>
          )}
        </div>

        <div className="downloads-hero__middle">
          {statusLabel && <span className="downloads-hero__status-text">{statusLabel}</span>}
          {metaItems.length > 0 && (
            <span className="downloads-hero__meta">
              {metaItems.map((item) => (
                <span key={item} className="downloads-hero__meta-item">{item}</span>
              ))}
            </span>
          )}
        </div>

        <div className="downloads-hero__controls">
          {(showsProgress || isCompleted) && (
            <span className="downloads-hero__progress-track" role="progressbar"
              aria-label={t("downloads.details.progress")}
              aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${progressPercent / 100})` }} />
            </span>
          )}
          <div className="downloads-hero__actions">
            {(canPause || canResume) && (
              <button type="button" className="downloads-hero__action downloads-hero__toggle"
                onClick={() => canPause ? pauseDownloadTask(task.id) : resumeDownloadTask(task.id)}
                aria-label={t(canPause ? "downloads.pause" : "downloads.resume")}>
                <Pause size={18} strokeWidth={2} data-active={canPause} aria-hidden="true" />
                <Play size={18} strokeWidth={2} data-active={canResume} aria-hidden="true" />
              </button>
            )}
            {isCompleted && (
              <button type="button" className="downloads-hero__action"
                onClick={handleLaunch} disabled={launching}
                aria-label={t("downloads.launch")} aria-busy={launching}>
                {launching
                  ? <LoaderCircle size={18} strokeWidth={2} className="downloads-hero__launch-spinner" aria-hidden="true" />
                  : <Play size={18} strokeWidth={2} aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="downloads-hero__action"
              onClick={handleOpenFolder} disabled={!task.outputDir}
              aria-label={t("downloads.openFolder")}>
              <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="downloads-hero__action downloads-hero__action--danger"
              onClick={() => onRequestDelete(task)}
              aria-label={t("downloads.remove")}>
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            {reorderCount > 1 && (
              <>
                <button type="button" className="downloads-hero__action"
                  onClick={() => onMove("up")} disabled={reorderIndex <= 0}
                  aria-label={t("downloads.moveUp")}>
                  <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
                </button>
                <button type="button" className="downloads-hero__action"
                  onClick={() => onMove("down")} disabled={reorderIndex >= reorderCount - 1}
                  aria-label={t("downloads.moveDown")}>
                  <ArrowDown size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {task.staleManifest && (
        <span className="downloads-hero__stale" onClick={(event) => event.stopPropagation()}>
          <span className="downloads-hero__stale-detail">
            {t("downloads.staleManifestDetail", {
              depots: task.staleManifest.depots.map((depot) => depot.depotId).join(", "),
              buildId: task.staleManifest.publicBuildId || "--",
            })}
          </span>
        </span>
      )}
    </section>
  );
}

export function DownloadsPage() {
  const { t } = useSettings();
  const [tasks, setTasks] = useState<DownloadTask[]>(() => readDownloadTasks());
  const tasksRef = useRef(tasks);
  const [deleteTarget, setDeleteTarget] = useState<DownloadTask | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => {
    const nextTasks = readDownloadTasks();
    const currentHeroId = primaryDownloadTask(tasksRef.current)?.id;
    const nextHeroId = primaryDownloadTask(nextTasks)?.id;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.classList.contains("no-animations");

    if (currentHeroId === nextHeroId || reduceMotion) {
      tasksRef.current = nextTasks;
      setTasks(nextTasks);
      return;
    }

    const previousRect = nextHeroId
      ? downloadCardElement(nextHeroId)?.getBoundingClientRect()
      : null;
    tasksRef.current = nextTasks;
    flushSync(() => setTasks(nextTasks));

    const nextCard = nextHeroId ? downloadCardElement(nextHeroId) : null;
    if (!previousRect || !nextCard) return;

    const nextRect = nextCard.getBoundingClientRect();
    const styles = getComputedStyle(document.documentElement);
    const durationSeconds = Number.parseFloat(styles.getPropertyValue("--motion-slow"));
    nextCard.animate(
      [
        { transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: Number.isFinite(durationSeconds) ? durationSeconds * 1000 : 300,
        easing: styles.getPropertyValue("--ease-out").trim() || "ease-out",
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [refresh]);

  // Primeiro card = download ativo; demais downloads seguem nas listas abaixo.
  const activeDownloading = tasks.find((t) => t.status === "downloading") ?? null;
  const firstQueued = tasks.filter((t) => t.status === "queued")[0] ?? null;
  const firstPaused = tasks.filter((t) => t.status === "paused")[0] ?? null;
  const heroTask = activeDownloading ?? firstQueued ?? firstPaused ?? null;

  const allQueuedTasks = tasks.filter((t) => t.status === "queued");
  const allPausedTasks = tasks.filter((t) => t.status === "paused");
  const queuedTasks = allQueuedTasks.filter((t) => t.id !== heroTask?.id);
  const pausedTasks = allPausedTasks.filter((t) => t.id !== heroTask?.id);
  const historyTasks = tasks.filter((t) => t.status === "completed" || t.status === "error");

  const handleMove = useCallback((task: DownloadTask, direction: "up" | "down") => {
    const group = task.status === "queued"
      ? tasks.filter((entry) => entry.status === "queued")
      : task.status === "paused"
        ? tasks.filter((entry) => entry.status === "paused")
        : task.status === "completed" || task.status === "error"
          ? tasks.filter((entry) => entry.status === "completed" || entry.status === "error")
          : [];
    const currentIndex = group.findIndex((entry) => entry.id === task.id);
    const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= group.length) return;

    if (task.status === "queued") reorderQueuedTasks(task.id, targetIndex);
    else if (task.status === "paused") reorderPausedTasks(task.id, targetIndex);
    else reorderHistoryTasks(task.id, targetIndex);
  }, [tasks]);

  const requestDelete = useCallback((task: DownloadTask) => {
    setDeleteError("");
    setDeleteTarget(task);
  }, []);

  const cancelDelete = useCallback(() => {
    if (!deleting) setDeleteTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteDownloadTaskFiles(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("downloads.details.deleteError"));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, t]);

  const hasAnyTasks = tasks.length > 0;

  return (
    <section className="downloads-page content-section content-section--full">
      {hasAnyTasks ? (
        <div className="downloads-page__stack">
          {heroTask && (
            <div className="downloads-page__hero-drop">
              <DownloadsHero
                task={heroTask}
                queuePosition={heroTask.status === "queued" ? 1 : null}
                onRequestDelete={requestDelete}
                reorderIndex={heroTask.status === "queued"
                  ? allQueuedTasks.findIndex((task) => task.id === heroTask.id)
                  : heroTask.status === "paused"
                    ? allPausedTasks.findIndex((task) => task.id === heroTask.id)
                    : 0}
                reorderCount={heroTask.status === "queued"
                  ? allQueuedTasks.length
                  : heroTask.status === "paused"
                    ? allPausedTasks.length
                    : 1}
                onMove={(direction) => handleMove(heroTask, direction)}
              />
            </div>
          )}

          {queuedTasks.length > 0 && (
            <div className="downloads-page__section">
              <div className="downloads-page__list">
                {queuedTasks.map((task) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={allQueuedTasks.findIndex((entry) => entry.id === task.id) + 1}
                    onRequestDelete={requestDelete}
                    reorderIndex={allQueuedTasks.findIndex((entry) => entry.id === task.id)}
                    reorderCount={allQueuedTasks.length}
                    onMove={(direction) => handleMove(task, direction)}
                  />
                ))}
              </div>
            </div>
          )}

          {pausedTasks.length > 0 && (
            <div className="downloads-page__section">
              <div className="downloads-page__list">
                {pausedTasks.map((task) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={null}
                    onRequestDelete={requestDelete}
                    reorderIndex={allPausedTasks.findIndex((entry) => entry.id === task.id)}
                    reorderCount={allPausedTasks.length}
                    onMove={(direction) => handleMove(task, direction)}
                  />
                ))}
              </div>
            </div>
          )}

          {historyTasks.length > 0 && (
            <div className="downloads-page__section">
              <div className="downloads-page__list">
                {historyTasks.map((task, index) => (
                  <DownloadsHero
                    key={task.id}
                    task={task}
                    queuePosition={null}
                    onRequestDelete={requestDelete}
                    reorderIndex={index}
                    reorderCount={historyTasks.length}
                    onMove={(direction) => handleMove(task, direction)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState className="downloads-page__empty" title={t("downloads.emptyTitle")} />
      )}
      <DownloadDeleteConfirmModal
        open={Boolean(deleteTarget)}
        gameTitle={deleteTarget?.title ?? ""}
        deleting={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </section>
  );
}
