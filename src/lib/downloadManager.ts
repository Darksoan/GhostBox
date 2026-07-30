import { ghostboxApi } from "./ghostboxApi";
import type { GhostBoxGame } from "../data";
import { gameSteamHeaderFirstSources, getGameAppId } from "../utils/image";

export type DownloadTaskStatus = "queued" | "downloading" | "completed" | "error";

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
  totalBytesDownloaded?: number;
  totalBytesAll?: number;
  failedFiles?: number;
  errorMessage?: string;
};

const storageKey = "ghostbox:download-tasks:v1";
const maxStoredHistory = 50;
export const downloadTasksChangedEvent = "ghostbox:download-tasks-changed";

let liveTasks: DownloadTask[] = [];
let activeAppId: string | null = null;
let engineStarted = false;
let cachedHistoryTasks: DownloadTask[] | null = null;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeHistoryTask(value: unknown): DownloadTask | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<DownloadTask> & Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (typeof item.appId !== "string" || !item.appId.trim()) return null;
  if (typeof item.title !== "string") return null;
  if (item.status !== "completed" && item.status !== "error") return null;
  if (!isFiniteNumber(item.queuedAt)) return null;

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
    outputDir: typeof item.outputDir === "string" ? item.outputDir : "",
    status: item.status,
    queuedAt: item.queuedAt,
    startedAt: isFiniteNumber(item.startedAt) ? item.startedAt : undefined,
    finishedAt: isFiniteNumber(item.finishedAt) ? item.finishedAt : undefined,
    depotIndex: isFiniteNumber(item.depotIndex) ? item.depotIndex : 0,
    depotTotal: isFiniteNumber(item.depotTotal) ? item.depotTotal : 0,
    bytesDownloaded: 0,
    bytesTotal: 0,
    speedBytesPerSecond: 0,
    totalBytesDownloaded: isFiniteNumber(item.totalBytesDownloaded)
      ? item.totalBytesDownloaded
      : undefined,
    totalBytesAll: isFiniteNumber(item.totalBytesAll) ? item.totalBytesAll : undefined,
    failedFiles: isFiniteNumber(item.failedFiles) ? item.failedFiles : undefined,
    errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : undefined,
  };
}

function readHistoryTasks(): DownloadTask[] {
  if (cachedHistoryTasks !== null) return cachedHistoryTasks;
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      cachedHistoryTasks = [];
      return cachedHistoryTasks;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedHistoryTasks = [];
      return cachedHistoryTasks;
    }
    cachedHistoryTasks = parsed
      .map(normalizeHistoryTask)
      .filter((task): task is DownloadTask => task !== null)
      .slice(0, maxStoredHistory);
    return cachedHistoryTasks;
  } catch {
    return [];
  }
}

function writeHistoryTasks(tasks: DownloadTask[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(tasks.slice(0, maxStoredHistory)));
    cachedHistoryTasks = tasks.slice(0, maxStoredHistory);
  } catch {
    // History is best-effort only.
  }
}

function notifyChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(downloadTasksChangedEvent));
}

export function readDownloadTasks(): DownloadTask[] {
  const liveIds = new Set(liveTasks.map((task) => task.id));
  return [...liveTasks, ...readHistoryTasks().filter((task) => !liveIds.has(task.id))];
}

export function getActiveDownloadCount(): number {
  return liveTasks.filter(
    (task) => task.status === "queued" || task.status === "downloading",
  ).length;
}

function updateLiveTask(appId: string, patch: Partial<DownloadTask>) {
  const index = liveTasks.findIndex((task) => task.appId === appId);
  if (index === -1) return;
  liveTasks = liveTasks.map((task, taskIndex) =>
    taskIndex === index ? { ...task, ...patch } : task,
  );
  notifyChanged();
}

function removeLiveTask(appId: string) {
  liveTasks = liveTasks.filter((task) => task.appId !== appId);
}

function archiveTask(task: DownloadTask) {
  removeLiveTask(task.appId);
  const history = readHistoryTasks().filter((entry) => entry.id !== task.id);
  writeHistoryTasks([task, ...history]);
}

function startNextQueuedTask() {
  if (activeAppId !== null) return;
  const next = liveTasks.find((task) => task.status === "queued");
  if (!next) return;

  activeAppId = next.appId;
  updateLiveTask(next.appId, { status: "downloading", startedAt: Date.now() });

  ghostboxApi
    .downloadDepotGame(next.appId, next.outputDir)
    .then((result) => finishActiveTask(result))
    .catch((error: unknown) =>
      finishActiveTask({
        Type: "error",
        Message: error instanceof Error ? error.message : String(error),
      }),
    );
}

function finishActiveTask(result: Record<string, unknown>) {
  const appId = activeAppId;
  activeAppId = null;
  if (appId === null) return;

  const task = liveTasks.find((entry) => entry.appId === appId);
  if (!task) {
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
    errorMessage: typeof result.Message === "string" ? result.Message : failedDepotMessage,
  };

  archiveTask(finished);
  notifyChanged();
  startNextQueuedTask();
}

export function enqueueDownload(game: GhostBoxGame, outputDir: string) {
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
  notifyChanged();
  startNextQueuedTask();
}

export function removeDownloadTask(id: string) {
  const historyBefore = readHistoryTasks();
  const nextHistory = historyBefore.filter((task) => task.id !== id);
  if (nextHistory.length !== historyBefore.length) {
    writeHistoryTasks(nextHistory);
    notifyChanged();
    return;
  }

  const liveTask = liveTasks.find((task) => task.id === id);
  if (liveTask && liveTask.status === "queued") {
    removeLiveTask(id);
    notifyChanged();
  }
}

export function clearFinishedDownloadTasks() {
  writeHistoryTasks([]);
  notifyChanged();
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
    updateLiveTask(appId, {
      depotTotal: isFiniteNumber(payload.DepotTotal) ? payload.DepotTotal : 0,
    });
    return;
  }

  if (type === "status" && status === "starting-depot") {
    if (eventAppId(payload) !== appId) return;
    const task = liveTasks.find((entry) => entry.appId === appId);
    updateLiveTask(appId, {
      depotIndex: (task?.depotIndex ?? 0) + 1,
      depotStatus: status,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speedBytesPerSecond: 0,
    });
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
    updateLiveTask(appId, {
      bytesDownloaded: isFiniteNumber(payload.BytesDownloaded) ? payload.BytesDownloaded : 0,
      bytesTotal: isFiniteNumber(payload.BytesTotal) ? payload.BytesTotal : 0,
      speedBytesPerSecond: isFiniteNumber(payload.SpeedBytesPerSecond)
        ? payload.SpeedBytesPerSecond
        : 0,
    });
    return;
  }

  if (type === "error") {
    const message = typeof payload.Message === "string" ? payload.Message : undefined;
    updateLiveTask(appId, { errorMessage: message, depotStatus: status || "error" });
  }
}

export function startDownloadManager(): () => void {
  if (engineStarted) return () => undefined;
  engineStarted = true;

  const unlisten = ghostboxApi.onDownloadProgress(applyProgressEvent);

  return () => {
    engineStarted = false;
    unlisten();
  };
}
