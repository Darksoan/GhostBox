import { useEffect } from "react";
import { useOverlay } from "../context/OverlayContext";
import { useSettings } from "../context/settings";
import { downloadCompletedEvent, type DownloadCompletion } from "../lib/downloadManager";
import { highDensityHeaderSources } from "../utils/image";

/** Listener global: funciona mesmo fora da pagina Downloads, sem repetir historico. */
export function useDownloadCompletionToast() {
  const { showToast } = useOverlay();
  const { t } = useSettings();
  useEffect(() => {
    const completed = (event: Event) => {
      const game = (event as CustomEvent<DownloadCompletion>).detail;
      showToast(game.title, t("downloads.completedToast"), "success", {
        imageSources: [...new Set([...game.headerSources, ...highDensityHeaderSources(game.appId)])],
        layout: "game",
      });
    };
    window.addEventListener(downloadCompletedEvent, completed);
    return () => window.removeEventListener(downloadCompletedEvent, completed);
  }, [showToast, t]);
}
