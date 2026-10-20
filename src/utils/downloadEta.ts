import type { DownloadTask } from "../lib/downloadManager";

// A velocidade instantânea oscila (troca de depot, rajadas de CDN, chunks reaproveitados),
// então o tempo restante usa uma média móvel exponencial. Quando a velocidade cai a 0
// por um instante, a última média continua valendo em vez de voltar para "Calculando".
const smoothing = 0.25;

export function smoothDownloadSpeed(previous: number, current: number): number {
  if (!(current > 0)) return previous;
  return previous > 0 ? previous + (current - previous) * smoothing : current;
}

export function downloadEtaSeconds(task: Pick<DownloadTask, "status" | "bytesTotal" | "bytesDownloaded" | "speedBytesPerSecond">, speed = task.speedBytesPerSecond): number {
  if (task.status !== "downloading" || !(speed > 0) || !(task.bytesTotal > 0)) return 0;
  return Math.max(0, task.bytesTotal - task.bytesDownloaded) / speed;
}

export function formatDownloadEta(seconds: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!(seconds > 0)) return t("downloads.calculating");
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return t("downloads.etaUnderMinute");
  if (minutes < 60) return t("downloads.etaMinutes", { minutes });
  return t("downloads.etaHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
