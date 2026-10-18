import { ghostboxApi } from "./ghostboxApi";
import type { GhostBoxGame } from "../data";
import { gameSteamHeaderFirstSources, getGameAppId } from "../utils/image";
import { isBlockedSteamDemo } from "../utils/steamAppType";
import { beginDownloadActivity, recordDownloadActivity, suspendDownloadActivity } from "./downloadActivity";

export type DownloadTaskStatus = "queued" | "downloading" | "paused" | "completed" | "error";
export type DownloadTask = {
  id: string;
  appId: string;
  title: string;
  headerSources: string[];
  downloadsRoot: string;
  outputDir: string;
  installDir?: string;
  status: DownloadTaskStatus;
  queuedAt: number;
  finishedAt?: number;
  startedAt?: number;
  bytesDownloaded: number;
  bytesTotal: number;
  speedBytesPerSecond: number;
  bytesWritten?: number;
  writeSpeedBytesPerSecond?: number;
  depotIndex: number;
  depotTotal: number;
  depotStatus?: string;
  errorMessage?: string;
  allowStale?: boolean;
  steamIntegration?: { status: string; message?: string; requiresSteamRestart?: boolean };
};

// Mesma chave da versão arquivada. Tarefas antigas são migradas sem auto-retomar.
const storageKey = "ghostbox:download-tasks:v1";
const directoryKey = "ghostbox:downloads-dir:v1";
export const downloadTasksChangedEvent = "ghostbox:download-tasks-changed";
export const downloadsDirectoryChangedEvent = "ghostbox:downloads-directory-changed";
export const downloadInstallationChangedEvent = "ghostbox:download-installation-changed";
let tasks: DownloadTask[] | undefined;
let current: { id: string; promise: Promise<void>; pauseRequested: boolean } | undefined;
let prioritizing = false;
let ready = false;
let consumers = 0;
let listenerGeneration = 0;
let stopListening: (() => void) | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let stallTimer: ReturnType<typeof setInterval> | undefined;
let listenerError: string | undefined;
let lastSample: { bytes: number; time: number; speeds: number[] } | undefined;

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function restoreDownloadTasks(value: unknown): DownloadTask[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): DownloadTask[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as DownloadTask & { totalBytesDownloaded?: number; totalBytesAll?: number };
    if (typeof item.appId !== "string" || !/^[1-9]\d*$/.test(item.appId)
      || typeof item.downloadsRoot !== "string" || !item.downloadsRoot.trim() || seen.has(item.appId)) return [];
    seen.add(item.appId);
    const status = ["completed", "error", "paused"].includes(item.status) ? item.status : "paused";
    return [{
      id: typeof item.id === "string" && item.id ? item.id : item.appId, appId: item.appId,
      title: typeof item.title === "string" ? item.title : item.appId,
      headerSources: Array.isArray(item.headerSources)
        ? item.headerSources.filter((source) => typeof source === "string") : [],
      downloadsRoot: item.downloadsRoot,
      outputDir: typeof item.outputDir === "string" ? item.outputDir : "",
      installDir: item.installDir, status,
      queuedAt: number(item.queuedAt), finishedAt: number(item.finishedAt) || undefined,
      startedAt: number(item.startedAt) || undefined,
      bytesDownloaded: number(item.totalBytesDownloaded ?? item.bytesDownloaded),
      bytesTotal: number(item.totalBytesAll) || number(item.bytesTotal),
      speedBytesPerSecond: 0, depotIndex: number(item.depotIndex), depotTotal: number(item.depotTotal),
      bytesWritten: item.bytesWritten == null ? undefined : number(item.bytesWritten),
      writeSpeedBytesPerSecond: item.writeSpeedBytesPerSecond == null ? undefined : 0,
      errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : undefined,
      depotStatus: typeof item.depotStatus === "string" ? item.depotStatus : undefined,
      allowStale: item.allowStale === true,
      steamIntegration: item.steamIntegration,
    }];
  });
}

export function readDownloadTasks(): DownloadTask[] {
  if (!tasks) {
    try { tasks = restoreDownloadTasks(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
    catch { tasks = []; }
  }
  return tasks;
}

function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  try { localStorage.setItem(storageKey, JSON.stringify(readDownloadTasks())); }
  catch { /* A fila continua na sessão se o armazenamento estiver indisponível. */ }
}

function update(id: string, patch: Partial<DownloadTask>, progress = false) {
  if (patch.status && patch.status !== "downloading") {
    suspendDownloadActivity(id);
    const knownWriteSpeed = readDownloadTasks().find((task) => task.id === id)?.writeSpeedBytesPerSecond;
    patch = { ...patch, writeSpeedBytesPerSecond: knownWriteSpeed == null ? undefined : 0 };
  }
  tasks = readDownloadTasks().map((task) => task.id === id ? { ...task, ...patch } : task);
  if (progress) {
    if (!persistTimer) persistTimer = setTimeout(persist, 1000);
  } else persist();
  window.dispatchEvent(new Event(downloadTasksChangedEvent));
}

export function readStoredDownloadsDir(): string {
  try { return localStorage.getItem(directoryKey)?.trim() ?? ""; }
  catch { return ""; }
}

export function writeStoredDownloadsDir(path: string) {
  try { localStorage.setItem(directoryKey, path.trim()); }
  catch { /* O caminho também fica na tarefa. */ }
  window.dispatchEvent(new Event(downloadsDirectoryChangedEvent));
}

export function getActiveDownloadCount(): number {
  return readDownloadTasks().filter((task) => task.status === "queued" || task.status === "downloading").length;
}

export async function enqueueDownload(game: GhostBoxGame): Promise<boolean> {
  if (listenerError) throw new Error(listenerError);
  const appId = getGameAppId(game);
  if (!/^[1-9]\d*$/.test(appId) || isBlockedSteamDemo(game)) throw new Error("Este jogo não pode ser baixado.");
  if (readDownloadTasks().some((task) => task.appId === appId)) return true;
  let downloadsRoot = readStoredDownloadsDir();
  if (!downloadsRoot) {
    downloadsRoot = await ghostboxApi.selectDownloadsDir() ?? "";
    if (!downloadsRoot) return false;
    writeStoredDownloadsDir(downloadsRoot);
  }
  // O seletor é assíncrono: um segundo clique pode ter enfileirado o mesmo jogo.
  if (readDownloadTasks().some((task) => task.appId === appId)) return true;
  tasks = [...readDownloadTasks(), {
    id: appId, appId, title: game.title,
    headerSources: gameSteamHeaderFirstSources(game), downloadsRoot, outputDir: "",
    status: "queued", queuedAt: Date.now(), bytesDownloaded: 0, bytesTotal: 0,
    speedBytesPerSecond: 0, depotIndex: 0, depotTotal: 0,
  }];
  update(appId, {});
  pump();
  return true;
}

function onProgress(event: Record<string, unknown>) {
  const task = readDownloadTasks().find((item) => item.id === current?.id);
  if (!task || String(event.AppId ?? "") !== task.appId) return;
  const patch: Partial<DownloadTask> = {};
  // Telemetria usa OutputDir para o ARQUIVO DE LOG, não para a instalação.
  if (event.Status === "depot-plan" && typeof event.OutputDir === "string") patch.outputDir = event.OutputDir;
  if (typeof event.InstallDir === "string") patch.installDir = event.InstallDir;
  if (typeof event.Status === "string") patch.depotStatus = event.Status;
  if (event.DepotIndex != null) patch.depotIndex = number(event.DepotIndex);
  if (event.DepotTotal != null) patch.depotTotal = number(event.DepotTotal);
  // O DTO do worker inclui TotalBytes=0 mesmo em status/cancelamentos.
  // Zero nesses eventos significa "não informado", não um jogo de tamanho zero.
  const reportedTotal = number(event.TotalBytes);
  if (reportedTotal > 0) patch.bytesTotal = reportedTotal;
  if (event.BytesWritten != null) patch.bytesWritten = number(event.BytesWritten);
  if (event.WriteSpeedBytesPerSecond != null) patch.writeSpeedBytesPerSecond = current?.pauseRequested ? 0 : number(event.WriteSpeedBytesPerSecond);
  if (event.Status === "starting-depot") lastSample = undefined;
  if (event.Type === "progress") {
    const bytes = number(event.BytesDownloaded);
    patch.bytesDownloaded = bytes;
    patch.bytesTotal = number(event.BytesTotal) || patch.bytesTotal || task.bytesTotal;
    const time = Date.now();
    if (lastSample && time - lastSample.time >= 350) {
      const speed = event.SpeedBytesPerSecond != null ? number(event.SpeedBytesPerSecond)
        : Math.max(0, bytes - lastSample.bytes) * 1000 / (time - lastSample.time);
      const speeds = [...lastSample.speeds, speed].slice(-8);
      const sorted = [...speeds].sort((a, b) => a - b);
      patch.speedBytesPerSecond = current?.pauseRequested ? 0 : sorted[Math.floor(sorted.length / 2)];
      lastSample = { bytes, time, speeds };
    } else if (!lastSample) {
      lastSample = { bytes, time, speeds: [] };
      if (event.SpeedBytesPerSecond != null) patch.speedBytesPerSecond = current?.pauseRequested ? 0 : number(event.SpeedBytesPerSecond);
    }
    if (!current?.pauseRequested && task.status === "downloading") {
      recordDownloadActivity(task.id, patch.speedBytesPerSecond ?? task.speedBytesPerSecond,
        patch.writeSpeedBytesPerSecond ?? task.writeSpeedBytesPerSecond);
    }
  }
  // "complete" do evento é de UM depot; só o resultado do invoke conclui o jogo.
  update(task.id, patch, true);
}

function integration(value: unknown): DownloadTask["steamIntegration"] {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  return {
    status: String(result.Status ?? "skipped"),
    message: typeof result.Message === "string" ? result.Message : undefined,
    requiresSteamRestart: result.RequiresSteamRestart === true,
  };
}

async function run(task: DownloadTask) {
  beginDownloadActivity(task);
  update(task.id, { status: "downloading", startedAt: Date.now(), errorMessage: undefined, depotStatus: "preparing", speedBytesPerSecond: 0, writeSpeedBytesPerSecond: task.writeSpeedBytesPerSecond == null ? undefined : 0 });
  lastSample = undefined;
  try {
    // O resolvedor prioriza a versão pública e usa a disponível como fallback,
    // inclusive ao retomar tarefas antigas que armazenaram allowStale=false.
    const result = await ghostboxApi.downloadDepotGame(task.appId, task.downloadsRoot, task.title, true);
    const depots = Array.isArray(result.Depots) ? result.Depots as Record<string, unknown>[] : [];
    if (current?.pauseRequested || result.Type === "cancelled") {
      const latest = readDownloadTasks().find((item) => item.id === task.id)!;
      update(task.id, { status: "paused", speedBytesPerSecond: 0, writeSpeedBytesPerSecond: 0,
        bytesTotal: number(result.TotalBytes) || latest.bytesTotal });
    } else if (result.Type !== "complete" || result.Partial === true || depots.some((depot) => depot.Type === "error" || number(depot.FailedFiles) > 0)) {
      update(task.id, {
        status: "error", speedBytesPerSecond: 0, writeSpeedBytesPerSecond: 0,
        depotStatus: String(result.Status ?? "error"),
        errorMessage: String(depots.find((depot) => depot.Type === "error")?.Message || result.Message || "Download incompleto. Tente novamente."),
      });
    } else {
      const latest = readDownloadTasks().find((item) => item.id === task.id)!;
      update(task.id, {
        status: "completed", finishedAt: Date.now(), speedBytesPerSecond: 0, writeSpeedBytesPerSecond: 0,
        bytesWritten: result.BytesWritten == null ? latest.bytesWritten : number(result.BytesWritten),
        bytesDownloaded: number(result.TotalBytes) || latest.bytesTotal,
        bytesTotal: number(result.TotalBytes) || latest.bytesTotal,
        outputDir: String(result.OutputDir || latest.outputDir), installDir: String(result.InstallDir || ""),
        steamIntegration: integration(result.SteamIntegration),
      });
      window.dispatchEvent(new Event(downloadInstallationChangedEvent));
    }
  } catch (error) {
    update(task.id, {
      status: current?.pauseRequested ? "paused" : "error", speedBytesPerSecond: 0, writeSpeedBytesPerSecond: 0,
      errorMessage: String(error),
    });
  }
}

function pump() {
  if (!ready || current || prioritizing) return;
  const task = readDownloadTasks().find((item) => item.status === "queued");
  if (!task) return;
  // Define current antes do primeiro update para impedir reentrada do listener.
  const active = { id: task.id, promise: Promise.resolve(), pauseRequested: false };
  current = active;
  active.promise = run(task).finally(() => {
    if (current === active) current = undefined;
    pump();
  });
}

export async function pauseDownloadTask(id: string): Promise<void> {
  const task = readDownloadTasks().find((item) => item.id === id);
  if (!task || task.status === "completed") return;
  if (current?.id === id) current.pauseRequested = true;
  update(id, { status: "paused", speedBytesPerSecond: 0, writeSpeedBytesPerSecond: 0 });
  if (current?.id === id) {
    const active = current;
    active.pauseRequested = true;
    try { await ghostboxApi.cancelDepotGame(task.appId); }
    catch (error) {
      // Não permitir uma nova execução enquanto a anterior ainda está viva.
      update(id, { errorMessage: String(error) });
    }
    await active.promise;
  }
}

export async function resumeDownloadTask(id: string, allowStale = false): Promise<void> {
  if (listenerError) throw new Error(listenerError);
  // Retomar espera o encerramento real do worker (incluindo o watchdog).
  if (current?.id === id) await current.promise;
  const task = readDownloadTasks().find((item) => item.id === id);
  if (!task || !["paused", "error"].includes(task.status)) return;
  update(id, { status: "queued", errorMessage: undefined, allowStale: allowStale || task.allowStale });
  pump();
}

export async function prioritizeDownloadTask(id: string): Promise<void> {
  if (listenerError) throw new Error(listenerError);
  if (prioritizing) throw new Error("Aguarde a troca do download em andamento.");
  const target = readDownloadTasks().find((task) => task.id === id);
  if (!target || target.status === "completed" || target.status === "downloading") return;
  const previousId = current?.id;
  prioritizing = true;
  try {
    // Reserva o primeiro lugar antes de cancelar o worker. O pump só volta a
    // rodar ao fim da troca, para não iniciar outro jogo entre os dois passos.
    tasks = [target, ...readDownloadTasks().filter((task) => task.id !== id)];
    update(id, { status: "queued", errorMessage: undefined });
    if (previousId) await pauseDownloadTask(previousId);
    // O download anterior permanece na fila, com os bytes já baixados intactos.
    const previous = readDownloadTasks().find((task) => task.id === previousId);
    if (previous?.status === "paused") update(previous.id, { status: "queued" });
  } finally {
    prioritizing = false;
    pump();
  }
}

export function reorderQueuedTask(id: string, direction: -1 | 1) {
  const queue = readDownloadTasks().filter((task) => task.status === "queued");
  const index = queue.findIndex((task) => task.id === id);
  const other = queue[index + direction];
  if (index < 0 || !other) return;
  const items = [...readDownloadTasks()];
  const a = items.findIndex((task) => task.id === id);
  const b = items.findIndex((task) => task.id === other.id);
  [items[a], items[b]] = [items[b], items[a]];
  tasks = items;
  update(id, {});
}

export async function deleteDownloadTask(id: string, deleteFiles: boolean) {
  const requested = readDownloadTasks().find((item) => item.id === id);
  if (!requested) return;
  // Cancelar uma instalação incompleta sempre limpa seus arquivos parciais.
  // Para uma instalação concluída, remover só o histórico não desinstala o jogo.
  const removeFiles = requested.status !== "completed" || deleteFiles;
  await pauseDownloadTask(id);
  const task = readDownloadTasks().find((item) => item.id === id);
  if (!task) return;
  if (removeFiles && task.outputDir) {
    const deleted = await ghostboxApi.deleteDownloadOutputDir(task.appId, task.downloadsRoot, task.outputDir);
    if (!deleted) throw new Error("Não foi possível remover os arquivos.");
    window.dispatchEvent(new Event(downloadInstallationChangedEvent));
  }
  tasks = readDownloadTasks().filter((item) => item.id !== id);
  update(id, {});
}

export async function repairDownloadLibrary(id: string) {
  const task = readDownloadTasks().find((item) => item.id === id);
  if (!task) return;
  const result = await ghostboxApi.registerDownloadLibrary(task.appId, task.downloadsRoot);
  update(id, {
    steamIntegration: integration(result),
    outputDir: typeof result.OutputDir === "string" ? result.OutputDir : task.outputDir,
    downloadsRoot: typeof result.DownloadsRoot === "string" ? result.DownloadsRoot : task.downloadsRoot,
  });
  window.dispatchEvent(new Event(downloadInstallationChangedEvent));
}

export function startDownloadManager(): () => void {
  consumers++;
  if (consumers === 1) {
    listenerError = undefined;
    readDownloadTasks();
    const generation = ++listenerGeneration;
    void ghostboxApi.onDownloadProgress(onProgress).then((unlisten) => {
      if (generation !== listenerGeneration) { unlisten(); return; }
      stopListening = unlisten;
      ready = true;
      pump();
    }).catch((error) => {
      if (generation !== listenerGeneration) return;
      listenerError = String(error);
      for (const task of readDownloadTasks().filter((item) => item.status === "queued")) {
        update(task.id, { status: "error", errorMessage: String(error) });
      }
    });
    window.addEventListener("beforeunload", persist);
    stallTimer = setInterval(() => {
      if (current && lastSample && Date.now() - lastSample.time > 5000) {
        const task = readDownloadTasks().find((item) => item.id === current?.id);
        if (task && (task.speedBytesPerSecond || task.writeSpeedBytesPerSecond)) {
          if (!current.pauseRequested && task.status === "downloading") recordDownloadActivity(task.id, 0, task.writeSpeedBytesPerSecond == null ? undefined : 0);
          update(task.id, { speedBytesPerSecond: 0, writeSpeedBytesPerSecond: task.writeSpeedBytesPerSecond == null ? undefined : 0 }, true);
        }
      }
    }, 2000);
  }
  return () => {
    if (--consumers > 0) return;
    listenerGeneration++;
    ready = false;
    stopListening?.();
    stopListening = undefined;
    if (stallTimer) clearInterval(stallTimer);
    stallTimer = undefined;
    window.removeEventListener("beforeunload", persist);
    persist();
  };
}
