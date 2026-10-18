import { ArrowDownToLine } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useSettings } from "../../context/settings";
import type { DownloadActivity } from "../../lib/downloadActivity";
import type { DownloadTask } from "../../lib/downloadManager";
import { DOWNLOAD_HISTORY_SECONDS, downloadSpeedChart, type DownloadSpeedSample } from "../../utils/downloadActivity";
import { formatSpeed } from "../../utils/formatBytes";

function SpeedMetric({ label, chartLabel, speed, samples, icon }: {
  label: string;
  chartLabel: string;
  speed?: number;
  samples: DownloadSpeedSample[];
  icon: ReactNode;
}) {
  const gradientId = useId().replace(/:/g, "");
  const chart = downloadSpeedChart(samples);
  return (
    <div className="downloads-activity__metric">
      <div className="downloads-activity__heading">{icon}<strong>{label}</strong></div>
      <span className="downloads-activity__value">{speed === undefined ? "—" : formatSpeed(speed)}</span>
      <svg className="downloads-activity__chart" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label={chartLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {chart.area && <path d={chart.area} fill={`url(#${gradientId})`} />}
        {chart.line && <path className="downloads-activity__chart-line" d={chart.line} />}
      </svg>
    </div>
  );
}

export function DownloadActivityPanel({ task, activity }: { task?: DownloadTask; activity: DownloadActivity }) {
  const { t } = useSettings();
  const downloading = task?.status === "downloading";
  return (
    <section className="downloads-panel downloads-activity" aria-label={t("downloads.activity")}>
      <h3 className="downloads-panel__title">{t("downloads.transferSpeed")}</h3>
      <div className="downloads-activity__body">
        <SpeedMetric label={t("downloads.read")} icon={<ArrowDownToLine aria-hidden="true" />}
          speed={downloading ? task.speedBytesPerSecond : 0} samples={activity.download}
          chartLabel={t("downloads.speedChart", { seconds: DOWNLOAD_HISTORY_SECONDS })} />
      </div>
    </section>
  );
}
