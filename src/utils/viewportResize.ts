/**
 * Rastreio único de "a janela está sendo redimensionada agora".
 *
 * Arrastar a borda da janela emite dezenas de `resize` por segundo. Cada
 * consumidor que reagia sozinho (medir chip, reposicionar menu, perguntar ao
 * Tauri se maximizou) rodava uma vez por evento — daí o tremor: o layout era
 * recalculado no meio do arrasto, com valores que já estavam obsoletos no frame
 * seguinte. Aqui o evento vira dois sinais discretos: começou e assentou.
 *
 * Enquanto está redimensionando, `html.is-resizing` desliga as transições (ver
 * app.scss): animar geometria contra um layout que muda a cada frame é o que
 * produz o "teleporta/desliza errado".
 */

const settleDelayMs = 140;
const resizingClassName = "is-resizing";

type ResizeListener = (isResizing: boolean) => void;

const listeners = new Set<ResizeListener>();
let isResizing = false;
let settleTimeoutId: ReturnType<typeof setTimeout> | null = null;
let trackerCount = 0;
let detach: (() => void) | null = null;

export function isViewportResizing(): boolean {
  return isResizing;
}

/**
 * Notifica em cada transição de estado. O callback recebe `true` quando o
 * arrasto começa e `false` quando assenta — é no `false` que vale remedir.
 */
export function subscribeViewportResize(listener: ResizeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setResizing(next: boolean) {
  if (isResizing === next) return;
  isResizing = next;

  document.documentElement.classList.toggle(resizingClassName, next);
  for (const listener of listeners) listener(next);
}

function handleResize() {
  setResizing(true);
  if (settleTimeoutId !== null) clearTimeout(settleTimeoutId);
  settleTimeoutId = setTimeout(() => {
    settleTimeoutId = null;
    setResizing(false);
  }, settleDelayMs);
}

/**
 * Idempotente por contagem: montar em mais de um lugar não duplica listener,
 * e o último desmonte é que solta de fato.
 */
export function startViewportResizeTracking(): () => void {
  trackerCount += 1;

  if (trackerCount === 1) {
    window.addEventListener("resize", handleResize, { passive: true });
    detach = () => window.removeEventListener("resize", handleResize);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackerCount -= 1;
    if (trackerCount > 0) return;

    detach?.();
    detach = null;
    if (settleTimeoutId !== null) {
      clearTimeout(settleTimeoutId);
      settleTimeoutId = null;
    }
    setResizing(false);
  };
}
