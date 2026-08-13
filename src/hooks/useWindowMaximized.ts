import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Estado real de maximização da janela. Maximizar e restaurar emitem `resize`,
 * então o listener cobre tanto o botão da titlebar quanto o snap do sistema.
 *
 * Fora do Tauri (vite dev no navegador) não existe janela: retorna `false` e
 * não registra listener nenhum.
 */
export function useWindowMaximized(): boolean {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    let settleTimeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const win = getCurrentWindow();

      const refresh = () => {
        void win
          .isMaximized()
          .then((maximized) => {
            if (!cancelled) setIsMaximized(maximized);
          })
          .catch(() => {});
      };

      // `onResized` dispara a cada frame do arrasto e `isMaximized()` é uma ida
      // ao backend: sem o coalescing eram dezenas de round-trips por segundo,
      // cujas respostas chegavam fora de ordem e faziam o ícone da titlebar
      // piscar entre maximizar/restaurar. Maximizar/restaurar de verdade emite
      // um evento só, então o atraso não é percebido.
      const scheduleRefresh = () => {
        if (settleTimeoutId !== null) clearTimeout(settleTimeoutId);
        settleTimeoutId = setTimeout(() => {
          settleTimeoutId = null;
          refresh();
        }, 120);
      };

      refresh();
      void win.onResized(scheduleRefresh).then((unlisten) => {
        if (cancelled) unlisten();
        else dispose = unlisten;
      });
    } catch {
      return;
    }

    return () => {
      cancelled = true;
      if (settleTimeoutId !== null) clearTimeout(settleTimeoutId);
      dispose?.();
    };
  }, []);

  return isMaximized;
}
