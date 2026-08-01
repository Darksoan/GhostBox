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
