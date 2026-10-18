import { useSyncExternalStore } from "react";
import { downloadTasksChangedEvent, getActiveDownloadCount, readDownloadTasks } from "../lib/downloadManager";

function subscribe(callback: () => void) {
  window.addEventListener(downloadTasksChangedEvent, callback);
  return () => window.removeEventListener(downloadTasksChangedEvent, callback);
}

export function useDownloadTasks() {
  return useSyncExternalStore(subscribe, readDownloadTasks, readDownloadTasks);
}

export function useActiveDownloadCount() {
  return useSyncExternalStore(subscribe, getActiveDownloadCount, getActiveDownloadCount);
}
