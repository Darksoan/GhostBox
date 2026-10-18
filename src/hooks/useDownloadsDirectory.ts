import { useSyncExternalStore } from "react";
import { downloadsDirectoryChangedEvent, readStoredDownloadsDir } from "../lib/downloadManager";

function subscribe(callback: () => void) {
  window.addEventListener(downloadsDirectoryChangedEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(downloadsDirectoryChangedEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useDownloadsDirectory() {
  return useSyncExternalStore(subscribe, readStoredDownloadsDir, readStoredDownloadsDir);
}
