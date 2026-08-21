import { useEffect } from "react";
import { startViewportResizeTracking } from "../utils/viewportResize";

/**
 * Liga o rastreio global de resize. Um único ponto de montagem (App) basta —
 * é a contagem em `startViewportResizeTracking` que garante isso.
 */
export function useViewportResizeTracking(): void {
  useEffect(() => startViewportResizeTracking(), []);
}
