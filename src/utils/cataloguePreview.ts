export const CATALOGUE_HOVER_PREVIEW_RETENTION_MS = 2500;

export function createCatalogueHoverPreviewRetention(
  onClear: () => void,
  delayMs = CATALOGUE_HOVER_PREVIEW_RETENTION_MS
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelClear = () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  return {
    scheduleClear() {
      cancelClear();
      timeoutId = setTimeout(() => {
        timeoutId = null;
        onClear();
      }, delayMs);
    },
    cancelClear,
    dispose() {
      cancelClear();
    },
  };
}

export function getNextReadyScreenshotSource(
  sources: string[],
  readySources: ReadonlySet<string>,
  currentSource: string | null
) {
  if (!sources.length || !readySources.size) {
    return currentSource && sources.includes(currentSource)
      ? currentSource
      : null;
  }

  const currentIndex = currentSource ? sources.indexOf(currentSource) : -1;

  for (let step = 1; step <= sources.length; step += 1) {
    const candidate = sources[(currentIndex + step) % sources.length];
    if (readySources.has(candidate)) return candidate;
  }

  return null;
}

export function getAdjacentReadyScreenshotSource(
  sources: string[],
  readySources: ReadonlySet<string>,
  currentSource: string | null,
  direction: "previous" | "next"
) {
  if (!sources.length || !readySources.size) return null;

  const currentIndex = currentSource ? sources.indexOf(currentSource) : -1;
  const startIndex =
    currentIndex >= 0
      ? currentIndex
      : direction === "next"
        ? -1
        : 0;
  const step = direction === "next" ? 1 : -1;

  for (let distance = 1; distance <= sources.length; distance += 1) {
    const candidateIndex =
      (startIndex + step * distance + sources.length) % sources.length;
    const candidate = sources[candidateIndex];
    if (readySources.has(candidate)) return candidate;
  }

  return currentSource && readySources.has(currentSource)
    ? currentSource
    : null;
}
