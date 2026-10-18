import { appendDownloadSpeedSample, type DownloadSpeedSample } from "../utils/downloadActivity";

export type DownloadActivity = {
  taskId: string | null;
  queuedAt: number;
  title: string;
  download: DownloadSpeedSample[];
  write: DownloadSpeedSample[];
};

let activity: DownloadActivity = { taskId: null, queuedAt: 0, title: "", download: [], write: [] };
let lastRecordedAt: number | undefined;

export function readDownloadActivity() { return activity; }

export function beginDownloadActivity(task: { id: string; queuedAt: number; title: string }) {
  if (activity.taskId !== task.id || activity.queuedAt !== task.queuedAt) {
    activity = { taskId: task.id, queuedAt: task.queuedAt, title: task.title, download: [], write: [] };
  }
  // A pausa não ocupa o eixo temporal: a retomada continua do último ponto.
  lastRecordedAt = undefined;
}

export function suspendDownloadActivity(taskId: string) {
  if (activity.taskId === taskId) lastRecordedAt = undefined;
}

export function recordDownloadActivity(taskId: string, speed: number, writeSpeed?: number) {
  if (activity.taskId !== taskId) return;
  const now = Date.now();
  const previous = activity.download[activity.download.length - 1];
  const time = previous ? previous.time + (lastRecordedAt === undefined ? 1000 : Math.max(1, now - lastRecordedAt)) : 0;
  lastRecordedAt = now;
  activity = {
    ...activity,
    download: appendDownloadSpeedSample(activity.download, time, speed),
    write: writeSpeed === undefined ? activity.write : appendDownloadSpeedSample(activity.write, time, writeSpeed),
  };
}
