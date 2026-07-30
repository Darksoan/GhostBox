# Downloads Page

## Goal

Add a "Downloads" page reachable from the sidebar so the user can watch the progress of game downloads started from the game modal: which depot is downloading, transfer speed, and bytes downloaded vs. remaining.

## Scope

- New sidebar nav entry "Downloads" with an active-count badge, using the existing `.sidebar__menu-item strong` pill pattern.
- New `DownloadsPage` listing download tasks as cards (queued, downloading, completed, error).
- Wire the game modal's "Download" button (currently `ContentOverlay.tsx`'s inline `onDownloadGame`) to register a task instead of firing-and-forgetting.
- A small additive event in `src-tauri/src/cdndownload.rs` so the UI knows the total depot count for a game up front.
- No cancel-in-progress support (backend has no process-kill command) and no download-speed throttling/config — out of scope.

## Concurrency Model

`cdndownload_download_game` downloads a game's depots sequentially in one Tauri command invocation, and most of the forwarded `download-progress` events (from the C# child process's own stdout) do **not** carry `AppId`/`DepotId` — only the Rust-side `starting-depot` event does. This makes it unsafe to attribute progress to the right game if two downloads run concurrently.

Decision: **serial queue**. Only one task is ever `downloading` at a time; additional "Download" clicks enqueue and start automatically when the active one finishes. This sidesteps the attribution problem entirely — with a single active task, every untagged event unambiguously belongs to it.

## Data Model & Persistence

New module `src/lib/downloadManager.ts` (same shape as `src/lib/appNotifications.ts`: plain functions + a `CustomEvent` change signal, no React dependency):

```ts
type DownloadTaskStatus = "queued" | "downloading" | "completed" | "error";

type DownloadTask = {
  id: string;            // = appId, one task per appId (re-download replaces it)
  appId: string;
  title: string;
  coverUrl: string;
  outputDir: string;
  status: DownloadTaskStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  depotIndex: number;    // 1-based, current/last depot processed
  depotTotal: number;    // 0 until the depot-plan event arrives
  depotStatus?: string;  // raw Status string of latest event, for a friendly label
  bytesDownloaded: number; // current depot, live
  bytesTotal: number;      // current depot, live (0 until manifest-loaded)
  speedBytesPerSecond: number;
  totalBytesDownloaded?: number; // filled at completion, summed across depots
  totalBytesAll?: number;
  failedFiles?: number;
  errorMessage?: string;
};
```

- History (`completed`/`error` tasks) persists to `localStorage` under `ghostbox:download-tasks:v1`, mirroring the `appNotifications.ts` read/write/normalize pattern. Live `queued`/`downloading` state is in-memory only (an in-progress download doesn't need to survive a full app restart; if the app restarts mid-download the task is simply gone, matching how the queue itself isn't durable either).
- `downloadTasksChangedEvent` (a `window` `CustomEvent`) notifies subscribers (Sidebar badge, DownloadsPage) on every mutation.
- Exported functions: `enqueueDownload(game, outputDir)`, `readDownloadTasks()`, `clearFinishedDownloadTasks()`, `removeDownloadTask(id)` (only for `queued`/finished tasks), `getActiveDownloadCount()`.
- The engine (queue draining + Tauri event subscription) is started once via `startDownloadManager()`, called from a `useEffect` in `App.tsx` on mount — same lifecycle spot as other one-time app initialization.

## Event Handling

`ghostboxApi.onDownloadProgress(callback)` — new method in `ghostboxApi.tauri.ts`, same shape as `onSteamAccountStatsUpdated`: wraps `listen("download-progress", ...)` and returns an unlisten function.

Handling inside the engine, applied to the currently-active task (module-level `activeTaskAppId`):

- `Type: "status"`, `Status: "depot-plan"` (new event, carries `AppId` + `DepotTotal` as a string `AppId` since it's Rust-authored like `starting-depot`): sets `depotTotal`.
- `Type: "status"`, `Status: "starting-depot"`: matches by `AppId` (string equality, no casting needed), increments `depotIndex`, resets `bytesDownloaded`/`bytesTotal`/`speedBytesPerSecond` to 0 for the new depot.
- Other `Type: "status"` events (`key-resolved`, `loading-manifest`, `manifest-loaded`, `connecting-steam`, `steam-connected`, `cdn-ready`, ...): update `depotStatus` for the friendly label; `manifest-loaded` also sets `bytesTotal` from its `TotalBytes` field.
- `Type: "progress"`: updates `bytesDownloaded`, `bytesTotal` (field `BytesTotal`), `speedBytesPerSecond`.
- `Type: "error"`: these can be per-chunk/per-file (non-fatal, the loop continues) or fatal (loop returns early for that depot) — the client can't reliably tell which from the event alone, so it only surfaces the message transiently via `depotStatus`/`errorMessage` and does **not** flip task status. Final status always comes from the invoke resolution below.

**Completion** is decided by the resolved value of `ghostboxApi.downloadDepotGame(...)` (not by watching for a `complete` event, since per-depot `complete` events lack `AppId`/`DepotId`):

- Shape: `{ Type: "complete", Depots: [...perDepotResult], DepotCount }` or an early `{ Type: "error", Status: "no-depots", Message }` if no depots were found at all.
- Task becomes `error` if the top-level `Type` is `"error"`, or if any entry in `Depots` has `Type: "error"`. Otherwise `completed`.
- `totalBytesDownloaded`/`totalBytesAll` are summed from each depot result's `DownloadedBytes`/`BytesTotal`; `failedFiles` summed from `FailedFiles` (shown as a warning note even on an overall `completed` task if > 0).
- On resolution (success or rejection), the engine writes the finished task to history and starts the next queued task, if any.

## Backend Addition

`src-tauri/src/cdndownload.rs`, right after `resolve_depots` returns and the empty check, before the depot loop:

```rust
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
```

Purely additive — no existing event or return shape changes.

## UI

### Sidebar (`Sidebar.tsx`)

- New entry in the `navigation` array (between Library and the footer group): icon `Download` (lucide-react), label `t("nav.downloads")`.
- Badge: reuse the existing `<strong>{count}</strong>` pill already styled under `.sidebar__menu-item` (no new CSS) — rendered only when `getActiveDownloadCount() > 0` (queued + downloading).
- Subscribes to `downloadTasksChangedEvent` directly (module import, not through `AppDataContext`), same pattern `Header.tsx` uses for the notification badge.

### Routing

- Add `"downloads"` to the `Page` union in `src/types/index.ts`.
- `PageRouter.tsx`: lazy import `DownloadsPage`, add to `KEEP_ALIVE_PAGES`, `PREFETCH_DELAYS_MS`, `PAGE_LOADERS`, and the `renderPage` switch — following the exact pattern already used for `NotificationsPage`.

### `DownloadsPage.tsx`

Modeled directly on `NotificationsPage.tsx` / `.notifications-hub` styling (`content-section content-section--full`, header with title+description, `EmptyState` when there are no tasks):

- Header: title/description + "Limpar concluídos" button (clears `completed`/`error` tasks only; disabled when none).
- List order: `downloading` task first, then `queued` in queue order, then history (`completed`/`error`) sorted by `finishedAt` descending.
- Empty state when there are no tasks at all.

### Card (new `.download-card` styles in `app.scss`, visually consistent with `.app-notification`: `surface-tertiary` background, `--border`, `--radius-lg`)

```
[cover] Title                                   [status pill]
        ─────────────────────────────────────── progress bar (only if downloading)
        120 MB / 850 MB          4.2 MB/s          Restante: 730 MB
        Depot 2 de 3 · Carregando manifesto...
```

- `queued`: no progress bar; shows "Na fila — posição N".
- `downloading`: progress bar (`bytesDownloaded / bytesTotal`, indeterminate/empty style if `bytesTotal` is still 0), downloaded/total, speed, remaining (all via a new `formatBytes` util for human-readable sizes/speed), and the depot caption.
- `completed`: shows total downloaded size and elapsed time, no bar.
- `error`: shows the error message, no bar.
- `completed`/`error`/`queued` cards get a small remove (×) button; `downloading` cards do not (no cancel support).

### `formatBytes` util

New `src/utils/formatBytes.ts`: a small `formatBytes(bytes: number): string` helper (B/KB/MB/GB), used for downloaded/total/remaining/speed display across the card.

## i18n

Add to `src/i18n.ts` (`pt` and `en`):

- `nav.downloads`.
- `downloads.title`, `downloads.description`, `downloads.clear`, `downloads.emptyTitle`, `downloads.emptyMessage`, `downloads.queuePosition`, status labels for the known `depotStatus` values (`starting`, `key-resolved`, `loading-manifest`, `manifest-loaded`, `connecting-steam`, `steam-connected`, `cdn-ready`), and `downloads.depotOf` ("Depot {index} de {total}").

## Out of Scope

- Cancelling an in-progress download (no backend command to kill the child process).
- Pausing/resuming.
- Concurrent downloads.
- Bandwidth throttling or download location override from this page (location is already decided by the modal's `outputDir` at enqueue time).
