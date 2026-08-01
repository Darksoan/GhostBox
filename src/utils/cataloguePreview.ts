export const CATALOGUE_HOVER_PREVIEW_RETENTION_MS = 500;

export const CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS = 120;

// Matches --motion-base in src/styles/_primitives.scss so the panel's DOM
// content lives exactly as long as its fade-out transition.
export const CATALOGUE_PREVIEW_EXIT_TRANSITION_MS = 180;

/**
 * Debounces committing a hover target so scanning the list quickly (pointer
 * crossing many rows) doesn't thrash the preview panel. Callers pass the same
 * target repeatedly (once per rescheduled row); only the last one within the
 * delay window fires.
 */
export function createCatalogueHoverPreviewIntent<T>(
  onShow: (target: T) => void,
  delayMs = CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  return {
    scheduleShow(target: T) {
      cancel();
      timeoutId = setTimeout(() => {
        timeoutId = null;
        onShow(target);
      }, delayMs);
    },
    showImmediately(target: T) {
      cancel();
      onShow(target);
    },
    cancel,
    dispose() {
      cancel();
    },
  };
}

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
  if (!sources.length) return null;

  const currentIndex = currentSource ? sources.indexOf(currentSource) : -1;
  const firstReadyIndex = sources.findIndex((source) => readySources.has(source));
  const startIndex =
    currentIndex >= 0
      ? currentIndex
      : direction === "next"
        ? firstReadyIndex
        : 0;
  const step = direction === "next" ? 1 : -1;

  for (let distance = 1; distance <= sources.length; distance += 1) {
    const candidateIndex =
      (startIndex + step * distance + sources.length) % sources.length;
    const candidate = sources[candidateIndex];
    if (readySources.has(candidate)) return candidate;
  }

  if (currentSource && readySources.has(currentSource)) return currentSource;

  // Nothing decoded yet (or the ready set went stale after a source swap):
  // still move, so a click is never a no-op. The image paints once it loads.
  const fallbackIndex =
    (Math.max(startIndex, 0) + step + sources.length) % sources.length;
  return sources[fallbackIndex] ?? null;
}

/**
 * Cache resolution expands a single screenshot into several candidate URLs
 * (manifest, raw, cached, CDN fallback). Painting that flat list makes the
 * carousel step through variants of the same picture, so a chevron click looks
 * like a no-op. Collapse each group back to one usable source per screenshot.
 */
export function pickDistinctScreenshotSources(
  candidateGroups: string[][],
  failedSources: ReadonlySet<string> = new Set()
) {
  const picked: string[] = [];
  const seen = new Set<string>();

  for (const candidates of candidateGroups) {
    const candidate =
      candidates.find(
        (source) => source && !failedSources.has(source) && !seen.has(source)
      ) ?? candidates.find((source) => source && !seen.has(source));
    if (!candidate) continue;
    seen.add(candidate);
    picked.push(candidate);
  }

  return picked;
}
