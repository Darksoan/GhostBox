# Downloads Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar "Downloads" page that shows live, per-game download cards (progress bar, speed, downloaded/remaining size), fed by the existing `cdndownload_download_game` Tauri command and wired to the game modal's "Download" button.

**Architecture:** A standalone, React-agnostic module (`src/lib/downloadManager.ts`, same shape as the existing `src/lib/appNotifications.ts`) owns a serial download queue, subscribes to the `download-progress` Tauri event, and persists finished tasks to `localStorage`. It exposes plain functions and a `CustomEvent` change signal; the Sidebar badge and the new `DownloadsPage` both subscribe to it directly, without going through `AppDataContext`. Completion/failure is always decided from the resolved value of `ghostboxApi.downloadDepotGame(...)` (not from streamed events), because most streamed `download-progress` events lack `AppId`/`DepotId` and are only safe to attribute to "whatever the single active download currently is."

**Tech Stack:** React 18 + TypeScript (Vite), Tauri v2 (`@tauri-apps/api/event` `listen`), SCSS with the project's CSS custom-property design tokens, Rust (`src-tauri/src/cdndownload.rs`).

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-30-downloads-page-design.md`.
- Serial download queue only — one task `downloading` at a time (see spec "Concurrency Model"). No cancel-in-progress, no pause/resume, no concurrent downloads.
- History (`completed`/`error` tasks) persists to `localStorage` key `ghostbox:download-tasks:v1`. Live `queued`/`downloading` state is in-memory only.
- All new UI text goes through `src/i18n.ts` under both `pt` and `en`, consumed via `t()` from `useSettings()` — never hardcode user-facing strings.
- All new styling uses existing design tokens from `src/app.scss` `:root` (see `DESIGN_TOKENS.md`) — no new hardcoded colors/spacing.
- **No automated test runner exists in this repo** (no vitest/jest, `package.json` has no `test` script). Each task's verification step is therefore `npx tsc -p tsconfig.json` (must exit 0, `strict`/`noUnusedLocals`/`noUnusedParameters` are on) for TypeScript changes, `cargo check` for the Rust change, plus — where the task changes visible behavior — a concrete manual check via the browser preview tool. This replaces the red/green unit-test cycle for this plan.
- Follow existing patterns exactly where one exists: `src/lib/appNotifications.ts` for the manager-module shape, `src/pages/NotificationsPage.tsx` / `.notifications-hub` SCSS for the page shape, `onSteamAccountStatsUpdated` in `src/lib/ghostboxApi.tauri.ts` for the Tauri event-listener wrapper shape.

---

### Task 1: Backend — emit total depot count before the download loop

**Files:**
- Modify: `src-tauri/src/cdndownload.rs:121-130`

**Interfaces:**
- Produces: an additional `download-progress` event `{ Type: "status", Status: "depot-plan", AppId: string, DepotTotal: number }`, emitted once per `cdndownload_download_game` call, before any `starting-depot` event. `AppId` is the same `app_id: String` parameter already used elsewhere in this file (JSON-serializes as a string, not a number).

- [ ] **Step 1: Read the current code around the depot loop start**

Current content at `src-tauri/src/cdndownload.rs:121-131`:

```rust
    let depots = resolve_depots(&steam_path, &app_id);
    if depots.is_empty() {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "no-depots",
            "Message": format!("No depots found for app {app_id} in OST Lua or depotcache.")
        }));
    }

    let mut all_results = Vec::new();

    for (depot_id, manifest_id) in &depots {
```

- [ ] **Step 2: Insert the `depot-plan` emit right after the empty check, before `all_results` is declared**

Replace that block with:

```rust
    let depots = resolve_depots(&steam_path, &app_id);
    if depots.is_empty() {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "no-depots",
            "Message": format!("No depots found for app {app_id} in OST Lua or depotcache.")
        }));
    }

    app.emit(
        "download-progress",
        serde_json::json!({
            "Type": "status",
            "Status": "depot-plan",
            "AppId": app_id,
            "DepotTotal": depots.len(),
        }),
    )
    .ok();

    let mut all_results = Vec::new();

    for (depot_id, manifest_id) in &depots {
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: exits 0, no new warnings about unused variables in `cdndownload.rs`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/cdndownload.rs
git commit -m "feat(downloads): emit total depot count before starting a game download"
```

---

### Task 2: Add "downloads" to the Page union

**Files:**
- Modify: `src/types/index.ts:3`

**Interfaces:**
- Produces: `Page` now includes `"downloads"`.

- [ ] **Step 1: Edit the union**

Current line 3:

```ts
export type Page = "home" | "catalogue" | "library" | "favorites" | "settings" | "profile" | "notifications";
```

Replace with:

```ts
export type Page = "home" | "catalogue" | "library" | "favorites" | "settings" | "profile" | "notifications" | "downloads";
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0 (nothing consumes `Page` exhaustively yet, so no new errors should appear).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(downloads): add downloads page to the Page union"
```

---

### Task 3: Add `ghostboxApi.onDownloadProgress`

**Files:**
- Modify: `src/lib/ghostboxApi.tauri.ts` (insert after the `onSteamAccountStatsUpdated` method, currently ending at line 898)

**Interfaces:**
- Consumes: `listen` from `@tauri-apps/api/event` (already imported at the top of this file).
- Produces: `ghostboxApi.onDownloadProgress(callback: (payload: Record<string, unknown>) => void): () => void` — subscribes to the Tauri `"download-progress"` event, returns an unlisten function. Payload is intentionally untyped here (`Record<string, unknown>`); the caller (`downloadManager.ts`, Task 5) narrows it, because the same event name carries several different shapes (see spec "Event Handling").

- [ ] **Step 1: Locate the insertion point**

Current content at the end of `onSteamAccountStatsUpdated` (`src/lib/ghostboxApi.tauri.ts:879-898`):

```ts
  onSteamAccountStatsUpdated(
    callback: (stats: SteamAccountStats) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SteamAccountStats>("steam-account-stats-updated", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },
```

- [ ] **Step 2: Add the new method right after it**

Insert immediately after the closing `},` of `onSteamAccountStatsUpdated` shown above:

```ts

  onDownloadProgress(
    callback: (payload: Record<string, unknown>) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<Record<string, unknown>>("download-progress", (event) => {
      callback(event.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghostboxApi.tauri.ts
git commit -m "feat(downloads): add onDownloadProgress Tauri event listener"
```

---

### Task 4: i18n keys for downloads

**Files:**
- Modify: `src/i18n.ts` (four insertion points: `pt.nav`, after `pt.notifications`, `en.nav`, after `en.notifications`)

**Interfaces:**
- Produces: translation keys `nav.downloads`, and `downloads.title`, `downloads.description`, `downloads.clear`, `downloads.emptyTitle`, `downloads.emptyMessage`, `downloads.remove`, `downloads.queuePosition`, `downloads.statusDownloading`, `downloads.statusCompleted`, `downloads.statusError`, `downloads.remaining`, `downloads.totalDownloaded`, `downloads.failedFiles`, `downloads.genericError`, `downloads.depotOf`, `downloads.status.starting`, `downloads.status.keyResolved`, `downloads.status.loadingManifest`, `downloads.status.manifestLoaded`, `downloads.status.connectingSteam`, `downloads.status.steamConnected`, `downloads.status.cdnReady`, `downloads.status.startingDepot` — in both `pt` and `en`. Task 7 (`DownloadsPage.tsx`) consumes all of these by exact key.

- [ ] **Step 1: Add `downloads` to the `pt.nav` block**

Current content at `src/i18n.ts:9-14`:

```ts
    nav: {
      home: "Início",
      catalogue: "Catálogo",
      library: "Biblioteca",
      settings: "Ajustes",
    },
```

Replace with:

```ts
    nav: {
      home: "Início",
      catalogue: "Catálogo",
      library: "Biblioteca",
      downloads: "Downloads",
      settings: "Ajustes",
    },
```

- [ ] **Step 2: Add a `pt.downloads` block right after `pt.notifications`**

Current content at `src/i18n.ts:39-47`:

```ts
    notifications: {
      title: "Notificações",
      description: "Acompanhe eventos importantes do GhostBox sem sair do app.",
      loading: "Carregando notificações...",
      filters: "Filtros de notificações",
      clear: "Limpar histórico",
      emptyTitle: "Nenhuma notificação por enquanto",
      emptyMessage: "Backups, conquistas, conta, downloads e alertas do sistema aparecerão aqui.",
    },
```

Insert this new block immediately after its closing `},`:

```ts
    downloads: {
      title: "Downloads",
      description: "Acompanhe o progresso dos downloads de jogos iniciados pelo GhostBox.",
      clear: "Limpar concluídos",
      emptyTitle: "Nenhum download por enquanto",
      emptyMessage: "Downloads iniciados pelo modal de um jogo aparecerão aqui.",
      remove: "Remover",
      queuePosition: "Na fila — posição {position}",
      statusDownloading: "Baixando",
      statusCompleted: "Concluído",
      statusError: "Erro",
      remaining: "Restante: {size}",
      totalDownloaded: "{size} baixados",
      failedFiles: "{count} arquivo(s) com falha",
      genericError: "Não foi possível concluir o download.",
      depotOf: "Depot {index} de {total}",
      status: {
        starting: "Iniciando",
        keyResolved: "Chave obtida",
        loadingManifest: "Carregando manifesto",
        manifestLoaded: "Manifesto carregado",
        connectingSteam: "Conectando à Steam",
        steamConnected: "Conectado à Steam",
        cdnReady: "CDN pronta",
        startingDepot: "Iniciando depot",
      },
    },
```

- [ ] **Step 3: Add `downloads` to the `en.nav` block**

Current content at `src/i18n.ts:351-356`:

```ts
    nav: {
      home: "Home",
      catalogue: "Catalogue",
      library: "Library",
      settings: "Settings",
    },
```

Replace with:

```ts
    nav: {
      home: "Home",
      catalogue: "Catalogue",
      library: "Library",
      downloads: "Downloads",
      settings: "Settings",
    },
```

- [ ] **Step 4: Add an `en.downloads` block right after `en.notifications`**

Current content at `src/i18n.ts:381-389`:

```ts
    notifications: {
      title: "Notifications",
      description: "Track important GhostBox events without leaving the app.",
      loading: "Loading notifications...",
      filters: "Notification filters",
      clear: "Clear history",
      emptyTitle: "No notifications yet",
      emptyMessage: "Backups, achievements, account, downloads, and system alerts will appear here.",
    },
```

Insert this new block immediately after its closing `},`:

```ts
    downloads: {
      title: "Downloads",
      description: "Track the progress of game downloads started from GhostBox.",
      clear: "Clear completed",
      emptyTitle: "No downloads yet",
      emptyMessage: "Downloads started from a game's modal will appear here.",
      remove: "Remove",
      queuePosition: "Queued — position {position}",
      statusDownloading: "Downloading",
      statusCompleted: "Completed",
      statusError: "Error",
      remaining: "Remaining: {size}",
      totalDownloaded: "{size} downloaded",
      failedFiles: "{count} file(s) failed",
      genericError: "Could not complete the download.",
      depotOf: "Depot {index} of {total}",
      status: {
        starting: "Starting",
        keyResolved: "Key resolved",
        loadingManifest: "Loading manifest",
        manifestLoaded: "Manifest loaded",
        connectingSteam: "Connecting to Steam",
        steamConnected: "Connected to Steam",
        cdnReady: "CDN ready",
        startingDepot: "Starting depot",
      },
    },
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(downloads): add pt/en translations for the downloads page"
```

---

### Task 5: Download manager module (queue engine + storage)

**Files:**
- Create: `src/lib/downloadManager.ts`

**Interfaces:**
- Consumes: `ghostboxApi.downloadDepotGame(appId: string, outputDir: string): Promise<Record<string, unknown>>` (existing), `ghostboxApi.onDownloadProgress(callback): () => void` (Task 3), `getGameAppId(game: GhostBoxGame): string` (existing, `src/utils/image.ts`), `GhostBoxGame` type (existing, `src/data.ts`, fields used: `appId`, `title`, `coverUrl`).
- Produces (consumed by Tasks 7, 8, 9, 10):
  - `type DownloadTaskStatus = "queued" | "downloading" | "completed" | "error"`
  - `type DownloadTask` (full shape below)
  - `downloadTasksChangedEvent: string` — a `window` `CustomEvent` name
  - `readDownloadTasks(): DownloadTask[]` — live tasks first, then history
  - `getActiveDownloadCount(): number`
  - `enqueueDownload(game: GhostBoxGame, outputDir: string): void`
  - `removeDownloadTask(id: string): void`
  - `clearFinishedDownloadTasks(): void`
  - `startDownloadManager(): () => void` — starts the Tauri event subscription once; returns a stop function

- [ ] **Step 1: Create the file**

```ts
import { ghostboxApi } from "./ghostboxApi";
import type { GhostBoxGame } from "../data";
import { getGameAppId } from "../utils/image";

export type DownloadTaskStatus = "queued" | "downloading" | "completed" | "error";

export type DownloadTask = {
  id: string;
  appId: string;
  title: string;
  coverUrl: string;
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
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeHistoryTask)
      .filter((task): task is DownloadTask => task !== null)
      .slice(0, maxStoredHistory);
  } catch {
    return [];
  }
}

function writeHistoryTasks(tasks: DownloadTask[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(tasks.slice(0, maxStoredHistory)));
  } catch {
    // History is best-effort only.
  }
}

function notifyChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(downloadTasksChangedEvent));
}

export function readDownloadTasks(): DownloadTask[] {
  return [...liveTasks, ...readHistoryTasks()];
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

  const finished: DownloadTask = {
    ...task,
    status: topLevelFailed || anyDepotFailed ? "error" : "completed",
    finishedAt: Date.now(),
    totalBytesDownloaded,
    totalBytesAll,
    failedFiles,
    errorMessage: typeof result.Message === "string" ? result.Message : undefined,
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0. Since nothing imports this module yet, watch specifically for `noUnusedLocals`/`noUnusedParameters` failures inside the new file itself (e.g. an unused destructured variable) — everything exported above is used by later tasks, so none should fire.

- [ ] **Step 3: Commit**

```bash
git add src/lib/downloadManager.ts
git commit -m "feat(downloads): add the download queue manager module"
```

---

### Task 6: `formatBytes` util

**Files:**
- Create: `src/utils/formatBytes.ts`

**Interfaces:**
- Produces: `formatBytes(bytes: number): string` (e.g. `1536` → `"1.5 KB"`), `formatSpeed(bytesPerSecond: number): string` (e.g. `"1.5 KB/s"`). Consumed by Task 7.

- [ ] **Step 1: Create the file**

```ts
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 3: Manually sanity-check the formatting**

Run: `node -e "const m=require('node:module');const fs=require('node:fs');const src=fs.readFileSync('src/utils/formatBytes.ts','utf8').replace('export function','function').replace(/export function formatSpeed[\\s\\S]*/,'');eval(src);console.log(formatBytes(0),formatBytes(512),formatBytes(1536),formatBytes(5*1024*1024),formatBytes(3*1024*1024*1024));"`
Expected output: `0 B 512 B 1.5 KB 5 MB 3 GB`

- [ ] **Step 4: Commit**

```bash
git add src/utils/formatBytes.ts
git commit -m "feat(downloads): add formatBytes/formatSpeed util"
```

---

### Task 7: `DownloadsPage` UI + styles

**Files:**
- Create: `src/pages/DownloadsPage.tsx`
- Modify: `src/app.scss` (two insertion points: new `.downloads-page`/`.download-card` block, and the narrow-width `.notifications-page` responsive rule)

**Interfaces:**
- Consumes: `DownloadTask`, `downloadTasksChangedEvent`, `readDownloadTasks`, `removeDownloadTask`, `clearFinishedDownloadTasks` (Task 5); `formatBytes`, `formatSpeed` (Task 6); `EmptyState` (existing, `src/components/ui/LoadingStates.tsx`, props `title`, `description`, `className`); `useSettings()` → `t()` (existing).
- Produces: `export function DownloadsPage(): JSX.Element` — no props, self-contained (matches `NotificationsPage`'s shape). Consumed by Task 9.

- [ ] **Step 1: Create `src/pages/DownloadsPage.tsx`**

```tsx
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
            {depotStatusKey ? ` \u00b7 ${t(depotStatusKey)}` : ""}
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
```

- [ ] **Step 2: Add `.downloads-page` and `.download-card` styles to `src/app.scss`**

Current content at `src/app.scss:8364-8377`:

```scss
.notification-group .notifications-list {
  padding: 0 0 var(--space-6);
}

.backup-page {
```

Replace with (inserting the two new blocks between them):

```scss
.notification-group .notifications-list {
  padding: 0 0 var(--space-6);
}

.downloads-page {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 0 var(--space-10) var(--space-12);
  gap: var(--space-8);
  min-height: 100%;
  height: auto;
  overflow: visible;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-8);
    padding: 0;

    h2 {
      margin: 0 0 var(--space-3);
      color: var(--text-primary);
      font-size: var(--fs-700);
      font-weight: var(--weight-semibold);
      line-height: 1.2;
    }

    p {
      max-width: 620px;
      margin: 0;
      color: var(--text-secondary);
      font-size: var(--fs-400);
      font-weight: var(--weight-semibold);
      line-height: 1.5;
    }
  }

  &__clear {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 0 var(--space-8);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--background-dark);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--fs-300);
    font-weight: var(--weight-medium);
    line-height: 1.2;
    transition:
      border-color var(--motion-fast) ease,
      background var(--motion-fast) ease,
      color var(--motion-fast) ease;

    &:hover:not(:disabled),
    &:focus-visible:not(:disabled) {
      border-color: var(--border-hover);
      background: var(--surface-secondary);
      color: var(--text-primary);
    }

    &:disabled {
      cursor: default;
      opacity: 0.55;
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  &__empty.empty-state {
    min-height: 280px;
  }
}

.download-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-8);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-tertiary);
  transition:
    border-color var(--motion-fast) ease,
    background var(--motion-fast) ease;

  &:hover {
    border-color: var(--border-hover);
  }

  &--error {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }

  &__header {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-6);
  }

  &__cover {
    width: 42px;
    height: 42px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background-dark);
    object-fit: cover;
  }

  &__title-group {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-3);

    strong {
      overflow: hidden;
      color: var(--text-primary);
      font-size: var(--fs-400);
      font-weight: var(--weight-semibold);
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__status-pill {
    width: max-content;
    padding: 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--background-dark);
    color: var(--text-secondary);
    font-size: var(--fs-100);
    font-weight: var(--weight-medium);
    line-height: 20px;
  }

  &--completed &__status-pill {
    color: var(--success);
  }

  &--error &__status-pill {
    color: var(--danger);
  }

  &__remove {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--background-dark);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      border-color var(--motion-fast) ease,
      color var(--motion-fast) ease;

    &:hover,
    &:focus-visible {
      border-color: var(--border-hover);
      color: var(--text-primary);
    }
  }

  &__progress-track {
    width: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--background-dark);
  }

  &__progress-fill {
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--accent);
    transition: width var(--motion-base) var(--ease);
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    color: var(--text-secondary);
    font-size: var(--fs-200);
    font-weight: var(--weight-semibold);
  }

  &__depot-caption {
    color: var(--text-tertiary);
    font-size: var(--fs-100);
    font-weight: var(--weight-semibold);
  }

  &__error {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-300);
    font-weight: var(--weight-medium);
  }
}

.backup-page {
```

- [ ] **Step 3: Add the narrow-width padding override**

Current content at `src/app.scss:13935-13937`:

```scss
  .notifications-page {
    padding: 0 var(--space-6) var(--space-6);
  }
```

Replace with:

```scss
  .notifications-page,
  .downloads-page {
    padding: 0 var(--space-6) var(--space-6);
  }
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/DownloadsPage.tsx src/app.scss
git commit -m "feat(downloads): add the DownloadsPage UI and card styles"
```

---

### Task 8: Sidebar nav entry + badge

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `downloadTasksChangedEvent`, `getActiveDownloadCount` (Task 5); `Download` icon from `lucide-react`; `t("nav.downloads")` (Task 4).
- Produces: no new exports — the `Sidebar` component now renders a "Downloads" nav item that calls the existing `onNavigate("downloads")` prop.

- [ ] **Step 1: Import `Download` icon, `useEffect`/`useState` (already imported), and the download manager helpers**

Current content at `src/components/layout/Sidebar.tsx:1-25`:

```tsx
import {
  ChevronRight,
  Folder,
  Heart,
  Home,
  Layers,
  Pencil,
  RefreshCw,
  Settings,
  Trash,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useDeferredValue, useMemo, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { ContextMenu } from "../ui/ContextMenu";
import { useCollectionContextMenu } from "../../hooks/useCollectionContextMenu";
import { preloadGameIconUrls, useGameIconUrl } from "../../hooks/useGameIconUrl";
import { settingsNavigationTabs, settingsTabLabelKeys, type SettingsTabId } from "../../features/settings/settingsTabsShared";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadGameModalAssetsThrottled, preloadProfileImages } from "../../utils/image";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { Grid } from "reicon-react";
```

Replace with:

```tsx
import {
  ChevronRight,
  Download,
  Folder,
  Heart,
  Home,
  Layers,
  Pencil,
  RefreshCw,
  Settings,
  Trash,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useDeferredValue, useMemo, useState } from "react";
import type { GhostBoxGame } from "../../data";
import type { Page, SteamProfile, UserCollection } from "../../types";
import { ContextMenu } from "../ui/ContextMenu";
import { useCollectionContextMenu } from "../../hooks/useCollectionContextMenu";
import { preloadGameIconUrls, useGameIconUrl } from "../../hooks/useGameIconUrl";
import { settingsNavigationTabs, settingsTabLabelKeys, type SettingsTabId } from "../../features/settings/settingsTabsShared";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageSource } from "../../hooks/useCachedImageSources";
import { preloadGameModalAssetsThrottled, preloadProfileImages } from "../../utils/image";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { downloadTasksChangedEvent, getActiveDownloadCount } from "../../lib/downloadManager";
import { Grid } from "reicon-react";
```

- [ ] **Step 2: Add "downloads" to the `navigation` array**

Current content at `src/components/layout/Sidebar.tsx:29-33`:

```tsx
const navigation: { id: Page; icon: SidebarNavIcon; labelKey: string }[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Layers },
];
```

Replace with:

```tsx
const navigation: { id: Page; icon: SidebarNavIcon; labelKey: string }[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Layers },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
];
```

- [ ] **Step 3: Track the active download count inside the component**

Current content at `src/components/layout/Sidebar.tsx:139` (right after `const { t } = useSettings();` inside the `Sidebar` component body — this line currently reads):

```tsx
  const { t } = useSettings();
```

Replace with:

```tsx
  const { t } = useSettings();
  const [activeDownloadCount, setActiveDownloadCount] = useState(() => getActiveDownloadCount());

  useEffect(() => {
    const refresh = () => setActiveDownloadCount(getActiveDownloadCount());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, []);
```

- [ ] **Step 4: Render the badge on the Downloads nav item**

Current content at `src/components/layout/Sidebar.tsx:256-272` (the main navigation `<ul>`):

```tsx
          <nav className="sidebar__section sidebar__mode-panel" >
            <ul className="sidebar__menu">
              {navigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                  </button>
                </li>
              ))}
```

Replace the `<li>` body with one that renders the badge only for the `downloads` entry:

```tsx
          <nav className="sidebar__section sidebar__mode-panel" >
            <ul className="sidebar__menu">
              {navigation.map(({ id, labelKey, icon: Icon }) => (
                <li
                  key={id}
                  className={`sidebar__menu-item ${activePage === id ? "sidebar__menu-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => onNavigate(id)}
                  >
                    <Icon size={19} strokeWidth={2} />
                    <span className="sidebar__menu-item-label">{t(labelKey)}</span>
                    {id === "downloads" && activeDownloadCount > 0 && (
                      <strong>{activeDownloadCount > 99 ? "99+" : activeDownloadCount}</strong>
                    )}
                  </button>
                </li>
              ))}
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat(downloads): add Downloads nav entry with active-count badge"
```

---

### Task 9: Wire the Downloads page into `PageRouter`

**Files:**
- Modify: `src/components/routing/PageRouter.tsx`

**Interfaces:**
- Consumes: `DownloadsPage` (Task 7).
- Produces: `page === "downloads"` now renders `<DownloadsPage />` and is included in keep-alive/prefetch machinery, matching every other top-level page.

- [ ] **Step 1: Add the lazy import**

Current content at `src/components/routing/PageRouter.tsx:55-60`:

```tsx
const LazyNotificationsPage = lazy(() =>
  import("../../pages/NotificationsPage").then((m) => {
    markPageLoaded("notifications");
    return { default: m.NotificationsPage };
  }),
);
```

Insert immediately after it:

```tsx
const LazyDownloadsPage = lazy(() =>
  import("../../pages/DownloadsPage").then((m) => {
    markPageLoaded("downloads");
    return { default: m.DownloadsPage };
  }),
);
```

- [ ] **Step 2: Add `"downloads"` to `KEEP_ALIVE_PAGES`**

Current content at `src/components/routing/PageRouter.tsx:62-70`:

```tsx
const KEEP_ALIVE_PAGES: Page[] = [
  "home",
  "catalogue",
  "library",
  "favorites",
  "settings",
  "profile",
  "notifications",
];
```

Replace with:

```tsx
const KEEP_ALIVE_PAGES: Page[] = [
  "home",
  "catalogue",
  "library",
  "favorites",
  "settings",
  "profile",
  "notifications",
  "downloads",
];
```

- [ ] **Step 3: Add a prefetch delay**

Current content at `src/components/routing/PageRouter.tsx:72-80`:

```tsx
const PREFETCH_DELAYS_MS: Record<Page, number> = {
  home: 1_800,
  catalogue: 1_800,
  library: 2_200,
  favorites: 2_200,
  settings: 3_200,
  profile: 3_600,
  notifications: 3_200,
};
```

Replace with:

```tsx
const PREFETCH_DELAYS_MS: Record<Page, number> = {
  home: 1_800,
  catalogue: 1_800,
  library: 2_200,
  favorites: 2_200,
  settings: 3_200,
  profile: 3_600,
  notifications: 3_200,
  downloads: 3_200,
};
```

- [ ] **Step 4: Add the page loader**

Current content at `src/components/routing/PageRouter.tsx:82-90`:

```tsx
const PAGE_LOADERS: Record<Page, () => Promise<unknown>> = {
  home: () => import("../../pages/HomePage"),
  catalogue: () => import("../../pages/CataloguePage"),
  library: () => import("../../pages/LibraryPage"),
  favorites: () => import("../../pages/FavoritesPage"),
  settings: () => import("../../pages/SettingsPage"),
  profile: loadProfilePage,
  notifications: () => import("../../pages/NotificationsPage"),
};
```

Replace with:

```tsx
const PAGE_LOADERS: Record<Page, () => Promise<unknown>> = {
  home: () => import("../../pages/HomePage"),
  catalogue: () => import("../../pages/CataloguePage"),
  library: () => import("../../pages/LibraryPage"),
  favorites: () => import("../../pages/FavoritesPage"),
  settings: () => import("../../pages/SettingsPage"),
  profile: loadProfilePage,
  notifications: () => import("../../pages/NotificationsPage"),
  downloads: () => import("../../pages/DownloadsPage"),
};
```

- [ ] **Step 5: Render it in `renderPage`**

Current content at `src/components/routing/PageRouter.tsx:381-386`:

```tsx
    if (targetPage === "notifications") {
      return <LazyNotificationsPage />;
    }

    return null;
  }
```

Replace with:

```tsx
    if (targetPage === "notifications") {
      return <LazyNotificationsPage />;
    }

    if (targetPage === "downloads") {
      return <LazyDownloadsPage />;
    }

    return null;
  }
```

- [ ] **Step 6: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/routing/PageRouter.tsx
git commit -m "feat(downloads): route the downloads page"
```

---

### Task 10: Wire the game modal's Download button + start the engine

**Files:**
- Modify: `src/components/routing/ContentOverlay.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `enqueueDownload` (Task 5) in `ContentOverlay.tsx`; `startDownloadManager` (Task 5) in `App.tsx`.
- Produces: clicking "Download" in the game modal now registers a task in the download manager instead of firing an untracked `ghostboxApi.downloadDepotGame` call; the download engine's Tauri event subscription is active for the lifetime of the app.

- [ ] **Step 1: Import `enqueueDownload` in `ContentOverlay.tsx`**

Current content at `src/components/routing/ContentOverlay.tsx:1-10`:

```tsx
import { lazy, Suspense, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { PagePlaceholder } from "../ui/LoadingStates";
import type { Page, SteamAccountStats } from "../../types";
import { getGameAppId } from "../../utils/image";
```

Replace with:

```tsx
import { lazy, Suspense, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { enqueueDownload } from "../../lib/downloadManager";
import { PagePlaceholder } from "../ui/LoadingStates";
import type { Page, SteamAccountStats } from "../../types";
import { getGameAppId } from "../../utils/image";
```

- [ ] **Step 2: Replace the untracked download call**

Current content at `src/components/routing/ContentOverlay.tsx:209-214`:

```tsx
            onDownloadGame={() => {
              const appId = getGameAppId(mergedGame);
              const steamPath = appData.steamPathInput || "C:\\Program Files (x86)\\Steam";
              const outputDir = `${steamPath}\\..\\GhostBoxDownloads\\${appId}`;
              ghostboxApi.downloadDepotGame(appId, outputDir).catch(console.error);
            }}
```

Replace with:

```tsx
            onDownloadGame={() => {
              const appId = getGameAppId(mergedGame);
              const steamPath = appData.steamPathInput || "C:\\Program Files (x86)\\Steam";
              const outputDir = `${steamPath}\\..\\GhostBoxDownloads\\${appId}`;
              enqueueDownload(mergedGame, outputDir);
            }}
```

- [ ] **Step 3: Verify `ghostboxApi` is still used elsewhere in `ContentOverlay.tsx`**

Run: `grep -n "ghostboxApi\." src/components/routing/ContentOverlay.tsx`
Expected: at least one remaining match (e.g. `ghostboxApi.getSteamPlayerLevel` or similar) — if `ghostboxApi` ends up completely unused after this edit, remove its import too (it currently isn't, so no action is expected here beyond checking).

- [ ] **Step 4: Start the download manager once from `App.tsx`**

Current content at `src/App.tsx:14`:

```tsx
import { ghostboxApi } from "./lib/ghostboxApi";
```

Replace with:

```tsx
import { ghostboxApi } from "./lib/ghostboxApi";
import { startDownloadManager } from "./lib/downloadManager";
```

Current content at `src/App.tsx:158-164`:

```tsx
  useEffect(() => {
    return ghostboxApi.onCatalogueCacheUpdated(() => {
      clearCatalogueGamesCache();
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    });
  }, [queryClient]);
```

Insert immediately after it:

```tsx

  useEffect(() => {
    return startDownloadManager();
  }, []);
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/routing/ContentOverlay.tsx src/App.tsx
git commit -m "feat(downloads): connect the game modal Download button to the queue"
```

---

### Task 11: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the app in the browser preview**

Use the `preview_start` tool with `{name: "tauri-dev"}` if `.claude/launch.json` already defines a dev server config for this project (check first — if it doesn't exist, add a configuration running `npm run tauri:dev` or `npm run dev`, matching whichever the project normally uses to preview UI changes). Wait for it to be ready and open the app.

- [ ] **Step 2: Confirm the Downloads page renders empty**

Navigate to the Downloads sidebar entry. Expected: the "Downloads" nav item appears between Library and Settings, no badge is shown, and the page shows the empty state (`t("downloads.emptyTitle")`/`t("downloads.emptyMessage")`).

- [ ] **Step 3: Start a real download and confirm the card updates**

Open a game modal for a game that is installed via LuaTools/OST (has depot/manifest data) but not yet downloaded through this flow, click "Download". Expected:
- The sidebar badge appears showing `1`.
- Navigating to Downloads shows one card in `downloading` status, with a cover, title, progress bar starting to move, speed, and a "Depot 1 de N" caption once the `depot-plan` event lands.
- Downloaded/total/remaining sizes update live as `download-progress` events arrive (check via `read_console_messages`/`read_network_requests` is not applicable here since this is a Tauri event, not HTTP — rely on the visible UI updating).

- [ ] **Step 4: Confirm completion moves the task to history**

Wait for the download to finish (or let it fail naturally if the environment doesn't have real Steam CDN access — either path is acceptable for this check). Expected: the card status flips to `completed` or `error`, the sidebar badge disappears (back to 0 active), and a remove (×) button appears on the finished card.

- [ ] **Step 5: Confirm "Limpar concluídos" and persistence**

Click "Limpar concluídos" — the finished card should disappear and the button should become disabled again. Reload the app (or navigate away and back) — since history was already cleared, the page should show the empty state again. If instead you want to confirm persistence, skip the clear step and reload the app before clearing: the finished card should still be there (read from `localStorage` key `ghostbox:download-tasks:v1`).

- [ ] **Step 6: Take a screenshot for the record**

Use `computer {action: "screenshot"}` on the Downloads page (ideally with one card in each visually distinct state you can reproduce) and share it as proof of the working feature.

No commit for this task — it's verification only. If any step surfaces a bug, fix it in the relevant task's file, re-run that task's `npx tsc -p tsconfig.json` check, and re-verify from the failing step.
