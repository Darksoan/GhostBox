import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhostBoxGame } from "../src/data";

const api = vi.hoisted(() => ({
  downloadDepotGame: vi.fn(), cancelDepotGame: vi.fn(), selectDownloadsDir: vi.fn(),
  onDownloadProgress: vi.fn(), deleteDownloadOutputDir: vi.fn(), registerDownloadLibrary: vi.fn(),
  createGameShortcut: vi.fn(),
}));
vi.mock("../src/lib/ghostboxApi", () => ({ ghostboxApi: api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const game = (appId = "10") => ({ id: `steam-${appId}`, appId, title: `Game ${appId}`, coverUrl: "" }) as GhostBoxGame;
const complete = { Type: "complete", Partial: false, TotalBytes: 100, OutputDir: "E:\\Games\\steamapps\\common\\Game", SteamIntegration: { Status: "ok" } };
type Manager = typeof import("../src/lib/downloadManager");
let manager: Manager;
let stop: (() => void) | undefined;
let event: (value: Record<string, unknown>) => void;
let storage: Map<string, string>;
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  storage = new Map([["ghostbox:downloads-dir:v1", "E:\\Games"]]);
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage }));
  vi.stubGlobal("localStorage", localStorage);
  api.onDownloadProgress.mockImplementation(async (callback) => { event = callback; return vi.fn(); });
  api.downloadDepotGame.mockResolvedValue(complete);
  api.cancelDepotGame.mockResolvedValue(true);
  api.selectDownloadsDir.mockResolvedValue("E:\\Games");
  api.deleteDownloadOutputDir.mockResolvedValue(true);
  api.createGameShortcut.mockResolvedValue({ success: true });
  manager = await import("../src/lib/downloadManager");
});

afterEach(() => {
  stop?.(); stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() { stop = manager.startDownloadManager(); await flush(); }

describe("native download queue", () => {
  it("creates one desktop shortcut per newly queued game without waiting for its ico", async () => {
    const shortcut = deferred<{ success: boolean }>();
    const active = deferred<Record<string, unknown>>();
    api.createGameShortcut.mockReturnValue(shortcut.promise);
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    expect(await manager.enqueueDownload(game())).toBe(true);
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
    expect(api.createGameShortcut).toHaveBeenCalledWith(game(), "desktop");
    await manager.enqueueDownload(game());
    expect(api.createGameShortcut).toHaveBeenCalledTimes(1);
    await manager.enqueueDownload(game("20"));
    expect(api.createGameShortcut).toHaveBeenCalledTimes(2);
    shortcut.resolve({ success: true });
    active.resolve(complete);
    await flush();
  });

  it("does not fail the download when Windows cannot create its shortcut", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      api.createGameShortcut.mockRejectedValueOnce(new Error("Desktop is unavailable"));
      await start();
      expect(await manager.enqueueDownload(game())).toBe(true);
      await flush();
      expect(manager.readDownloadTasks()[0].status).toBe("completed");
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("announces completion once with the game title and art, never for individual depots", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    const completed = vi.fn();
    window.addEventListener(manager.downloadCompletedEvent, completed);
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "complete", DepotId: 1 });
    expect(completed).not.toHaveBeenCalled();
    active.resolve(complete);
    await flush();
    expect(completed).toHaveBeenCalledTimes(1);
    const payload = completed.mock.calls[0][0].detail;
    expect(payload).toMatchObject({ id: "10", appId: "10", title: "Game 10" });
    expect(payload.headerSources).toEqual(manager.readDownloadTasks()[0].headerSources);
  });

  it.each([
    { Type: "cancelled" }, { Type: "error" }, { Type: "complete", Partial: true },
    { Type: "complete", Depots: [{ Type: "error" }] },
    { Type: "complete", Depots: [{ Type: "complete", FailedFiles: 1 }] },
  ])("does not announce success for cancelled or incomplete downloads: %j", async (result) => {
    api.downloadDepotGame.mockResolvedValueOnce(result);
    const completed = vi.fn();
    window.addEventListener(manager.downloadCompletedEvent, completed);
    await start();
    await manager.enqueueDownload(game());
    await flush();
    expect(completed).not.toHaveBeenCalled();
  });

  it("shares destination changes with settings without moving existing tasks", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    const changed = vi.fn();
    window.addEventListener(manager.downloadsDirectoryChangedEvent, changed);
    manager.writeStoredDownloadsDir("F:\\GhostBoxLibrary");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(manager.readStoredDownloadsDir()).toBe("F:\\GhostBoxLibrary");
    await manager.enqueueDownload(game("20"));
    expect(manager.readDownloadTasks().map((task) => task.downloadsRoot)).toEqual(["E:\\Games", "F:\\GhostBoxLibrary"]);
    active.resolve(complete);
    await flush();
    expect(api.downloadDepotGame.mock.calls[1][1]).toBe("F:\\GhostBoxLibrary");
  });

  it("migrates archived tasks, pauses interrupted work, and rejects malformed entries", () => {
    const old = { appId: "10", title: "Old", downloadsRoot: "E:\\Games", status: "downloading", bytesDownloaded: 30, bytesTotal: 100, speedBytesPerSecond: 99 };
    const tasks = manager.restoreDownloadTasks([null, {}, old, old, { ...old, appId: "20", status: "completed" }, { ...old, appId: "30", downloadsRoot: {} }]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ status: "paused", speedBytesPerSecond: 0, bytesDownloaded: 30 });
    expect(tasks[1].status).toBe("completed");
  });

  it("does not navigate/enqueue if the folder picker is cancelled", async () => {
    storage.delete("ghostbox:downloads-dir:v1");
    api.selectDownloadsDir.mockResolvedValue(null);
    expect(await manager.enqueueDownload(game())).toBe(false);
    expect(manager.readDownloadTasks()).toEqual([]);
    expect(api.createGameShortcut).not.toHaveBeenCalled();
  });

  it("subscribes before starting a persisted queue", async () => {
    const listener = deferred<() => void>();
    api.onDownloadProgress.mockReturnValue(listener.promise);
    stop = manager.startDownloadManager();
    await manager.enqueueDownload(game());
    expect(api.downloadDepotGame).not.toHaveBeenCalled();
    listener.resolve(vi.fn());
    await flush();
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
  });

  it("runs one game at a time and ignores per-depot completion events", async () => {
    const first = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise);
    await start();
    await manager.enqueueDownload(game());
    await manager.enqueueDownload(game("20"));
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "complete", DepotId: 1 });
    expect(manager.readDownloadTasks().map((task) => task.status)).toEqual(["downloading", "queued"]);
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
    first.resolve(complete);
    await flush();
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(2);
    expect(manager.readDownloadTasks().every((task) => task.status === "completed")).toBe(true);
  });

  it("waits for real worker cancellation before a quick resume", async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await start();
    await manager.enqueueDownload(game());
    const paused = manager.pauseDownloadTask("10");
    const resumed = manager.resumeDownloadTask("10");
    await flush();
    expect(api.cancelDepotGame).toHaveBeenCalledWith("10");
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
    first.resolve({ Type: "cancelled" });
    await Promise.all([paused, resumed]);
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(2);
    expect(manager.readDownloadTasks()[0].status).toBe("downloading");
    second.resolve(complete);
    await flush();
  });

  it("switches focus only after cancelling the current worker and keeps its downloaded bytes in the queue", async () => {
    const first = deferred<Record<string, unknown>>();
    const chosen = deferred<Record<string, unknown>>();
    const resumed = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise).mockReturnValueOnce(chosen.promise).mockReturnValueOnce(resumed.promise);
    await start();
    await manager.enqueueDownload(game("10"));
    event({ AppId: "10", Type: "progress", BytesDownloaded: 30, BytesTotal: 100, SpeedBytesPerSecond: 10 });
    await manager.enqueueDownload(game("30"));
    await manager.enqueueDownload(game("20"));
    const focusing = manager.prioritizeDownloadTask("20");
    await flush();
    expect(api.cancelDepotGame).toHaveBeenCalledWith("10");
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
    expect(manager.readDownloadTasks().map((task) => task.id)).toEqual(["20", "10", "30"]);
    first.resolve({ Type: "cancelled" });
    await focusing;
    expect(api.downloadDepotGame.mock.calls[1][0]).toBe("20");
    expect(manager.readDownloadTasks().find((task) => task.id === "10")).toMatchObject({ status: "queued", bytesDownloaded: 30 });
    expect(manager.readDownloadTasks().find((task) => task.id === "20")?.status).toBe("downloading");
    const { readDownloadActivity } = await import("../src/lib/downloadActivity");
    expect(readDownloadActivity()).toMatchObject({ taskId: "20", download: [] });
    chosen.resolve(complete);
    await flush();
    expect(api.downloadDepotGame.mock.calls[2][0]).toBe("10");
    resumed.resolve(complete);
    await flush();
  });

  it("starts the chosen paused game when all downloads are paused", async () => {
    storage.set("ghostbox:download-tasks:v1", JSON.stringify([
      { appId: "10", downloadsRoot: "E:\\Games", status: "paused", bytesDownloaded: 10 },
      { appId: "20", downloadsRoot: "E:\\Games", status: "paused", bytesDownloaded: 20 },
    ]));
    const chosen = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(chosen.promise);
    await start();
    await manager.prioritizeDownloadTask("20");
    expect(api.downloadDepotGame.mock.calls[0][0]).toBe("20");
    expect(manager.readDownloadTasks().find((task) => task.id === "10")?.status).toBe("paused");
    expect(manager.readDownloadTasks()[0]).toMatchObject({ id: "20", status: "downloading", bytesDownloaded: 20 });
    chosen.resolve(complete);
    await flush();
  });

  it("rejects competing focus changes without starting simultaneous downloads", async () => {
    const first = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise);
    await start();
    await manager.enqueueDownload(game("10"));
    await manager.enqueueDownload(game("20"));
    await manager.enqueueDownload(game("30"));
    const focusing = manager.prioritizeDownloadTask("20");
    await expect(manager.prioritizeDownloadTask("30")).rejects.toThrow("Aguarde a troca");
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
    first.resolve({ Type: "cancelled" });
    await focusing;
    await flush();
    expect(api.downloadDepotGame.mock.calls[1][0]).toBe("20");
  });

  it("restores queued downloads paused on a new launcher session", async () => {
    storage.set("ghostbox:download-tasks:v1", JSON.stringify([{ appId: "10", downloadsRoot: "E:\\Games", status: "queued" }]));
    await start();
    expect(manager.readDownloadTasks()[0].status).toBe("paused");
    expect(api.downloadDepotGame).not.toHaveBeenCalled();
    await manager.resumeDownloadTask("10");
    await flush();
    expect(api.downloadDepotGame).toHaveBeenCalledTimes(1);
  });

  it.each([
    { Type: "complete", Partial: true },
    { Type: "complete", Depots: [{ Type: "complete", FailedFiles: 1 }] },
    { Type: "error", Message: "CDN unavailable" },
  ])("never marks an incomplete or failed download as installed: %j", async (result) => {
    api.downloadDepotGame.mockResolvedValue(result);
    const installed = vi.fn();
    window.addEventListener(manager.downloadInstallationChangedEvent, installed);
    await start();
    await manager.enqueueDownload(game());
    await flush();
    expect(manager.readDownloadTasks()[0].status).toBe("error");
    expect(installed).not.toHaveBeenCalled();
  });

  it("keeps the destination from depot-plan, not telemetry log paths or another app", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "status", Status: "depot-plan", OutputDir: "E:\\Games\\Game", TotalBytes: 100 });
    event({ AppId: "20", Type: "progress", BytesDownloaded: 99 });
    event({ AppId: "10", Type: "telemetry", OutputDir: "E:\\Games\\Game\\download.log" });
    expect(manager.readDownloadTasks()[0]).toMatchObject({ outputDir: "E:\\Games\\Game", bytesDownloaded: 0 });
    active.resolve(complete);
    await flush();
  });

  it("preserves the game total through zero-filled status, telemetry and cancellation events", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    const total = Math.round(13.3 * 1024 ** 3);
    const downloaded = Math.round(4.2 * 1024 ** 3);
    event({ AppId: "10", Type: "progress", BytesDownloaded: downloaded, BytesTotal: total, TotalBytes: 0 });
    for (const Type of ["status", "telemetry", "complete"]) {
      event({ AppId: "10", Type, TotalBytes: 0, BytesTotal: 0 });
      expect(manager.readDownloadTasks()[0].bytesTotal).toBe(total);
    }
    const pausing = manager.pauseDownloadTask("10");
    event({ AppId: "10", Type: "cancelled", TotalBytes: 0, BytesTotal: 0 });
    active.resolve({ Type: "cancelled", TotalBytes: 0 });
    await pausing;
    expect(manager.readDownloadTasks()[0]).toMatchObject({ status: "paused", bytesDownloaded: downloaded, bytesTotal: total });
    expect(JSON.parse(storage.get("ghostbox:download-tasks:v1")!)[0].bytesTotal).toBe(total);
  });

  it("uses a positive total returned with cancellation even if no progress event arrived", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    const pausing = manager.pauseDownloadTask("10");
    active.resolve({ Type: "cancelled", TotalBytes: 100 });
    await pausing;
    expect(manager.readDownloadTasks()[0]).toMatchObject({ status: "paused", bytesTotal: 100 });
  });

  it("does not let zero-valued legacy totals hide a known stored total", () => {
    const tasks = manager.restoreDownloadTasks([{ appId: "10", downloadsRoot: "E:\\Games", status: "paused", totalBytesAll: 0, bytesTotal: 100 }]);
    expect(tasks[0].bytesTotal).toBe(100);
  });

  it("preserves download and write history when pausing and resuming the same game", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { readDownloadActivity } = await import("../src/lib/downloadActivity");
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "progress", BytesDownloaded: 10, BytesTotal: 100,
      SpeedBytesPerSecond: 10, BytesWritten: 12, WriteSpeedBytesPerSecond: 20 });
    expect(manager.readDownloadTasks()[0]).toMatchObject({ bytesWritten: 12, writeSpeedBytesPerSecond: 20 });
    const snapshot = readDownloadActivity();
    expect(snapshot.download).toEqual([{ time: 0, speed: 10 }]);
    expect(snapshot.write).toEqual([{ time: 0, speed: 20 }]);
    const pausing = manager.pauseDownloadTask("10");
    event({ AppId: "10", Type: "progress", BytesDownloaded: 11, BytesTotal: 100, WriteSpeedBytesPerSecond: 99 });
    expect(readDownloadActivity()).toBe(snapshot);
    first.resolve({ Type: "cancelled" });
    await pausing;
    expect(manager.readDownloadTasks()[0].writeSpeedBytesPerSecond).toBe(0);
    vi.setSystemTime(300_000);
    await manager.resumeDownloadTask("10");
    expect(readDownloadActivity()).toBe(snapshot);
    event({ AppId: "10", Type: "progress", BytesDownloaded: 20, BytesTotal: 100,
      SpeedBytesPerSecond: 30, BytesWritten: 20, WriteSpeedBytesPerSecond: 40 });
    expect(readDownloadActivity().download).toEqual([...snapshot.download, { time: 1000, speed: 30 }]);
    expect(readDownloadActivity().write).toEqual([...snapshot.write, { time: 1000, speed: 40 }]);
    second.resolve({ ...complete, BytesWritten: 100 });
    await flush();
    expect(manager.readDownloadTasks()[0]).toMatchObject({ status: "completed", bytesWritten: 100, writeSpeedBytesPerSecond: 0 });
  });

  it("does not clear activity when another game is only queued, but resets it when that game starts", async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { readDownloadActivity } = await import("../src/lib/downloadActivity");
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "progress", BytesDownloaded: 10, BytesTotal: 100, SpeedBytesPerSecond: 10, WriteSpeedBytesPerSecond: 20 });
    const snapshot = readDownloadActivity();
    await manager.enqueueDownload(game("20"));
    expect(readDownloadActivity()).toBe(snapshot);
    first.resolve(complete);
    await flush();
    expect(readDownloadActivity()).toMatchObject({ taskId: "20", download: [], write: [] });
    second.resolve(complete);
    await flush();
  });

  it("automatically allows available older manifests on the first download", async () => {
    await start();
    await manager.enqueueDownload(game());
    await flush();
    expect(api.downloadDepotGame.mock.calls[0][3]).toBe(true);
    expect(manager.readDownloadTasks()[0].status).toBe("completed");
  });

  it("resumes legacy stale-manifest failures without a separate confirmation", async () => {
    storage.set("ghostbox:download-tasks:v1", JSON.stringify([{
      appId: "10", downloadsRoot: "E:\\Games", status: "error",
      depotStatus: "stale-manifest", allowStale: false, errorMessage: "Old build",
    }]));
    await start();
    await manager.resumeDownloadTask("10");
    await flush();
    expect(api.downloadDepotGame.mock.calls[0][3]).toBe(true);
    expect(manager.readDownloadTasks()[0].status).toBe("completed");
    expect(manager.readDownloadTasks()[0].errorMessage).toBeUndefined();
  });

  it("retains the task when file deletion fails and only removes files with consent", async () => {
    await start();
    await manager.enqueueDownload(game());
    await flush();
    api.deleteDownloadOutputDir.mockRejectedValue(new Error("Steam is running"));
    await expect(manager.deleteDownloadTask("10", true)).rejects.toThrow("Steam is running");
    expect(manager.readDownloadTasks()).toHaveLength(1);
    api.deleteDownloadOutputDir.mockClear();
    await manager.deleteDownloadTask("10", false);
    expect(api.deleteDownloadOutputDir).not.toHaveBeenCalled();
    expect(manager.readDownloadTasks()).toHaveLength(0);
  });

  it("waits for cancellation before automatically deleting partial files, even without an explicit checkbox flag", async () => {
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "status", Status: "depot-plan", OutputDir: "E:\\Games\\Game", TotalBytes: 100 });
    const removal = manager.deleteDownloadTask("10", false);
    await flush();
    expect(api.cancelDepotGame).toHaveBeenCalledWith("10");
    expect(api.deleteDownloadOutputDir).not.toHaveBeenCalled();
    active.resolve({ Type: "cancelled" });
    await removal;
    expect(api.deleteDownloadOutputDir).toHaveBeenCalledWith("10", "E:\\Games", "E:\\Games\\Game");
    expect(manager.readDownloadTasks()).toEqual([]);
  });

  it("keeps a cancelled partial task if automatic residue cleanup fails", async () => {
    storage.set("ghostbox:download-tasks:v1", JSON.stringify([{ appId: "10", downloadsRoot: "E:\\Games", outputDir: "E:\\Games\\Game", status: "paused" }]));
    api.deleteDownloadOutputDir.mockResolvedValue(false);
    await expect(manager.deleteDownloadTask("10", false)).rejects.toThrow("Não foi possível remover os arquivos.");
    expect(manager.readDownloadTasks()).toHaveLength(1);
  });

  it("updates migrated destination paths when library registration is repaired", async () => {
    api.downloadDepotGame.mockResolvedValue({ ...complete, SteamIntegration: { Status: "library-not-registered", Message: "Close Steam" } });
    api.registerDownloadLibrary.mockResolvedValue({ Status: "ok", DownloadsRoot: "F:\\Games", OutputDir: "F:\\Games\\Game" });
    await start();
    await manager.enqueueDownload(game());
    await flush();
    await manager.repairDownloadLibrary("10");
    expect(manager.readDownloadTasks()[0]).toMatchObject({ steamIntegration: { status: "ok" }, downloadsRoot: "F:\\Games", outputDir: "F:\\Games\\Game" });
  });

  it("reports listener initialization failures instead of starting an invisible download", async () => {
    api.onDownloadProgress.mockRejectedValue(new Error("IPC unavailable"));
    await start();
    await expect(manager.enqueueDownload(game())).rejects.toThrow("IPC unavailable");
    expect(api.downloadDepotGame).not.toHaveBeenCalled();
  });

  it("drops stale speed estimates when progress stops", async () => {
    vi.useFakeTimers();
    const active = deferred<Record<string, unknown>>();
    api.downloadDepotGame.mockReturnValueOnce(active.promise);
    await start();
    await manager.enqueueDownload(game());
    event({ AppId: "10", Type: "progress", BytesDownloaded: 10, BytesTotal: 100, SpeedBytesPerSecond: 10 });
    vi.advanceTimersByTime(500);
    event({ AppId: "10", Type: "progress", BytesDownloaded: 20, BytesTotal: 100, SpeedBytesPerSecond: 10 });
    expect(manager.readDownloadTasks()[0].speedBytesPerSecond).toBe(10);
    vi.advanceTimersByTime(8000);
    expect(manager.readDownloadTasks()[0].speedBytesPerSecond).toBe(0);
    active.resolve(complete);
    await flush();
  });
});
