import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, CircleDashed, Folder, FolderOpen, HardDrive, Layers, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useDownloadTasks } from "../../hooks/useDownloadTasks";
import { useDownloadsDirectory } from "../../hooks/useDownloadsDirectory";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { deleteDownloadTask, type DownloadTask } from "../../lib/downloadManager";
import type { DownloadDestination } from "../../lib/ghostboxApi.types";
import { formatBytes } from "../../utils/formatBytes";
import { ConsoleArt, ConsolePageTitle } from "./ConsoleParts";
import { consoleTaskByElement } from "./ConsoleDownloads";

const ARM_MS = 4000;
type Kind = "all" | "installed" | "partial";

function driveOf(path: string) {
  return /^[a-z]:/i.exec(path)?.[0].toUpperCase() ?? path.split(/[\\/]/)[0];
}

function coverSources(appId: string) {
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
  ];
}

function RailItem({ icon: Icon, label, detail, current, onPress }: {
  icon: typeof HardDrive;
  label: string;
  detail?: string;
  current: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className={`console-rail-item${current ? " is-current" : ""}`} data-console-focus aria-pressed={current} onClick={onPress}>
      <Icon aria-hidden="true" />
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      {current && <span className="console-rail-item__dot" aria-hidden="true" />}
    </button>
  );
}

function FileRow({ task, armed, onArm, onDelete, onGamePage }: {
  task: DownloadTask;
  armed: boolean;
  onArm: () => void;
  onDelete: () => void;
  onGamePage: () => void;
}) {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const sources = useMemo(() => coverSources(task.appId), [task.appId]);
  const register = (element: HTMLElement | null) => { if (element) consoleTaskByElement.set(element, task); };
  const installed = task.status === "completed";
  return (
    <div className={`console-file-row${armed ? " is-armed" : ""}`}>
      <ConsoleArt sources={sources} className="console-file-row__thumb" />
      <div className="console-file-row__body">
        <strong>{task.title}</strong>
        <small>{task.outputDir || task.downloadsRoot}</small>
      </div>
      <span className="console-file-row__kind">{installed ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}{t(installed ? "console.kindInstalled" : "console.kindPartial")}</span>
      <span className="console-file-row__size">{formatBytes(task.bytesDownloaded || task.bytesTotal)}</span>
      <div className="console-file-row__actions">
        <button ref={register} type="button" className="console-button console-button--secondary console-button--icon" data-console-focus
          aria-label={t("console.openFolder")} disabled={!task.outputDir}
          onClick={() => void ghostboxApi.revealDownloadFolder(task.outputDir).catch((error) => showToast(t("console.files"), String(error), "error"))}>
          <FolderOpen aria-hidden="true" />
        </button>
        <button ref={register} type="button" className="console-button console-button--secondary console-button--icon" data-console-focus
          aria-label={t("console.gamePage")} onClick={onGamePage}>
          <ChevronRight aria-hidden="true" />
        </button>
        <button ref={register} type="button" data-console-focus
          className={`console-button ${armed ? "console-button--primary" : "console-button--secondary"}`}
          onClick={() => (armed ? onDelete() : onArm())}>
          <Trash2 aria-hidden="true" />{t(armed ? "console.confirmDelete" : "console.deleteFiles")}
        </button>
      </div>
    </div>
  );
}

export function ConsoleFiles({ onGamePage }: { onGamePage: (task: DownloadTask) => void }) {
  const { t } = useSettings();
  const { showToast } = useOverlay();
  const directory = useDownloadsDirectory();
  const tasks = useDownloadTasks();
  const { data: destinations = [] } = useQuery({
    queryKey: ["console-download-destinations", directory],
    queryFn: () => ghostboxApi.listDownloadDestinations(undefined, directory),
    staleTime: 15_000,
    retry: false,
  });
  const files = tasks.filter((task) => task.status === "completed" || ((task.status === "paused" || task.status === "error") && task.bytesDownloaded > 0));
  const drives = useMemo(() => {
    const byDrive = new Map<string, DownloadDestination | null>();
    for (const destination of destinations) if (destination.available) byDrive.set(driveOf(destination.path), destination);
    for (const task of files) if (!byDrive.has(driveOf(task.downloadsRoot))) byDrive.set(driveOf(task.downloadsRoot), null);
    return [...byDrive.entries()].map(([drive, destination]) => ({ drive, destination }));
  }, [destinations, files]);
  const [drive, setDrive] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [armed, setArmed] = useState<string | null>(null);
  const currentDrive = drive ?? drives[0]?.drive ?? null;
  const onDrive = files.filter((task) => !currentDrive || driveOf(task.downloadsRoot) === currentDrive);
  const shown = onDrive.filter((task) => kind === "all" || (kind === "installed" ? task.status === "completed" : task.status !== "completed"));
  const sum = (list: DownloadTask[]) => list.reduce((total, task) => total + (task.bytesDownloaded || task.bytesTotal), 0);
  const usage = drives.find((entry) => entry.drive === currentDrive)?.destination;
  const used = usage && usage.totalBytes > 0 ? (usage.totalBytes - usage.freeBytes) / usage.totalBytes : 0;
  const ours = usage && usage.totalBytes > 0 ? Math.min(used, sum(onDrive) / usage.totalBytes) : 0;

  useEffect(() => {
    if (!armed) return undefined;
    const id = window.setTimeout(() => setArmed(null), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armed]);

  const remove = (task: DownloadTask) => {
    setArmed(null);
    void deleteDownloadTask(task.id, true)
      .then(() => showToast(t("console.files"), t("console.filesDeleted", { name: task.title }), "success"))
      .catch((error) => showToast(t("console.files"), String(error), "error"));
  };

  const kinds: { key: Kind; icon: typeof HardDrive; label: string; list: DownloadTask[] }[] = [
    { key: "all", icon: Layers, label: t("console.kindAll"), list: onDrive },
    { key: "installed", icon: CircleCheck, label: t("console.kindInstalled"), list: onDrive.filter((task) => task.status === "completed") },
    { key: "partial", icon: CircleDashed, label: t("console.kindPartial"), list: onDrive.filter((task) => task.status !== "completed") },
  ];

  return (
    <div className="console-files">
      <ConsolePageTitle title={t("console.files")} meta={t("console.filesSummary", { count: files.length, size: formatBytes(sum(files)) })} />
      <div className="console-files__layout">
        <nav className="console-files__rail" aria-label={t("console.drives")}>
          <h2 className="console-overline">{t("console.drives")}</h2>
          {drives.length === 0 && <p className="console-files__note">{t("downloads.noSelectedStorage")}</p>}
          {drives.map((entry) => (
            <RailItem key={entry.drive} icon={HardDrive} label={entry.destination?.label ? `${entry.destination.label} (${entry.drive})` : entry.drive}
              current={entry.drive === currentDrive}
              detail={entry.destination ? t("console.freeOf", { free: formatBytes(entry.destination.freeBytes), total: formatBytes(entry.destination.totalBytes) }) : undefined}
              onPress={() => { setDrive(entry.drive); setArmed(null); }} />
          ))}
          <h2 className="console-overline console-files__kinds">{t("console.kinds")}</h2>
          {kinds.map((entry) => (
            <RailItem key={entry.key} icon={entry.icon} label={entry.label} current={kind === entry.key}
              detail={entry.list.length ? formatBytes(sum(entry.list)) : undefined} onPress={() => setKind(entry.key)} />
          ))}
        </nav>
        <div className="console-files__content">
          {usage && (
            <div className="console-storage-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
              <span className="console-storage-bar__track">
                <span className="console-storage-bar__ours" style={{ width: `${ours * 100}%` }} />
                <span className="console-storage-bar__other" style={{ width: `${Math.max(0, used - ours) * 100}%` }} />
              </span>
              <span className="console-storage-bar__legend">
                <span><i className="is-ours" />GhostBox · {formatBytes(sum(onDrive))}</span>
                <span><i className="is-other" />{t("console.used", { used: formatBytes(usage.totalBytes - usage.freeBytes), total: formatBytes(usage.totalBytes) })}</span>
              </span>
            </div>
          )}
          {shown.length > 0 ? (
            <div className="console-files__list">
              {shown.map((task) => (
                <FileRow key={task.id} task={task} armed={armed === task.id} onArm={() => setArmed(task.id)}
                  onDelete={() => remove(task)} onGamePage={() => onGamePage(task)} />
              ))}
            </div>
          ) : (
            <div className="console-downloads__empty">
              <Folder aria-hidden="true" />
              <h2>{t("console.filesEmpty")}</h2>
              <p>{t("console.filesEmptyDetail")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
