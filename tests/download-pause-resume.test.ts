import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri bridges are not available under vitest; the download engine is
// driven through the invoke mock below.
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async () => {},
  revealItemInDir: async () => {},
}));

type Manager = typeof import("../src/lib/downloadManager");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const game = {
  id: "steam-10",
  appId: "10",
  title: "Counter-Strike",
  coverUrl: "",
} as never;

function downloadInvokes() {
  return invoke.mock.calls.filter(([command]) => command === "cdndownload_download_game");
}

async function loadManager(): Promise<Manager> {
  vi.resetModules();
  return import("../src/lib/downloadManager");
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function installWindow() {
  // Completed tasks live in history, which is persisted through
  // window.localStorage — without it they vanish from readDownloadTasks().
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
    setTimeout: (...args: [any, ...any[]]) => setTimeout(...(args as [any])),
    clearTimeout: (id: unknown) => clearTimeout(id as any),
    dispatchEvent: () => true,
  };
  return store;
}

beforeEach(() => {
  invoke.mockReset();
  installWindow();
});

describe("download pause/resume", () => {
  it("treats a backend completion during pause as completed, not paused", async () => {
    // Regression: the pause intent used to override whatever the backend
    // returned, so a download that finished just before the cancel landed was
    // archived as `paused` and its bytes were discarded.
    const manager = await loadManager();
    const first = deferred<Record<string, unknown>>();
    invoke.mockImplementation((command: string) => {
      if (command === "cdndownload_download_game") return first.promise;
      if (command === "cdndownload_cancel_game") return Promise.resolve(true);
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });

    manager.enqueueDownload(game, "D:\\GhostBox");
    expect(manager.readDownloadTasks()[0]?.status).toBe("downloading");

    manager.pauseDownloadTask("10");
    expect(manager.readDownloadTasks()[0]?.status).toBe("paused");

    first.resolve({ Type: "complete", Depots: [], OutputDir: "D:\\GhostBox\\game" });
    await flush();
    await flush();

    const tasks = manager.readDownloadTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.resumePending).toBe(false);
  });

  it("restarts the download when resuming while the pause is still in flight", async () => {
    const manager = await loadManager();
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    let downloads = 0;
    invoke.mockImplementation((command: string) => {
      if (command === "cdndownload_download_game") {
        downloads += 1;
        return (downloads === 1 ? first : second).promise;
      }
      if (command === "cdndownload_cancel_game") return Promise.resolve(true);
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });

    manager.enqueueDownload(game, "D:\\GhostBox");
    manager.pauseDownloadTask("10");
    manager.resumeDownloadTask("10");

    // The old backend run is still alive; when it reports `cancelled` the
    // pending resume must start a new run instead of staying paused.
    first.resolve({ Type: "cancelled", Status: "cancelled", AppId: "10" });
    await flush();
    await flush();

    expect(downloadInvokes()).toHaveLength(2);
    expect(manager.readDownloadTasks()[0]?.status).toBe("downloading");

    second.resolve({ Type: "complete", Depots: [], OutputDir: "D:\\GhostBox\\game" });
    await flush();
    await flush();
    expect(manager.readDownloadTasks()[0]?.status).toBe("completed");
  });

  it("restores downloading when the cancel command cannot be delivered", async () => {
    // Regression: the optimistic `paused` state used to stick even when the
    // cancel never reached the backend, so a later resume stayed pending
    // forever and the download "never came back".
    const manager = await loadManager();
    const first = deferred<Record<string, unknown>>();
    invoke.mockImplementation((command: string) => {
      if (command === "cdndownload_download_game") return first.promise;
      if (command === "cdndownload_cancel_game") return Promise.resolve(false);
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });

    manager.enqueueDownload(game, "D:\\GhostBox");
    manager.pauseDownloadTask("10");
    await flush();
    await flush();

    const task = manager.readDownloadTasks()[0];
    expect(task?.status).toBe("downloading");

    first.resolve({ Type: "complete", Depots: [], OutputDir: "D:\\GhostBox\\game" });
    await flush();
    await flush();
    expect(manager.readDownloadTasks()[0]?.status).toBe("completed");
  });
});
