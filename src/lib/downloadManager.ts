import { ghostboxApi } from "./ghostboxApi";
import type { GhostBoxGame } from "../data";
import {
  gameSteamHeaderFirstSources,
  getGameAppId,
  isPortraitLibraryImageSource,
} from "../utils/image";
import {
  readStoredDownloadsDir,
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
} from "../utils/storage";
import { isSteamTitlePlaceholder } from "../utils/steamTitles";

type DownloadTaskStatus = "queued" | "downloading" | "paused" | "completed" | "error";

type DownloadSteamIntegrationStatus =
  | "ok"
  | "skipped"
  | "manifest-failed"
  | "library-not-registered";

type DownloadSteamIntegration = {
  status: DownloadSteamIntegrationStatus;
  message?: string;
  manifestPath?: string;
  /** `true` quando o ACF foi escrito: a Steam só relê `steamapps\` ao iniciar. */
  requiresSteamRestart?: boolean;
};

type StaleManifestDepot = {
  depotId: number;
  /** Manifest que seria baixado. String: não cabe em `number` sem perder dígito. */
  manifestId: string;
  /** Manifest do branch `public` segundo o PICS. */
  publicGid?: string;
  /** De onde saiu o manifest escolhido: `public-from-cache`, `newest-in-cache`, `lua-pinned`. */
  tier: string;
};

/**
 * O Rust recusou o download porque o manifest mais novo em disco é anterior à
 * build pública. Guardado na tarefa para a página poder oferecer "baixar mesmo
 * assim", que repete a chamada com `allowStale`.
 */
type StaleManifestReport = {
  publicBuildId?: string;
  depots: StaleManifestDepot[];
};

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
  /** Raiz escolhida pelo usuário; vira uma Steam Library. */
  downloadsRoot: string;
  /**
   * Destino final, `<downloadsRoot>\steamapps\common\<installDir>`. Vazio até o
   * Rust resolver o `installdir` no appinfo e emitir `depot-plan`.
   */
  outputDir: string;
  installDir?: string;
  /**
   * Resultado da etapa pós-download: depotcache, appmanifest e registro da
   * biblioteca. Separado de `status` de propósito — falhar aqui não invalida os
   * bytes baixados, só significa que o Steam ainda não reconhece a instalação.
   */
  steamIntegration?: DownloadSteamIntegration;
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
  /** Início da janela de aquecimento da estimativa. Ver `etaWarmupSeconds`. */
  speedWarmupStartedAt?: number;
  resumePending?: boolean;
  resumeBytesFloor?: number;
  totalBytesDownloaded?: number;
  totalBytesAll?: number;
  failedFiles?: number;
  errorMessage?: string;
  /** Confirmação do usuário para baixar uma build anterior à pública. */
  allowStale?: boolean;
  staleManifest?: StaleManifestReport;
};

const storageKey = "ghostbox:download-tasks:v1";
const maxStoredHistory = 50;

/**
 * Intervalo mínimo entre amostras de velocidade. Curto de propósito: a primeira
 * estimativa aparece na segunda amostra, então um limiar de 1s adiava o número
 * por vários segundos no começo do download.
 */
const speedSampleMinSeconds = 0.35;
/** Amostras guardadas para a mediana. ~8 amostras ≈ 3s de janela. */
const speedSampleWindow = 8;
/** Sem bytes novos por este tempo, a estimativa é descartada em vez de envelhecer. */
const speedStallSeconds = 5;
/** Teto de sanidade: acima disto o número não informa nada e só assusta. */
const maxEstimatedSeconds = 99 * 3600;
/**
 * Aquecimento antes de publicar qualquer estimativa. O início de um depot não é
 * representativo do download: enquanto o sidecar materializa os arquivos no
 * disco, os primeiros ~60s andam a centenas de KB/s e só depois a taxa sobe uma
 * ou duas ordens de grandeza. Extrapolar essa fase produzia "81h restantes" para
 * um download de ~25min — medido em 27/08/2026 com Resident Evil 4 (61,5 GB em
 * 11 arquivos). Enquanto a janela não fecha, a UI mostra "calculando".
 */
const etaWarmupSeconds = 45;
/** Cadência do vigia de travamento, para o caso de os eventos pararem de chegar. */
const stallWatchIntervalMs = 2000;

/**
 * Mediana, não média nem percentil baixo: resiste tanto a picos de cache quanto
 * a quedas momentâneas, sem o pessimismo sistemático de um percentil 25.
 */
function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function clampEstimatedSeconds(seconds: number | undefined): number | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.min(seconds, maxEstimatedSeconds);
}

/**
 * Combina a estimativa anterior (já descontado o tempo decorrido) com a nova.
 * A inércia alisa o número enquanto a velocidade oscila pouco, mas uma mudança
 * real — dobrou ou caiu pela metade — passa direto, sem arrastar o valor velho.
 */
function blendEstimatedSeconds(
  previousSeconds: number | undefined,
  instantSeconds: number,
): number {
  if (typeof previousSeconds !== "number" || previousSeconds <= 0) {
    return instantSeconds;
  }
  if (instantSeconds > previousSeconds * 2 || instantSeconds < previousSeconds / 2) {
    return instantSeconds;
  }
  return previousSeconds * 0.5 + instantSeconds * 0.5;
}
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

/** Releitura do que já foi persistido — chaves em camelCase, não do payload Rust. */
function normalizeStoredSteamIntegration(value: unknown): DownloadSteamIntegration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const status = typeof raw.status === "string" ? raw.status : "";
  if (
    status !== "ok" &&
    status !== "skipped" &&
    status !== "manifest-failed" &&
    status !== "library-not-registered"
  ) {
    return undefined;
  }
  return {
    status,
    message: typeof raw.message === "string" ? raw.message : undefined,
    manifestPath: typeof raw.manifestPath === "string" ? raw.manifestPath : undefined,
    requiresSteamRestart: raw.requiresSteamRestart === true,
  };
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
          (source): source is string =>
            typeof source === "string" &&
            source.length > 0 &&
            !isPortraitLibraryImageSource(source),
        )
      : [],
    downloadsRoot: typeof item.downloadsRoot === "string"
      ? item.downloadsRoot
      : downloadRootFromOutputDir(typeof item.outputDir === "string" ? item.outputDir : ""),
    outputDir: typeof item.outputDir === "string" ? item.outputDir : "",
    installDir: typeof item.installDir === "string" ? item.installDir : undefined,
    steamIntegration: normalizeStoredSteamIntegration(item.steamIntegration),
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
  if (typeof window !== "undefined") {
    void Promise.resolve().then(() => hydratePlaceholderTitles());
  }
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

function findLocalStoredTitle(appId: string): string | null {
  try {
    const fav = readStoredFavoriteGames().find((game) => game.appId === appId)?.title;
    if (fav && !isSteamTitlePlaceholder(fav, appId)) return fav;
  } catch {}
  try {
    const hist = readStoredProfileHistoryGames().find((game) => game.appId === appId)?.title;
    if (hist && !isSteamTitlePlaceholder(hist, appId)) return hist;
  } catch {}
  return null;
}

function patchPlaceholderTitleForAppId(appId: string) {
  const live = liveTasks.find((task) => task.appId === appId);
  const historyTasks = readHistoryTasks();
  const livePlaceholder = live ? isSteamTitlePlaceholder(live.title, appId) : false;
  const historyPlaceholders = historyTasks.filter(
    (task) => task.appId === appId && isSteamTitlePlaceholder(task.title, appId),
  );
  if (!livePlaceholder && historyPlaceholders.length === 0) return;

  const localTitle = findLocalStoredTitle(appId);
  if (localTitle) {
    if (livePlaceholder) updateLiveTask(appId, { title: localTitle });
    if (historyPlaceholders.length) {
      const patched = historyTasks.map((task) =>
        task.appId === appId && isSteamTitlePlaceholder(task.title, appId)
          ? { ...task, title: localTitle }
          : task,
      );
      writeHistoryTasks(patched);
      notifyChanged(true);
    }
    return;
  }

  void (async () => {
    try {
      let resolved: string | null = null;
      const details = await ghostboxApi.getGameDetails(appId).catch(() => null);
      if (details?.title && !isSteamTitlePlaceholder(details.title, appId)) {
        resolved = details.title;
      }
      if (!resolved) {
        const store = await ghostboxApi.getGameStoreDetails(appId).catch(() => null);
        if (store?.title && !isSteamTitlePlaceholder(store.title, appId)) {
          resolved = store.title;
        }
      }
      if (!resolved) {
        try {
          const result = await ghostboxApi.getGames({ query: appId, limit: 5 });
          const match = result.games.find(
            (game) => game.appId === appId && !isSteamTitlePlaceholder(game.title, appId),
          );
          if (match) resolved = match.title;
        } catch {}
      }
      if (!resolved) return;
      const currentLive = liveTasks.find((task) => task.appId === appId);
      if (
        currentLive &&
        isSteamTitlePlaceholder(currentLive.title, appId)
      ) {
        updateLiveTask(appId, { title: resolved });
      }
      const currentHistory = readHistoryTasks();
      let patched = false;
      const patchedHistory = currentHistory.map((task) => {
        if (task.appId === appId && isSteamTitlePlaceholder(task.title, appId)) {
          patched = true;
          return { ...task, title: resolved! };
        }
        return task;
      });
      if (patched) {
        writeHistoryTasks(patchedHistory);
        notifyChanged(true);
      }
    } catch {}
  })();
}

function hydratePlaceholderTitles() {
  const allTasks = [...liveTasks, ...readHistoryTasks()];
  const seen = new Set<string>();
  for (const task of allTasks) {
    if (!isSteamTitlePlaceholder(task.title, task.appId)) continue;
    if (seen.has(task.appId)) continue;
    seen.add(task.appId);
    patchPlaceholderTitleForAppId(task.appId);
  }
}

function normalizeSteamIntegration(value: unknown): DownloadSteamIntegration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const status = typeof raw.Status === "string" ? raw.Status : "";
  if (
    status !== "ok" &&
    status !== "skipped" &&
    status !== "manifest-failed" &&
    status !== "library-not-registered"
  ) {
    return undefined;
  }
  return {
    status,
    message: typeof raw.Message === "string" ? raw.Message : undefined,
    manifestPath: typeof raw.ManifestPath === "string" ? raw.ManifestPath : undefined,
    requiresSteamRestart: raw.RequiresSteamRestart === true,
  };
}

/**
 * Lê o payload `stale-manifest` do Rust. `undefined` para qualquer outro
 * resultado, então a página só oferece "baixar mesmo assim" quando foi
 * exatamente essa a recusa.
 */
function normalizeStaleManifest(result: Record<string, unknown>): StaleManifestReport | undefined {
  if (result.Status !== "stale-manifest") return undefined;
  const rawDepots = Array.isArray(result.Depots) ? result.Depots : [];
  const depots = rawDepots.flatMap((entry): StaleManifestDepot[] => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (!isFiniteNumber(raw.DepotId) || typeof raw.ManifestId !== "string") return [];
    return [
      {
        depotId: raw.DepotId,
        manifestId: raw.ManifestId,
        publicGid: typeof raw.PublicGid === "string" ? raw.PublicGid : undefined,
        tier: typeof raw.Tier === "string" ? raw.Tier : "",
      },
    ];
  });
  if (depots.length === 0) return undefined;
  return {
    publicBuildId: typeof result.PublicBuildId === "string" ? result.PublicBuildId : undefined,
    depots,
  };
}

async function deleteDownloadOutputDir(task: DownloadTask) {
  if (!task.downloadsRoot.trim()) {
    throw new Error("Download folder is unavailable.");
  }
  /* Cancelado antes de `depot-plan`: o destino nunca foi resolvido, então não há
     pasta a remover — mas o ACF órfão de uma tentativa anterior ainda pode estar
     lá, e o comando do Rust cuida disso a partir da raiz. */
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

/**
 * Tarefa viva (na fila, baixando ou pausada) de um jogo, ou `null` quando não
 * há download em andamento para o appId. Histórico (completed/error) não conta.
 */
export function getLiveDownloadTaskByAppId(appId: string): DownloadTask | null {
  ensureLiveTasksHydrated();
  return liveTasks.find((task) => task.appId === appId) ?? null;
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
    .downloadDepotGame(
      next.appId,
      next.downloadsRoot,
      next.title,
      undefined,
      next.allowStale,
    )
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
    outputDir:
      typeof result.OutputDir === "string" && result.OutputDir.trim()
        ? result.OutputDir
        : task.outputDir,
    installDir:
      typeof result.InstallDir === "string" && result.InstallDir.trim()
        ? result.InstallDir
        : task.installDir,
    steamIntegration: normalizeSteamIntegration(result.SteamIntegration),
    finishedAt: Date.now(),
    totalBytesDownloaded,
    totalBytesAll,
    failedFiles,
    resumePending: false,
    resumeBytesFloor: undefined,
    errorMessage: typeof result.Message === "string" ? result.Message : failedDepotMessage,
    staleManifest: normalizeStaleManifest(result),
  };

  archiveTask(finished);
  notifyChanged(true);
  // Se o registro na biblioteca Steam não gravou na conclusão (Steam aberta),
  // o reparo entra na mesma hora — e o polling seguinte converge depois que
  // o usuário fecha a Steam.
  recheckSteamLibraryRegistrations();
  startNextQueuedTask();
}

/**
 * Raiz dentro de uma biblioteca Steam volta para a raiz da biblioteca: escolher
 * `X\steamapps` ou `X\steamapps\common` (ex.: a biblioteca oficial) não pode
 * gerar `steamapps\common\steamapps\common\<jogo>` — estrutura que a Steam
 * nunca escaneia. Espelha `normalize_library_root` no Rust.
 */
export function normalizeDownloadsRoot(root: string): string {
  const current = root.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  let normalized = current;
  for (;;) {
    const lower = normalized.toLowerCase();
    if (lower.endsWith("\\steamapps\\common")) {
      normalized = normalized.slice(0, -"\\steamapps\\common".length);
    } else if (lower.endsWith("\\steamapps")) {
      normalized = normalized.slice(0, -"\\steamapps".length);
    } else {
      break;
    }
  }
  return normalized;
}

/**
 * `downloadsRoot` é a raiz escolhida pelo usuário. O destino final
 * (`<root>\steamapps\common\<installdir>`) depende do `installdir` do appinfo e
 * só é conhecido depois que o Rust responde — chega no evento `depot-plan` e
 * preenche `outputDir`.
 */
export function enqueueDownload(game: GhostBoxGame, downloadsRoot: string) {
  ensureLiveTasksHydrated();
  const appId = getGameAppId(game);
  if (!appId) return;
  const root = normalizeDownloadsRoot(downloadsRoot);
  if (!root) return;
  if (liveTasks.some((task) => task.appId === appId)) return;

  let resolvedTitle = game.title?.trim() || `Steam App ${appId}`;
  if (isSteamTitlePlaceholder(resolvedTitle, appId)) {
    const localTitle = findLocalStoredTitle(appId);
    if (localTitle) resolvedTitle = localTitle;
  }

  const hadPlaceholder = isSteamTitlePlaceholder(resolvedTitle, appId);

  liveTasks = [
    ...liveTasks,
    {
      id: appId,
      appId,
      title: resolvedTitle,
      coverUrl: game.coverUrl,
      headerSources: gameSteamHeaderFirstSources(game),
      downloadsRoot: root,
      outputDir: "",
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
  if (hadPlaceholder) {
    patchPlaceholderTitleForAppId(appId);
  }
  startNextQueuedTask();
}

/**
 * Refila uma tarefa recusada por `stale-manifest`, agora com a confirmação do
 * usuário de que a build anterior à pública serve. Sai do histórico e volta para
 * a fila viva; qualquer outro estado é ignorado.
 */
export function retryDownloadIgnoringStaleManifest(id: string) {
  ensureLiveTasksHydrated();
  const history = readHistoryTasks();
  const task = history.find((entry) => entry.id === id);
  if (!task?.staleManifest) return;
  if (liveTasks.some((entry) => entry.appId === task.appId)) return;

  writeHistoryTasks(history.filter((entry) => entry.id !== id));
  liveTasks = [
    ...liveTasks,
    {
      ...task,
      status: "queued",
      allowStale: true,
      staleManifest: undefined,
      errorMessage: undefined,
      queuedAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speedBytesPerSecond: 0,
      depotIndex: 0,
      depotTotal: 0,
      depotStatus: undefined,
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

/**
 * Atualiza o registro persistido de uma instalacao apos o GhostBox mover os
 * arquivos para outra raiz (comando `cdndownload_move_install_dir`). Sem isto,
 * uma "Desinstalar" futura a partir de UI chamaria `deleteDownloadOutputDir` com
 * o caminho antigo, que ja nao existe. So mexe em tarefas completas.
 */
export function updateInstallPathsForApp(
  appId: string,
  newDownloadsRoot: string,
  newOutputDir: string,
) {
  ensureLiveTasksHydrated();
  let touched = false;

  const nextHistory = readHistoryTasks().map((task) => {
    if (task.appId !== appId || task.status !== "completed") return task;
    touched = true;
    return { ...task, downloadsRoot: newDownloadsRoot, outputDir: newOutputDir };
  });
  if (touched) {
    writeHistoryTasks(nextHistory);
    notifyChanged(true);
    return;
  }

  const liveMatch = liveTasks.find(
    (task) => task.appId === appId && task.status === "completed",
  );
  if (liveMatch) {
    updateLiveTask(appId, {
      downloadsRoot: newDownloadsRoot,
      outputDir: newOutputDir,
    });
  }
}

export function reorderQueuedTasks(sourceId: string, targetIndex: number) {
  ensureLiveTasksHydrated();
  const queued = liveTasks.filter((task) => task.status === "queued");
  const sourceIndex = queued.findIndex((task) => task.id === sourceId);
  if (sourceIndex === -1) return;
  const [moved] = queued.splice(sourceIndex, 1);
  queued.splice(Math.max(0, Math.min(targetIndex, queued.length)), 0, moved);
  const downloading = liveTasks.filter((task) => task.status === "downloading");
  const paused = liveTasks.filter((task) => task.status === "paused");
  liveTasks = [...downloading, ...queued, ...paused];
  notifyChanged(true);
}

export function reorderPausedTasks(sourceId: string, targetIndex: number) {
  ensureLiveTasksHydrated();
  const paused = liveTasks.filter((task) => task.status === "paused");
  const sourceIndex = paused.findIndex((task) => task.id === sourceId);
  if (sourceIndex === -1) return;
  const [moved] = paused.splice(sourceIndex, 1);
  paused.splice(Math.max(0, Math.min(targetIndex, paused.length)), 0, moved);
  const downloading = liveTasks.filter((task) => task.status === "downloading");
  const queued = liveTasks.filter((task) => task.status === "queued");
  liveTasks = [...downloading, ...queued, ...paused];
  notifyChanged(true);
}

export function reorderHistoryTasks(sourceId: string, targetIndex: number) {
  const history = readHistoryTasks();
  const sourceIndex = history.findIndex((task) => task.id === sourceId);
  if (sourceIndex === -1) return;
  const next = [...history];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, moved);
  writeHistoryTasks(next);
  notifyChanged(true);
}

export function moveQueuedToPaused(sourceId: string, targetIndex: number) {
  ensureLiveTasksHydrated();
  const task = liveTasks.find((entry) => entry.id === sourceId && entry.status === "queued");
  if (!task) return;
  liveTasks = liveTasks.filter((entry) => entry.id !== sourceId);
  const paused = liveTasks.filter((entry) => entry.status === "paused");
  const downloading = liveTasks.filter((entry) => entry.status === "downloading");
  const queued = liveTasks.filter((entry) => entry.status === "queued");
  const moved = { ...task, status: "paused" as const, speedBytesPerSecond: 0 };
  paused.splice(Math.max(0, Math.min(targetIndex, paused.length)), 0, moved);
  liveTasks = [...downloading, ...queued, ...paused];
  notifyChanged(true);
}

export function movePausedToQueued(sourceId: string, targetIndex: number) {
  ensureLiveTasksHydrated();
  const task = liveTasks.find((entry) => entry.id === sourceId && entry.status === "paused");
  if (!task) return;
  liveTasks = liveTasks.filter((entry) => entry.id !== sourceId);
  const paused = liveTasks.filter((entry) => entry.status === "paused");
  const downloading = liveTasks.filter((entry) => entry.status === "downloading");
  const queued = liveTasks.filter((entry) => entry.status === "queued");
  const moved = { ...task, status: "queued" as const, depotStatus: undefined, resumePending: true, resumeBytesFloor: task.bytesDownloaded };
  queued.splice(Math.max(0, Math.min(targetIndex, queued.length)), 0, moved);
  liveTasks = [...downloading, ...queued, ...paused];
  notifyChanged(true);
  startNextQueuedTask();
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
    /* Primeira vez que o destino real é conhecido: o Rust já leu o `installdir`
       do appinfo e montou `<root>\steamapps\common\<installdir>`. */
    if (typeof payload.OutputDir === "string" && payload.OutputDir.trim()) {
      patch.outputDir = payload.OutputDir;
    }
    if (typeof payload.InstallDir === "string" && payload.InstallDir.trim()) {
      patch.installDir = payload.InstallDir;
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
      /* Cada depot reabre o custo de materializar arquivos novos, então o
         aquecimento da estimativa recomeça junto com ele. */
      speedWarmupStartedAt: undefined,
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
      elapsedSeconds >= speedSampleMinSeconds &&
      progressedBytes > 0;
    /* Bytes parados por tempo demais. Manter a estimativa antiga aqui era o
       pior caso: a barra congelava e o card seguia prometendo um tempo. */
    const isStalled =
      !canSample &&
      typeof lastProgressAt === "number" &&
      typeof lastProgressBytes === "number" &&
      progressedBytes === 0 &&
      elapsedSeconds >= speedStallSeconds;

    let speedSamples = task?.speedSamples ?? [];
    let smoothedSpeed = task?.speedBytesPerSecond ?? 0;
    let estimatedSecondsRemaining = task?.estimatedSecondsRemaining;
    let nextSampleAt = lastProgressAt;
    let nextSampleBytes = lastProgressBytes;

    /* A velocidade continua sendo mostrada durante o aquecimento — ela é real.
       O que fica suspenso é só a extrapolação, que é o número enganoso. */
    const warmupStartedAt = task?.speedWarmupStartedAt ?? now;
    const isWarmedUp = now - warmupStartedAt >= etaWarmupSeconds * 1000;

    if (canSample) {
      const observedSpeed = progressedBytes / elapsedSeconds;
      speedSamples = [...speedSamples, observedSpeed].slice(-speedSampleWindow);
      const sampledSpeed = medianOf(speedSamples);
      smoothedSpeed = smoothedSpeed > 0
        ? smoothedSpeed * 0.6 + sampledSpeed * 0.4
        : sampledSpeed;

      /* `bytesTotal` chega zerado até o manifesto carregar; sem essa guarda o
         restante virava 0 e a estimativa nascia como "terminando agora". */
      const instantEta =
        incomingTotal > 0 && smoothedSpeed > 0
          ? Math.max(0, incomingTotal - displayedBytes) / smoothedSpeed
          : undefined;
      const previousEta = task?.estimatedSecondsRemaining;
      const predictedPreviousEta = typeof previousEta === "number"
        ? Math.max(0, previousEta - elapsedSeconds)
        : undefined;
      estimatedSecondsRemaining = isWarmedUp
        ? clampEstimatedSeconds(
            typeof instantEta === "number"
              ? blendEstimatedSeconds(predictedPreviousEta, instantEta)
              : undefined,
          )
        : undefined;
      nextSampleAt = now;
      nextSampleBytes = displayedBytes;
    } else if (
      isStalled ||
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
      speedWarmupStartedAt: warmupStartedAt,
      resumeBytesFloor: isResumeRecovered ? undefined : resumeBytesFloor,
    });
    return;
  }

  if (type === "error") {
    const message = typeof payload.Message === "string" ? payload.Message : undefined;
    updateLiveTask(appId, { errorMessage: message, depotStatus: status || "error" }, true);
  }
}

/**
 * Rede de segurança para o caso de os eventos de progresso simplesmente
 * pararem: sem isto a velocidade e a estimativa ficariam congeladas nos últimos
 * valores conhecidos, indistinguíveis de um download saudável.
 */
function clearStalledEstimates() {
  ensureLiveTasksHydrated();
  const now = Date.now();

  for (const task of liveTasks) {
    if (task.status !== "downloading") continue;
    if (task.speedBytesPerSecond === 0 && task.estimatedSecondsRemaining === undefined) {
      continue;
    }
    if (typeof task.lastProgressAt !== "number") continue;
    if (now - task.lastProgressAt < speedStallSeconds * 1000) continue;

    updateLiveTask(task.appId, {
      speedBytesPerSecond: 0,
      estimatedSecondsRemaining: undefined,
      speedSamples: [],
    });
  }
}

export function startDownloadManager(): () => void {
  if (engineStarted) return () => undefined;
  engineStarted = true;

  sweepKnownDownloadRoots();
  recheckSteamLibraryRegistrations();

  const unlisten = ghostboxApi.onDownloadProgress(applyProgressEvent);
  const stallWatcher = setInterval(clearStalledEstimates, stallWatchIntervalMs);
  steamLibraryRepairTimer = window.setInterval(
    recheckSteamLibraryRegistrations,
    steamLibraryRepairIntervalMs,
  );

  return () => {
    engineStarted = false;
    unlisten();
    clearInterval(stallWatcher);
    if (steamLibraryRepairTimer !== null) {
      clearInterval(steamLibraryRepairTimer);
      steamLibraryRepairTimer = null;
    }
    flushStoredTasks();
  };
}

/**
 * Manutenção de disco uma vez por boot: temporários de chunks órfãos e ACFs
 * de jogos apagados manualmente pelo Explorer, em todas as raízes conhecidas.
 * Fire-and-forget — falha aqui nunca pode atrapalhar a inicialização.
 */
function sweepKnownDownloadRoots(): void {
  try {
    const roots = new Set<string>();
    const stored = readStoredDownloadsDir();
    if (stored) roots.add(stored);
    for (const task of readHistoryTasks()) {
      if (task.downloadsRoot) roots.add(task.downloadsRoot);
    }
    const known = [...roots];
    if (!known.length) return;
    void ghostboxApi.sweepDownloadRoots(known).catch(() => undefined);
  } catch {
    // Best-effort only.
  }
}

/**
 * Reparo automático do registro na biblioteca Steam ("Steam: Pendente").
 *
 * O download pode concluir sem a entrada em `libraryfolders.vdf` — tipicamente
 * com a Steam aberta, que reescreve o arquivo ao sair e descarta a entrada.
 * Enquanto houver jogo concluído nessa situação, este ciclo reaplica o registro
 * (idempotente no Rust) até gravar; o status então vira "Reconhecido" sem
 * nenhuma ação do usuário. Tentativas com a Steam aberta são best-effort: o
 * pior caso é a entrada ser descartada de novo e a próxima rodada regravar.
 */
const steamLibraryRepairIntervalMs = 60_000;
let steamLibraryRepairInFlight = false;
let steamLibraryRepairTimer: number | null = null;

function repairableSteamIntegration(task: DownloadTask): boolean {
  if (task.status !== "completed") return false;
  // Raiz aninhada dentro de uma biblioteca oficial: mesmo com status "ok", o
  // registro antigo apontava para o `steamapps` que a Steam nunca escaneia —
  // re-registrar (com migração no Rust) é o que torna o jogo reconhecido.
  const rawRoot = task.downloadsRoot.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (rawRoot && normalizeDownloadsRoot(rawRoot) !== rawRoot) return true;
  return !task.steamIntegration || task.steamIntegration.status === "library-not-registered";
}

function patchSteamIntegration(
  appId: string,
  integration: DownloadSteamIntegration,
  paths?: { downloadsRoot: string; outputDir: string },
): void {
  ensureLiveTasksHydrated();
  let changed = false;
  const apply = (task: DownloadTask): DownloadTask => {
    if (task.appId !== appId || !repairableSteamIntegration(task)) return task;
    changed = true;
    return {
      ...task,
      steamIntegration: integration,
      // O reparo pode migrar a instalação para fora de uma raiz aninhada —
      // o histórico tem que apontar para o lugar de verdade.
      downloadsRoot: paths?.downloadsRoot || task.downloadsRoot,
      outputDir: paths?.outputDir || task.outputDir,
    };
  };
  liveTasks = liveTasks.map(apply);
  const history = readHistoryTasks();
  const patchedHistory = history.map(apply);
  if (!changed) return;
  if (patchedHistory !== history) writeHistoryTasks(patchedHistory);
  notifyChanged(true);
}

function recheckSteamLibraryRegistrations(): void {
  if (steamLibraryRepairInFlight || typeof window === "undefined") return;
  ensureLiveTasksHydrated();
  const candidates = [...liveTasks, ...readHistoryTasks()].filter(repairableSteamIntegration);
  if (!candidates.length) return;

  steamLibraryRepairInFlight = true;
  void (async () => {
    try {
      for (const task of candidates) {
        try {
          const result = await ghostboxApi.registerDownloadLibrary(task.appId, task.downloadsRoot);
          if (result.Status === "ok") {
            patchSteamIntegration(
              task.id,
              {
                status: "ok",
                requiresSteamRestart: result.RequiresSteamRestart === true,
              },
              {
                downloadsRoot:
                  typeof result.DownloadsRoot === "string" ? result.DownloadsRoot : "",
                outputDir: typeof result.OutputDir === "string" ? result.OutputDir : "",
              },
            );
          }
        } catch {
          // ACF ausente (instalação apagada) ou falha de escrita: segue
          // pendente para a próxima rodada.
        }
      }
    } finally {
      steamLibraryRepairInFlight = false;
    }
  })();
}
