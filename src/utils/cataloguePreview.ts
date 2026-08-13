export const CATALOGUE_HOVER_PREVIEW_RETENTION_MS = 500;

export const CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS = 120;

/**
 * Espera para hover que o usuário não pediu: trocar de aba faz o conteúdo subir
 * sob um cursor parado, e cada cartão que passa por baixo dispara `pointerenter`.
 * Sem essa espera longa cada um desses vira um preview comitado — com busca de
 * conquistas e resolução de screenshots — e tudo isso é requisição jogada fora.
 */
export const CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS = 420;

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
    scheduleShow(target: T, overrideDelayMs = delayMs) {
      cancel();
      timeoutId = setTimeout(() => {
        timeoutId = null;
        onShow(target);
      }, overrideDelayMs);
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

/** Respiro mínimo entre o painel e as bordas da janela. */
export const CATALOGUE_PREVIEW_VIEWPORT_MARGIN = 16;

/**
 * Quanto da coluna de filtros o painel invade. A borda direita dele pousa nessa
 * fração da largura da coluna: cobre um pedaço dos filtros e para antes da
 * borda direita deles.
 */
export const CATALOGUE_PREVIEW_COLUMN_OVERLAP_RATIO = 0.62;

/**
 * Faixa de baixo que o preview nunca ocupa. O painel flutua por cima da coluna
 * de filtros, e o canto inferior dela precisa continuar livre para o dropdown
 * abrir sem ficar por baixo do preview.
 */
export const CATALOGUE_PREVIEW_BOTTOM_SAFE_AREA = 120;

export interface CataloguePreviewBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CataloguePreviewPosition {
  top: number;
  left: number;
}

export interface CataloguePreviewPointer {
  x: number;
  y: number;
}

/**
 * Painel sempre na mesma faixa à direita: a borda direita dele pousa dentro da
 * coluna de filtros, cobrindo um pedaço dela. Só a vertical acompanha o hover —
 * centrada no cartão, presa entre o cabeçalho e a faixa reservada de baixo, que
 * fica livre para o dropdown dos filtros.
 */
export function computeCataloguePreviewPosition({
  card = null,
  pointer = null,
  column = null,
  preview,
  viewport,
  margin = CATALOGUE_PREVIEW_VIEWPORT_MARGIN,
  topBoundary = CATALOGUE_PREVIEW_VIEWPORT_MARGIN,
  bottomSafeArea = CATALOGUE_PREVIEW_BOTTOM_SAFE_AREA,
  overlapRatio = CATALOGUE_PREVIEW_COLUMN_OVERLAP_RATIO,
}: {
  /** Cartão sob o cursor — manda na vertical. */
  card?: CataloguePreviewBox | null;
  /** Usado só quando não há cartão medido. */
  pointer?: CataloguePreviewPointer | null;
  /** Coluna de filtros — manda na horizontal. */
  column?: { left: number; width: number } | null;
  preview: Pick<CataloguePreviewBox, "width" | "height">;
  viewport: { width: number; height: number };
  margin?: number;
  topBoundary?: number;
  bottomSafeArea?: number;
  overlapRatio?: number;
}): CataloguePreviewPosition {
  const rightEdge = column
    ? column.left + column.width * overlapRatio
    : viewport.width - margin;
  const maxLeft = viewport.width - margin - preview.width;
  const left = Math.max(margin, Math.min(rightEdge - preview.width, maxLeft));

  const centerY = card
    ? card.top + card.height / 2
    : (pointer?.y ?? viewport.height / 2);
  const maxTop = Math.max(
    topBoundary,
    viewport.height - margin - bottomSafeArea - preview.height
  );
  const top = Math.max(
    topBoundary,
    Math.min(centerY - preview.height / 2, maxTop)
  );

  return { top, left };
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
