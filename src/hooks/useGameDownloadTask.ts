import { useEffect, useState } from "react";
import {
  downloadTasksChangedEvent,
  getLiveDownloadTaskByAppId,
  readDownloadTasks,
  type DownloadTask,
} from "../lib/downloadManager";

/**
 * Tarefa viva (na fila, baixando ou pausada) de um jogo, reagindo ao barramento
 * `downloadTasksChangedEvent`. Volta para `null` quando o download termina,
 * é cancelado ou o appId não existe — é o que faz o botão do modal trocar de
 * "Downloading" de volta para "Download". Com includeCompleted, mantém
 * downloads concluídos para que o modal possa oferecer a ação Jogar.
 */
export function useGameDownloadTask(
  appId: string | null | undefined,
  includeCompleted = false,
): DownloadTask | null {
  const resolveTask = () => {
    if (!appId) return null;
    const liveTask = getLiveDownloadTaskByAppId(appId);
    if (liveTask || !includeCompleted) return liveTask;
    return readDownloadTasks().find(
      (task) => task.appId === appId && task.status === "completed",
    ) ?? null;
  };
  const [task, setTask] = useState<DownloadTask | null>(resolveTask);

  useEffect(() => {
    if (!appId) {
      setTask(null);
      return;
    }

    const refresh = () => setTask(resolveTask());
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [appId, includeCompleted]);

  return task;
}
