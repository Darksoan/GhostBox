import { useEffect, useState } from "react";
import {
  isViewportResizing,
  startViewportResizeTracking,
  subscribeViewportResize,
} from "../utils/viewportResize";

/**
 * Liga o rastreio global de resize. Um único ponto de montagem (App) basta —
 * é a contagem em `startViewportResizeTracking` que garante isso.
 */
export function useViewportResizeTracking(): void {
  useEffect(() => startViewportResizeTracking(), []);
}

/**
 * Re-renderiza quando o arrasto começa e quando assenta. Use quando o
 * componente precisa adiar medição/reposicionamento para o fim do resize.
 */
export function useIsViewportResizing(): boolean {
  const [resizing, setResizing] = useState(isViewportResizing);

  useEffect(() => {
    const release = startViewportResizeTracking();
    setResizing(isViewportResizing());
    const unsubscribe = subscribeViewportResize(setResizing);
    return () => {
      unsubscribe();
      release();
    };
  }, []);

  return resizing;
}
