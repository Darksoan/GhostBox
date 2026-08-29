import { useEffect, useState } from "react";
import {
  downloadTasksChangedEvent,
  getLiveDownloadTaskByAppId,
  type DownloadTask,
} from "../lib/downloadManager";

/**
 * Tarefa viva (na fila, baixando ou pausada) de um jogo, reagindo ao barramento
 * `downloadTasksChangedEvent`. Volta para `null` quando o download termina,
 * é cancelado ou o appId não existe — é o que faz o botão do modal trocar de
 * "Downloading" de volta para "Download".
 */
export function useGameDownloadTask(
  appId: string | null | undefined,
): DownloadTask | null {
  const [task, setTask] = useState<DownloadTask | null>(() =>
    appId ? getLiveDownloadTaskByAppId(appId) : null,
  );

  useEffect(() => {
    if (!appId) {
      setTask(null);
      return;
    }

    const refresh = () => setTask(getLiveDownloadTaskByAppId(appId));
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [appId]);

  return task;
}
