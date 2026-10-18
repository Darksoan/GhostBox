import { useSyncExternalStore } from "react";
import { readDownloadActivity } from "../lib/downloadActivity";
import { downloadTasksChangedEvent } from "../lib/downloadManager";

function subscribe(callback: () => void) {
  window.addEventListener(downloadTasksChangedEvent, callback);
  return () => window.removeEventListener(downloadTasksChangedEvent, callback);
}

export function useDownloadSpeedHistory() {
  return useSyncExternalStore(subscribe, readDownloadActivity, readDownloadActivity);
}
