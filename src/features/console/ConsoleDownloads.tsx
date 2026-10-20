import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, FolderOpen, Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useDownloadTasks } from "../../hooks/useDownloadTasks";
import { useDownloadSpeedHistory } from "../../hooks/useDownloadSpeedHistory";
import { useDownloadsDirectory } from "../../hooks/useDownloadsDirectory";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { deleteDownloadTask, pauseDownloadTask, resumeDownloadTask, type DownloadTask } from "../../lib/downloadManager";
import { downloadPercent } from "../../pages/DownloadsPage";
import { downloadSpeedChart, type DownloadSpeedSample } from "../../utils/downloadActivity";
import { downloadEtaSeconds, formatDownloadEta } from "../../utils/downloadEta";
import { selectedDownloadDestination } from "../../utils/downloadStorage";
import { formatBytes, formatSpeed } from "../../utils/formatBytes";
import { ConsoleArt, ConsolePageTitle } from "./ConsoleParts";
import { requestConsoleFocus } from "./useConsoleInput";

const ARM_MS = 3000;

// Capa vertical da biblioteca Steam pelo AppID, com o header como último recurso.
function coverSourcesForAppId(appId: string) {
  return ["fastly", "akamai"].flatMap((cdn) => [
    `https://shared.${cdn}.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
  ]).concat(`https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`);
}
const ACTIVE = new Set<DownloadTask["status"]>(["downloading", "queued"]);
const STOPPED = new Set<DownloadTask["status"]>(["paused", "error"]);

/** Botão focado → tarefa, para □ (pausar/retomar) e △ (página do jogo) agirem na linha focada. */
export const consoleTaskByElement = new WeakMap<HTMLElement, DownloadTask>();

export function consoleTaskFromElement(element: HTMLElement | null) {
  const target = element?.closest<HTMLElement>("[data-console-focus]");
  return target ? consoleTaskByElement.get(target) : undefined;
}

export function toggleConsoleTask(task: DownloadTask) {
  if (ACTIVE.has(task.status)) return pauseDownloadTask(task.id);
  if (STOPPED.has(task.status)) return resumeDownloadTask(task.id);
  return undefined;
}

function useRegister(task: DownloadTask) {
  return (element: HTMLElement | null) => { if (element) consoleTaskByElement.set(element, task); };
}

function SpeedChart({ samples, muted }: { samples: DownloadSpeedSample[]; muted?: boolean }) {
  const chart = downloadSpeedChart(samples);
  return (
    <svg className={`console-dl-chart${muted ? " console-dl-chart--muted" : ""}`} viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
      {chart.area && <path className="console-dl-chart__area" d={chart.area} />}
      {chart.line && <path className="console-dl-chart__line" d={chart.line} />}
    </svg>
  );
}

function DownloadRow({ task, autoFocus, download, write, onGamePage }: {
  task: DownloadTask;
  autoFocus: boolean;
  download: DownloadSpeedSample[];
  write: DownloadSpeedSample[];
  onGamePage: (task: DownloadTask) => void;
}) {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const register = useRegister(task);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const [armed, setArmed] = useState(false);
  const coverSources = useMemo(() => coverSourcesForAppId(task.appId), [task.appId]);
  const percent = downloadPercent(task);
  const active = task.status === "downloading";
  const completed = task.status === "completed";
  const neverStarted = !task.startedAt && task.bytesDownloaded <= 0;
  const launchable = completed && task.steamIntegration?.status === "ok";

  useEffect(() => {
    if (!armed) return undefined;
    const id = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armed]);
  useEffect(() => { if (autoFocus) requestConsoleFocus(primaryRef.current); }, [autoFocus]);

  const run = (work: () => unknown) => { void Promise.resolve().then(work).catch((error) => showToast(t("console.downloads"), String(error), "error")); };
  const primary = ACTIVE.has(task.status) && !(task.status === "queued" && neverStarted)
    ? { icon: Pause, label: t("console.pause"), onPress: () => run(() => pauseDownloadTask(task.id)) }
    : task.status === "queued" || (task.status === "paused" && neverStarted)
      ? { icon: Download, label: t("console.start"), onPress: () => run(() => resumeDownloadTask(task.id)) }
      : task.status === "paused" ? { icon: Play, label: t("console.resume"), onPress: () => run(() => resumeDownloadTask(task.id)) }
        : task.status === "error" ? { icon: RotateCw, label: t("console.retry"), onPress: () => run(() => resumeDownloadTask(task.id)) }
          : launchable ? { icon: Play, label: t("console.play"), onPress: () => run(async () => {
            const result = await ghostboxApi.launchGame(task);
            if (!result?.success) throw new Error(result?.error || t("downloads.error"));
          }) }
            : { icon: ChevronRight, label: t("console.gamePage"), onPress: () => onGamePage(task) };

  const status = active && task.bytesTotal <= 0 ? t("downloads.preparing")
    : t(`downloads.${task.status === "paused" ? "pausedState" : task.status === "queued" ? "queued" : task.status}`);
  const timeLeft = active ? formatDownloadEta(downloadEtaSeconds(task), t) : "";
  const amount = completed ? formatBytes(task.bytesDownloaded || task.bytesTotal)
    : task.bytesTotal > 0 ? `${formatBytes(task.bytesDownloaded)} / ${formatBytes(task.bytesTotal)}`
      : task.bytesDownloaded > 0 ? formatBytes(task.bytesDownloaded) : "";
  const meta = ["Steam", `AppID ${task.appId}`, task.outputDir || task.downloadsRoot].filter(Boolean).join(" · ");
  const latest = (samples: DownloadSpeedSample[], fallback = 0) => samples[samples.length - 1]?.speed ?? fallback;

  return (
    <article className={`console-dl-row console-dl-row--${task.status}`} aria-label={task.title}>
      <div className="console-dl-row__main">
        <ConsoleArt sources={coverSources} className="console-dl-row__thumb" />
        <div className="console-dl-row__body">
          <div className="console-dl-row__line">
            <h3>{task.title}</h3>
            <span className="console-dl-row__meta">{meta}</span>
          </div>
          <span className={`console-progress${active || completed ? " is-active" : ""}`} role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.bytesTotal > 0 || completed ? Math.round(percent) : undefined}>
            <span style={{ transform: `scaleX(${(completed ? 100 : percent) / 100})` }} />
          </span>
          <div className="console-dl-row__line console-dl-row__line--status">
            <span>{status}{timeLeft && <span className="console-dl-row__muted">{`  ${timeLeft}`}</span>}</span>
            <span className="console-dl-row__muted">{amount}</span>
          </div>
          {task.status === "error" && task.errorMessage && <p className="console-dl-row__note">{task.errorMessage}</p>}
          {completed && task.steamIntegration?.status && task.steamIntegration.status !== "ok" && (
            <p className="console-dl-row__note console-dl-row__note--warn">{task.steamIntegration.message || t("downloads.integrationWarning")}</p>
          )}
        </div>
        <div className="console-dl-row__actions">
          <button ref={(element) => { primaryRef.current = element; register(element); }} type="button"
            className="console-button console-button--secondary console-dl-row__primary" data-console-focus onClick={primary.onPress}>
            <primary.icon aria-hidden="true" />{primary.label}
          </button>
          {completed && !launchable && task.outputDir && (
            <button ref={register} type="button" className="console-button console-button--secondary console-button--icon" data-console-focus
              aria-label={t("console.openFolder")} onClick={() => run(() => ghostboxApi.revealDownloadFolder(task.outputDir))}>
              <FolderOpen aria-hidden="true" />
            </button>
          )}
          <button ref={register} type="button" data-console-focus
            className={`console-button console-button--icon ${armed ? "console-button--primary" : "console-button--secondary"}`}
            aria-label={armed ? t("console.confirm") : t("console.remove")}
            onBlur={() => setArmed(false)}
            onClick={() => {
              if (!armed) { setArmed(true); return; }
              setArmed(false);
              run(() => deleteDownloadTask(task.id, !completed));
            }}>
            {armed ? <Trash2 aria-hidden="true" /> : <X aria-hidden="true" />}
          </button>
        </div>
      </div>
      {active && (
        <div className="console-dl-stats">
          <div className="console-dl-stats__cell">
            <span><strong>{t("console.downloadSpeed")}</strong>{formatSpeed(latest(download, task.speedBytesPerSecond))}</span>
            <SpeedChart samples={download} />
          </div>
          {(write.length > 0 || task.writeSpeedBytesPerSecond != null) && (
            <div className="console-dl-stats__cell">
              <span><strong>{t("console.diskWrite")}</strong>{formatSpeed(latest(write, task.writeSpeedBytesPerSecond ?? 0))}</span>
              <SpeedChart samples={write} muted />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="console-figure"><span>{label}</span><span>{value}</span></div>;
}

function SummaryPanel({ tasks, download }: { tasks: DownloadTask[]; download: DownloadSpeedSample[] }) {
  const { t } = useSettings();
  const directory = useDownloadsDirectory();
  const { data = [], isError } = useQuery({
    queryKey: ["selected-download-storage", directory],
    queryFn: () => ghostboxApi.listDownloadDestinations(undefined, directory),
    enabled: Boolean(directory.trim()),
    staleTime: 15_000,
    refetchInterval: directory.trim() ? 30_000 : false,
    retry: false,
  });
  const drive = selectedDownloadDestination(directory, data);
  const activeTask = tasks.find((task) => task.status === "downloading");
  const downloading = tasks.filter((task) => task.status === "downloading").length;
  const speeds = download.map((sample) => sample.speed).filter((speed) => speed > 0);
  const chart = downloadSpeedChart(download);
  const eta = activeTask ? downloadEtaSeconds(activeTask) : 0;
  const used = drive && drive.totalBytes > 0 ? (drive.totalBytes - drive.freeBytes) / drive.totalBytes : 0;

  return (
    <aside className="console-dl-panel">
      <section className="console-dl-panel__block" aria-label={t("console.activity")}>
        <h2 className="console-overline">{t("console.activity")}</h2>
        <div className="console-dl-panel__card" data-console-focus tabIndex={-1}>
          <p className="console-dl-panel__headline">{activeTask ? formatSpeed(activeTask.speedBytesPerSecond) : t("console.idle")}</p>
          <div className="console-dl-panel__figures">
            <Figure label={t("console.downloadingNow")} value={downloading ? t("console.gameCount", { count: downloading }) : t("console.none")} />
            <Figure label={t("console.timeLeft")} value={eta > 0 ? formatDownloadEta(eta, t) : "—"} />
            <Figure label={t("console.peak")} value={chart.peak ? formatSpeed(chart.peak) : "—"} />
            <Figure label={t("console.low")} value={speeds.length ? formatSpeed(Math.min(...speeds)) : "—"} />
            <Figure label={t("console.average")} value={chart.average ? formatSpeed(chart.average) : "—"} />
          </div>
        </div>
      </section>
      <section className="console-dl-panel__block" aria-label={t("console.storage")}>
        <h2 className="console-overline">{t("console.storage")}</h2>
        <div className="console-dl-panel__card" data-console-focus tabIndex={-1}>
          {drive && drive.available ? <>
            <Figure label={`${drive.label || drive.drive}${drive.label && drive.drive ? ` (${drive.drive})` : ""}`} value={t("console.free", { size: formatBytes(drive.freeBytes) })} />
            <span className="console-progress"><span style={{ transform: `scaleX(${used})` }} /></span>
            <p className="console-dl-panel__note">{t("console.used", { used: formatBytes(drive.totalBytes - drive.freeBytes), total: formatBytes(drive.totalBytes) })}</p>
          </> : <p className="console-dl-panel__note">{isError || directory ? t("console.unavailable") : t("downloads.noSelectedStorage")}</p>}
        </div>
      </section>
    </aside>
  );
}

export function ConsoleDownloads({ onBrowse, onGamePage }: { onBrowse: () => void; onGamePage: (task: DownloadTask) => void }) {
  const { t } = useSettings();
  const tasks = useDownloadTasks();
  const activity = useDownloadSpeedHistory();
  const active = tasks.filter((task) => ACTIVE.has(task.status));
  const stopped = tasks.filter((task) => STOPPED.has(task.status));
  const done = tasks.filter((task) => task.status === "completed")
    .sort((a, b) => (b.finishedAt ?? b.queuedAt) - (a.finishedAt ?? a.queuedAt));
  const first = active[0] ?? stopped[0] ?? done[0];
  const summary = [
    [active.length, "console.summaryInProgress"],
    [tasks.filter((task) => task.status === "paused").length, "console.summaryPaused"],
    [tasks.filter((task) => task.status === "error").length, "console.summaryFailed"],
    [done.length, "console.summaryCompleted"],
  ].filter(([count]) => Number(count) > 0).map(([count, key]) => t(String(key), { count: Number(count) })).join(" · ");
  const sections = [
    { key: "active", title: t("console.sectionActive"), tasks: active },
    { key: "stopped", title: t("console.sectionStopped"), tasks: stopped },
    { key: "done", title: t("console.sectionCompleted"), tasks: done },
  ].filter((section) => section.tasks.length > 0);
  const samplesFor = (task: DownloadTask) => activity.taskId === task.id ? activity : { download: [], write: [] };

  return (
    <div className="console-downloads">
      <ConsolePageTitle title={t("console.downloads")} meta={summary || undefined} />
      <div className="console-downloads__layout">
        {sections.length > 0 ? (
          <div className="console-downloads__sections">
            {sections.map((section) => (
              <section key={section.key} className="console-downloads__section" aria-label={section.title}>
                <h2 className="console-overline">{section.title}<span>{section.tasks.length}</span></h2>
                {section.tasks.map((task) => (
                  <DownloadRow key={task.id} task={task} autoFocus={task === first} onGamePage={onGamePage}
                    download={samplesFor(task).download} write={samplesFor(task).write} />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="console-downloads__empty">
            <Download aria-hidden="true" />
            <h2>{t("console.emptyDownloads")}</h2>
            <p>{t("console.emptyDownloadsDetail")}</p>
            <button type="button" className="console-button console-button--outline" data-console-focus onClick={onBrowse}>{t("console.browseGames")}</button>
          </div>
        )}
        <SummaryPanel tasks={tasks} download={activity.taskId ? activity.download : []} />
      </div>
    </div>
  );
}
