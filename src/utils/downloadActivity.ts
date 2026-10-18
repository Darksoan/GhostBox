export const DOWNLOAD_HISTORY_SECONDS = 60;
export type DownloadSpeedSample = { time: number; speed: number };

export function appendDownloadSpeedSample(samples: DownloadSpeedSample[], time: number, speed: number) {
  const sample = { time, speed: Number.isFinite(speed) ? Math.max(0, speed) : 0 };
  return [...samples.filter((entry) => entry.time > time - DOWNLOAD_HISTORY_SECONDS * 1000), sample]
    .slice(-DOWNLOAD_HISTORY_SECONDS);
}

export function downloadSpeedChart(samples: DownloadSpeedSample[]) {
  const valid = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.speed) && sample.speed >= 0);
  const peak = Math.max(0, ...valid.map((sample) => sample.speed));
  const average = valid.length ? valid.reduce((total, sample) => total + sample.speed, 0) / valid.length : 0;
  if (!valid.length) return { line: "", area: "", peak, average };

  const end = valid[valid.length - 1].time;
  const start = end - DOWNLOAD_HISTORY_SECONDS * 1000;
  const scale = Math.max(1, peak * 1.2);
  const points = valid.map((sample) => ({
    x: Math.min(300, Math.max(0, (sample.time - start) / (end - start) * 300)),
    y: 76 - Math.min(1, sample.speed / scale) * 72,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return { line, area: `${line} L${last.x.toFixed(2)},80 L${first.x.toFixed(2)},80 Z`, peak, average };
}
