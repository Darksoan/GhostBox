import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ghostboxApi } from "../lib/ghostboxApi";

export type BootUpdatePhase = "download" | "install";
export type BootUpdateStatus = "checking" | "updating" | "ready";

export type BootUpdateState = {
  status: BootUpdateStatus;
  percent: number;
  phase: BootUpdatePhase;
};

const CHECK_TIMEOUT_MS = 15000;

function isTrayWindow() {
  try {
    return new URLSearchParams(window.location.search).get("tray") === "1";
  } catch {
    return false;
  }
}

/**
 * Checagem silenciosa de atualização no boot. Sem botão, sem polling horário:
 * uma única verificação ao montar; se houver update, baixa+instala mostrando
 * progresso e dá `relaunch()` (dentro de `ghostboxApi.installUpdate`).
 * Falha/offline/timeout libera o app na versão antiga — nunca bloqueia.
 */
export function useSilentBootUpdate(): BootUpdateState {
  const [status, setStatus] = useState<BootUpdateStatus>("checking");
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<BootUpdatePhase>("download");

  useEffect(() => {
    if (!isTauri() || isTrayWindow()) {
      setStatus("ready");
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    const checkWithTimeout = Promise.race([
      ghostboxApi.checkForUpdates(),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), CHECK_TIMEOUT_MS);
      }),
    ]);

    void checkWithTimeout
      .then((result) => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (cancelled) return;
        if (!result?.updateAvailable) {
          setStatus("ready");
          return undefined;
        }

        setStatus("updating");
        setPercent(0);
        setPhase("download");

        return ghostboxApi
          .installUpdate((progress) => {
            if (cancelled) return;
            if (progress.event === "Finished") {
              setPhase("install");
              setPercent(100);
            } else {
              setPhase("download");
              setPercent(progress.percent);
            }
          })
          .then((installResult) => {
            if (cancelled) return;
            if (!installResult?.success) {
              console.warn("[boot-update] install failed:", installResult?.error);
            }
            // Sucesso chama `relaunch()` dentro do installUpdate; se ainda
            // estamos aqui, libera para não travar o boot.
            setStatus("ready");
          });
      })
      .catch((error: unknown) => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (!cancelled) {
          console.warn("[boot-update] check failed:", error);
          setStatus("ready");
        }
      });

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return { status, percent, phase };
}
