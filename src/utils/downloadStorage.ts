import type { DownloadDestination } from "../lib/ghostboxApi.types";

export function registeredDownloadLibraries(destinations: DownloadDestination[]) {
  return destinations.filter((destination) => destination.isLibrary);
}

export function selectedDownloadDestination(directory: string, destinations: DownloadDestination[]) {
  const key = (path: string) => path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  if (!key(directory)) return undefined;
  return destinations.find((destination) => key(destination.path) === key(directory));
}

export function downloadStorageUsedPercent(destination: DownloadDestination) {
  if (!destination.available || !Number.isFinite(destination.totalBytes) || destination.totalBytes <= 0
    || !Number.isFinite(destination.freeBytes)) return null;
  return Math.min(100, Math.max(0, (1 - destination.freeBytes / destination.totalBytes) * 100));
}
