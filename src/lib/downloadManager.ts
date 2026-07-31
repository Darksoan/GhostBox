import { ghostboxApi } from "./ghostboxApi";
import type { GhostBoxGame } from "../data";
import { gameSteamHeaderFirstSources, getGameAppId } from "../utils/image";
import { readStoredDownloadParallelChunks } from "../utils/storage";

export type DownloadTaskStatus = "queued" | "downloading" | "paused" | "completed" | "error";

export type DownloadTask = {
  id: string;
  appId: string;
  title: string;
  coverUrl: string;
  /**
   * Steam header-art candidates (wide 460x215), best-first — same list the
   * profile overview cards use. Plain CDN URLs, so they survive persistence.
   */
  headerSources: string[];
  downloadsRoot: string;
  outputDir: string;
  status: DownloadTaskStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  depotIndex: number;
  depotTotal: number;
  depotStatus?: string;
  bytesDownloaded: number;
  bytesTotal: number;
  speedBytesPerSecond: number;
  estimatedSecondsRemaining?: number;
  lastProgressAt?: number;
  lastProgressBytes?: number;
  speedSamples?: number[];
  resumePending?: boolean;
  resumeBytesFloor?: number;
  totalBytesDownloaded?: number;
  totalBytesAll?: number;
  failedFiles?: number;
  errorMessage?: string;
};

const storageKey = "ghostbox:download-tasks:v1";
const maxStoredHistory = 50;
export const downloadTasksChangedEvent = "ghostbox:download-tasks-changed";

let liveTasks: DownloadTask[] = [];
let liveTasksHydrated = false;
let activeAppId: string | null = null;
let activeControlIntent: "pause" | "cancel" | null = null;
let activeDeletionRequest: {
  task: DownloadTask;
  resolve: () => void;
  reject: (error: Error) => void;
} | null = null;
let engineStarted = false;
let cachedHistoryTasks: DownloadTask[] | null = null;
let storedTasksWriteTimer: number | null = null;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function downloadRootFromOutputDir(outputDir: string): string {
  const separatorIndex = Math.max(outputDir.lastIndexOf("\\"), outputDir.lastIndexOf("/"));
  return separatorIndex > 0 ? outputDir.slice(0, separatorIndex) : "";
}

function normalizeTask(value: unknown): DownloadTask | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<DownloadTask> & Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (typeof item.appId !== "string" || !item.appId.trim()) return null;
  if (typeof item.title !== "string") return null;
  if (
    item.status !== "queued" &&
    item.status !== "downloading" &&
    item.status !== "paused" &&
    item.status !== "completed" &&
    item.status !== "error"
  ) return null;
  if (!isFiniteNumber(item.queuedAt)) return null;
  const status = item.status === "downloading" ? "paused" : item.status;

  return {
    id: item.id,
    appId: item.appId,
    title: item.title,
    coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : "",
    headerSources: Array.isArray(item.headerSources)
      ? item.headerSources.filter(
          (source): source is string => typeof source === "string" && source.length > 0,
        )
      : [],
    downloadsRoot: typeof item.downloadsRoot === "string"
      ? item.downloadsRoot
      : downloadRootFromOutputDir(typeof item.outputDir === "string" ? item.outputDir : ""),
    outputDir: typeof item.outputDir === "string" ? item.outputDir : "",
    status,
    queuedAt: item.queuedAt,
    startedAt: isFiniteNumber(item.startedAt) ? item.startedAt : undefined,
    finishedAt: isFiniteNumber(item.finishedAt) ? item.finishedAt : undefined,
    depotIndex: isFiniteNumber(item.depotIndex) ? item.depotIndex : 0,
    depotTotal: isFiniteNumber(item.depotTotal) ? item.depotTotal : 0,
    bytesDownloaded: isFiniteNumber(item.bytesDownloaded) ? item.bytesDownloaded : 0,
    bytesTotal: isFiniteNumber(item.bytesTotal) ? item.bytesTotal : 0,
    speedBytesPerSecond: 0,
    estimatedSecondsRemaining: isFiniteNumber(item.estimatedSecondsRemaining)
      ? item.estimatedSecondsRemaining
      : undefined,
    resumePending: item.resumePending === true,
    resumeBytesFloor: isFiniteNumber(item.resumeBytesFloor)
      ? item.resumeBytesFloor
      : undefined,
    totalBytesDownloaded: isFiniteNumber(item.totalBytesDownloaded)
      ? item.totalBytesDownloaded
      : undefined,
    totalBytesAll: isFiniteNumber(item.totalBytesAll) ? item.totalBytesAll : undefined,
    failedFiles: isFiniteNumber(item.failedFiles) ? item.failedFiles : undefined,
    errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : undefined,
  };
}

function readStoredTasks(): DownloadTask[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeTask)
      .filter((task): task is DownloadTask => task !== null);
  } catch {
    return [];
  }
}

function readInitialLiveTasks(): DownloadTask[] {
  return readStoredTasks().filter(
    (task) => task.status === "queued" || task.status === "paused",
  );
}

function ensureLiveTasksHydrated() {
  if (liveTasksHydrated) return;
  liveTasksHydrated = true;
  liveTasks = readInitialLiveTasks();
}

function readHistoryTasks(): DownloadTask[] {
  if (cachedHistoryTasks !== null) return cachedHistoryTasks;
  cachedHistoryTasks = readStoredTasks()
    .filter((task) => task.status === "completed" || task.status === "error")
    .slice(0, maxStoredHistory);
  return cachedHistoryTasks;
}

function writeHistoryTasks(tasks: DownloadTask[]) {
  if (typeof window !== "undefined" && storedTasksWriteTimer !== null) {
    window.clearTimeout(storedTasksWriteTimer);
    storedTasksWriteTimer = null;
  }
  writeStoredTasks(liveTasks, tasks.slice(0, maxStoredHistory));
}

function writeStoredTasks(live: DownloadTask[], history: DownloadTask[] = readHistoryTasks()) {
  if (typeof window === "undefined") return;

  try {
    const liveIds = new Set(live.map((task) => task.id));
    const storedHistory = history
      .filter((task) => !liveIds.has(task.id))
      .slice(0, maxStoredHistory);
    window.localStorage.setItem(storageKey, JSON.stringify([...live, ...storedHistory]));
    cachedHistoryTasks = storedHistory;
  } catch {
    // History is best-effort only.
  }
}

function scheduleStoredTasksWrite() {
  if (typeof window === "undefined") return;
  if (storedTasksWriteTimer !== null) return;

  storedTasksWriteTimer = window.setTimeout(() => {
    storedTasksWriteTimer = null;
    writeStoredTasks(liveTasks);
  }, 2000);
}

function flushStoredTasks() {
  if (typeof window === "undefined") return;
  if (storedTasksWriteTimer !== null) {
    window.clearTimeout(storedTasksWriteTimer);
    storedTasksWriteTimer = null;
  }
  writeStoredTasks(liveTasks);
}

function notifyChanged(immediate = false) {
  if (typeof window === "undefined") return;
  if (immediate) flushStoredTasks();
  else scheduleStoredTasksWrite();
  window.dispatchEvent(new CustomEvent(downloadTasksChangedEvent));
}

async function deleteDownloadOutputDir(task: DownloadTask) {
  if (!task.outputDir.trim() || !task.downloadsRoot.trim()) {
    throw new Error("Download folder is unavailable.");
  }
  await ghostboxApi.deleteDownloadOutputDir(task.appId, task.downloadsRoot, task.outputDir);
}

export function readDownloadTasks(): DownloadTask[] {
  ensureLiveTasksHydrated();
  const liveIds = new Set(liveTasks.map((task) => task.id));
  return [...liveTasks, ...readHistoryTasks().filter((task) => !liveIds.has(task.id))];
}

export function getActiveDownloadCount(): number {
  ensureLiveTasksHydrated();
  return liveTasks.filter(
    (task) => task.status === "queued" || task.status === "downloading",
  ).length;
}

function updateLiveTask(appId: string, patch: Partial<DownloadTask>, immediate = false) {
  ensureLiveTasksHydrated();
  const index = liveTasks.findIndex((task) => task.appId === appId);
  if (index === -1) return;
  liveTasks = liveTasks.map((task, taskIndex) =>
    taskIndex === index ? { ...task, ...patch } : task,
  );
  notifyChanged(immediate);
}

function removeLiveTask(appId: string) {
  ensureLiveTasksHydrated();
  liveTasks = liveTasks.filter((task) => task.appId !== appId);
}

function archiveTask(task: DownloadTask) {
  ensureLiveTasksHydrated();
  removeLiveTask(task.appId);
  const history = readHistoryTasks().filter((entry) => entry.id !== task.id);
  writeHistoryTasks([task, ...history]);
}

function startNextQueuedTask() {
  ensureLiveTasksHydrated();
  if (activeAppId !== null) return;
  const next = liveTasks.find((task) => task.status === "queued");
  if (!next) return;

  activeAppId = next.appId;
  activeControlIntent = null;
  updateLiveTask(next.appId, { status: "downloading", startedAt: Date.now() }, true);

  ghostboxApi
    .downloadDepotGame(next.appId, next.outputDir, undefined, readStoredDownloadParallelChunks())
    .then((result) => void finishActiveTask(result))
    .catch((error: unknown) =>
      void finishActiveTask({
        Type: "error",
        Message: error instanceof Error ? error.message : String(error),
      }),
    );
}

async function finishActiveTask(result: Record<string, unknown>) {
  const appId = activeAppId;
  const controlIntent = activeControlIntent;
  const deletionRequest = activeDeletionRequest;
  activeAppId = null;
  activeControlIntent = null;
  activeDeletionRequest = null;
  if (appId === null) return;

  const task = liveTasks.find((entry) => entry.appId === appId);
  if (!task) {
    if (controlIntent === "cancel" && deletionRequest) {
      try {
        await deleteDownloadOutputDir(deletionRequest.task);
        deletionRequest.resolve();
      } catch (error) {
        deletionRequest.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    startNextQueuedTask();
    return;
  }

  if (controlIntent === "pause") {
    if (task.resumePending) {
      updateLiveTask(appId, {
        status: "queued",
        speedBytesPerSecond: 0,
        depotStatus: undefined,
      }, true);
      startNextQueuedTask();
      return;
    }
    updateLiveTask(appId, {
      status: "paused",
      speedBytesPerSecond: 0,
      depotStatus: "paused",
    }, true);
    startNextQueuedTask();
    return;
  }

  if (controlIntent === "cancel" || result.Type === "cancelled") {
    try {
      await deleteDownloadOutputDir(deletionRequest?.task ?? task);
      removeLiveTask(appId);
      notifyChanged(true);
      deletionRequest?.resolve();
    } catch (error) {
      const deletionError = error instanceof Error ? error : new Error(String(error));
      archiveTask({
        ...task,
        status: "error",
        finishedAt: Date.now(),
        speedBytesPerSecond: 0,
        errorMessage: deletionError.message,
      });
      notifyChanged(true);
      deletionRequest?.reject(deletionError);
    }
    startNextQueuedTask();
    return;
  }

  const depots = Array.isArray(result.Depots)
    ? (result.Depots as Record<string, unknown>[])
    : [];
  const topLevelFailed = result.Type === "error";
  const anyDepotFailed = depots.some((depot) => depot.Type === "error");

  let totalBytesDownloaded = 0;
  let totalBytesAll = 0;
  let failedFiles = 0;
  for (const depot of depots) {
    totalBytesDownloaded += isFiniteNumber(depot.DownloadedBytes) ? depot.DownloadedBytes : 0;
    totalBytesAll += isFiniteNumber(depot.BytesTotal) ? depot.BytesTotal : 0;
    failedFiles += isFiniteNumber(depot.FailedFiles) ? depot.FailedFiles : 0;
  }

  const failedDepotMessage = depots.find(
    (depot) => depot.Type === "error" && typeof depot.Message === "string",
  )?.Message as string | undefined;

  const finished: DownloadTask = {
    ...task,
    status: topLevelFailed || anyDepotFailed ? "error" : "completed",
    finishedAt: Date.now(),
    totalBytesDownloaded,
    totalBytesAll,
    failedFiles,
    resumePending: false,
    resumeBytesFloor: undefined,
    errorMessage: typeof result.Message === "string" ? result.Message : failedDepotMessage,
  };

  archiveTask(finished);
  notifyChanged(true);
  startNextQueuedTask();
}

export function enqueueDownload(
  game: GhostBoxGame,
  outputDir: string,
  downloadsRoot = downloadRootFromOutputDir(outputDir),
) {
  ensureLiveTasksHydrated();
  const appId = getGameAppId(game);
  if (!appId) return;
  if (liveTasks.some((task) => task.appId === appId)) return;

  liveTasks = [
    ...liveTasks,
    {
      id: appId,
      appId,
      title: game.title,
      coverUrl: game.coverUrl,
      headerSources: gameSteamHeaderFirstSources(game),
      downloadsRoot,
      outputDir,
      status: "queued",
      queuedAt: Date.now(),
      depotIndex: 0,
      depotTotal: 0,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speedBytesPerSecond: 0,
    },
  ];
  notifyChanged(true);
  startNextQueuedTask();
}

export function removeDownloadTask(id: string) {
  ensureLiveTasksHydrated();
  const historyBefore = readHistoryTasks();
  const nextHistory = historyBefore.filter((task) => task.id !== id);
  if (nextHistory.length !== historyBefore.length) {
    writeHistoryTasks(nextHistory);
    notifyChanged(true);
    return;
  }

  const liveTask = liveTasks.find((task) => task.id === id);
  if (liveTask && liveTask.status === "queued") {
    removeLiveTask(id);
    notifyChanged(true);
  }
}

export function pauseDownloadTask(id: string) {
  ensureLiveTasksHydrated();
  const task = liveTasks.find((entry) => entry.id === id);
  if (!task) return;

  if (task.status === "queued") {
    updateLiveTask(task.appId, { status: "paused", speedBytesPerSecond: 0 }, true);
    return;
  }

  if (task.status !== "downloading" || activeAppId !== task.appId) return;
  activeControlIntent = "pause";
  updateLiveTask(task.appId, { status: "paused", speedBytesPerSecond: 0 }, true);
  void ghostboxApi.cancelDepotGame(task.appId);
}

export function resumeDownloadTask(id: string) {
  ensureLiveTasksHydrated();
  const task = liveTasks.find((entry) => entry.id === id);
  if (!task || task.status !== "paused") return;

  if (activeAppId === task.appId && activeControlIntent === "pause") {
    updateLiveTask(task.appId, {
      resumePending: true,
      resumeBytesFloor: task.bytesDownloaded,
    }, true);
    return;
  }

  updateLiveTask(task.appId, {
    status: "queued",
    depotStatus: undefined,
    resumePending: true,
    resumeBytesFloor: task.bytesDownloaded,
  }, true);
  startNextQueuedTask();
}

export async function deleteDownloadTaskFiles(id: string): Promise<void> {
  ensureLiveTasksHydrated();
  const task = liveTasks.find((entry) => entry.id === id);
  if (!task) {
    const historyTask = readHistoryTasks().find((entry) => entry.id === id);
    if (!historyTask) return;
    await deleteDownloadOutputDir(historyTask);
    writeHistoryTasks(readHistoryTasks().filter((entry) => entry.id !== id));
    notifyChanged(true);
    return;
  }

  if (task.status === "downloading" && activeAppId === task.appId) {
    if (activeDeletionRequest) {
      throw new Error("Download removal is already in progress.");
    }
    activeControlIntent = "cancel";
    updateLiveTask(task.appId, { speedBytesPerSecond: 0, depotStatus: "cancelling" }, true);
    return new Promise<void>((resolve, reject) => {
      activeDeletionRequest = { task, resolve, reject };
      void ghostboxApi.cancelDepotGame(task.appId)
        .then((cancelled) => {
          if (cancelled) return;
          activeDeletionRequest = null;
          activeControlIntent = null;
          updateLiveTask(task.appId, {
            status: "downloading",
            depotStatus: task.depotStatus,
          }, true);
          reject(new Error("Could not stop the active download."));
        })
        .catch((error: unknown) => {
          activeDeletionRequest = null;
          activeControlIntent = null;
          updateLiveTask(task.appId, {
            status: "downloading",
            depotStatus: task.depotStatus,
          }, true);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  await deleteDownloadOutputDir(task);
  removeLiveTask(task.appId);
  notifyChanged(true);
  startNextQueuedTask();
}

export function cancelDownloadTask(id: string) {
  void deleteDownloadTaskFiles(id).catch(() => undefined);
}

export function clearFinishedDownloadTasks() {
  ensureLiveTasksHydrated();
  writeHistoryTasks([]);
  notifyChanged(true);
}

function eventAppId(payload: Record<string, unknown>): string {
  return typeof payload.AppId === "string" ? payload.AppId : String(payload.AppId ?? "");
}

function applyProgressEvent(payload: Record<string, unknown>) {
  if (!payload || typeof payload !== "object") return;

  const appId = activeAppId;
  if (appId === null) return;

  const type = typeof payload.Type === "string" ? payload.Type : "";
  const status = typeof payload.Status === "string" ? payload.Status : "";

  if (type === "status" && status === "depot-plan") {
    if (eventAppId(payload) !== appId) return;
    const patch: Partial<DownloadTask> = {
      depotTotal: isFiniteNumber(payload.DepotTotal) ? payload.DepotTotal : 0,
    };
    if (isFiniteNumber(payload.TotalBytes) && payload.TotalBytes > 0) {
      patch.bytesTotal = payload.TotalBytes;
    }
    updateLiveTask(appId, patch);
    return;
  }

  if (type === "status" && status === "starting-depot") {
    if (eventAppId(payload) !== appId) return;
    const task = liveTasks.find((entry) => entry.appId === appId);
    const isResuming = task?.resumePending === true;
    const hasAggregatePlan = (task?.depotTotal ?? 0) > 0 && (task?.bytesTotal ?? 0) > 0;
    const patch: Partial<DownloadTask> = {
      depotIndex: isResuming
        ? Math.max(1, task?.depotIndex ?? 0)
        : (task?.depotIndex ?? 0) + 1,
      depotStatus: status,
      speedBytesPerSecond: 0,
      estimatedSecondsRemaining: undefined,
      lastProgressAt: undefined,
      lastProgressBytes: undefined,
      speedSamples: [],
      resumePending: false,
    };
    if (!isResuming && !hasAggregatePlan) {
      patch.bytesDownloaded = 0;
      patch.bytesTotal = 0;
    }
    updateLiveTask(appId, patch);
    return;
  }

  if (type === "status") {
    const patch: Partial<DownloadTask> = { depotStatus: status };
    if (status === "manifest-loaded" && isFiniteNumber(payload.TotalBytes)) {
      patch.bytesTotal = payload.TotalBytes;
    }
    updateLiveTask(appId, patch);
    return;
  }

  if (type === "progress") {
    const task = liveTasks.find((entry) => entry.appId === appId);
    const incomingBytes = isFiniteNumber(payload.BytesDownloaded)
      ? payload.BytesDownloaded
      : 0;
    const resumeBytesFloor = task?.resumeBytesFloor;
    const isResumeRecovered =
      typeof resumeBytesFloor === "number" && incomingBytes >= resumeBytesFloor;
    const incomingTotal = isFiniteNumber(payload.BytesTotal) ? payload.BytesTotal : 0;
    const displayedBytes =
      typeof resumeBytesFloor === "number"
        ? Math.max(incomingBytes, resumeBytesFloor)
        : incomingBytes;
    const now = Date.now();
    const lastProgressAt = task?.lastProgressAt;
    const lastProgressBytes = task?.lastProgressBytes;
    const elapsedSeconds = lastProgressAt
      ? Math.max(0, (now - lastProgressAt) / 1000)
      : 0;
    const progressedBytes = typeof lastProgressBytes === "number"
      ? Math.max(0, displayedBytes - lastProgressBytes)
      : 0;
    const canSample =
      !isResumeRecovered &&
      typeof lastProgressBytes === "number" &&
      elapsedSeconds >= 1 &&
      progressedBytes > 0;

    let speedSamples = task?.speedSamples ?? [];
    let smoothedSpeed = task?.speedBytesPerSecond ?? 0;
    let estimatedSecondsRemaining = task?.estimatedSecondsRemaining;
    let nextSampleAt = lastProgressAt;
    let nextSampleBytes = lastProgressBytes;

    if (canSample) {
      const observedSpeed = progressedBytes / elapsedSeconds;
      speedSamples = [...speedSamples, observedSpeed].slice(-7);
      const orderedSamples = [...speedSamples].sort((left, right) => left - right);
      const conservativeSample = orderedSamples[
        Math.floor((orderedSamples.length - 1) * 0.25)
      ];
      smoothedSpeed = smoothedSpeed > 0
        ? smoothedSpeed * 0.65 + conservativeSample * 0.35
        : conservativeSample;

      const remainingBytes = Math.max(0, incomingTotal - displayedBytes);
      const instantEta = smoothedSpeed > 0
        ? (remainingBytes / smoothedSpeed) * 1.1
        : undefined;
      const previousEta = task?.estimatedSecondsRemaining;
      const predictedPreviousEta = typeof previousEta === "number"
        ? Math.max(0, previousEta - elapsedSeconds)
        : undefined;
      estimatedSecondsRemaining = typeof instantEta === "number"
        ? typeof predictedPreviousEta === "number"
          ? predictedPreviousEta * 0.6 + instantEta * 0.4
          : instantEta
        : undefined;
      nextSampleAt = now;
      nextSampleBytes = displayedBytes;
    } else if (
      typeof lastProgressAt !== "number" ||
      typeof lastProgressBytes !== "number" ||
      isResumeRecovered
    ) {
      speedSamples = [];
      smoothedSpeed = 0;
      estimatedSecondsRemaining = undefined;
      nextSampleAt = now;
      nextSampleBytes = displayedBytes;
    }

    updateLiveTask(appId, {
      bytesDownloaded: displayedBytes,
      bytesTotal: incomingTotal,
      speedBytesPerSecond: smoothedSpeed,
      estimatedSecondsRemaining,
      lastProgressAt: nextSampleAt,
      lastProgressBytes: nextSampleBytes,
      speedSamples,
      resumeBytesFloor: isResumeRecovered ? undefined : resumeBytesFloor,
    });
    return;
  }

  if (type === "error") {
    const message = typeof payload.Message === "string" ? payload.Message : undefined;
    updateLiveTask(appId, { errorMessage: message, depotStatus: status || "error" }, true);
  }
}

export function startDownloadManager(): () => void {
  if (engineStarted) return () => undefined;
  engineStarted = true;

  const unlisten = ghostboxApi.onDownloadProgress(applyProgressEvent);

  return () => {
    engineStarted = false;
    unlisten();
    flushStoredTasks();
  };
}
