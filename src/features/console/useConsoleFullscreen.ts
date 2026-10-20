import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

// Serializa entrada/saída para remontagens rápidas e o StrictMode não
// restaurarem a janela depois que outra instância já entrou em tela cheia.
let transition = Promise.resolve();

function schedule(work: () => Promise<void>) {
  transition = transition.then(work).catch((error) => {
    console.warn("[GhostBox] Não foi possível alterar a tela cheia do console", error);
  });
}

export function useConsoleFullscreen() {
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let wasFullscreen: boolean | undefined;
    const win = getCurrentWindow();

    schedule(async () => {
      if (!active) return;
      wasFullscreen = await win.isFullscreen();
      if (active && !wasFullscreen) await win.setFullscreen(true);
    });

    return () => {
      active = false;
      schedule(async () => {
        if (wasFullscreen === false) await win.setFullscreen(false);
      });
    };
  }, []);
}
