import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { deleteDownloadTask, repairDownloadLibrary, resumeDownloadTask, type DownloadTask } from "../../lib/downloadManager";
import { formatBytes, formatSpeed } from "../../utils/formatBytes";

export function DownloadDetailsModal({ task, onClose, initialRemoving = false }: { task: DownloadTask; onClose: () => void; initialRemoving?: boolean }) {
  const { appearance, t } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(initialRemoving);
  const [error, setError] = useState("");
  const interaction = useRef({ busy, onClose });
  interaction.current = { busy, onClose };
  const completed = task.status === "completed";
  const integration = task.steamIntegration;
  const warning = completed && integration?.status !== "ok";
  const date = (value: number) => new Intl.DateTimeFormat(appearance.language === "en" ? "en-US" : "pt-BR", { dateStyle: "short", timeStyle: "short" }).format(value);
  const seconds = task.speedBytesPerSecond > 0 && Date.now() - (task.startedAt ?? Date.now()) >= 45_000
    ? Math.max(0, task.bytesTotal - task.bytesDownloaded) / task.speedBytesPerSecond : 0;
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await work(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); if (!interaction.current.busy) interaction.current.onClose(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, []);

  return createPortal(
    <div className="backdrop backdrop--confirm" onClick={() => { if (!busy) onClose(); }}>
      <div ref={ref} tabIndex={-1} className="collection-modal download-details-modal" role="dialog" aria-modal="true" aria-labelledby="download-details-title" onClick={(event) => event.stopPropagation()}>
        <header className="collection-modal__header">
          <div><h3 id="download-details-title">{removing ? t(completed ? "downloads.removeTitle" : "downloads.cancelTitle") : task.title}</h3><p>{removing ? t(completed ? "downloads.removeHistoryDescription" : "downloads.cancelDescription") : t("downloads.details")}</p></div>
          <button className="collection-modal__close" type="button" onClick={onClose} disabled={busy} aria-label={t("downloads.close")}><ModalCloseIcon /></button>
        </header>
        {(!removing || error) && <div className="collection-modal__content download-details-modal__content">
          {!removing && <>
            <dl>
              <div><dt>{t("downloads.progress")}</dt><dd>{formatBytes(task.bytesDownloaded)} / {formatBytes(task.bytesTotal)}</dd></div>
              <div><dt>{t("downloads.speed")}</dt><dd>{formatSpeed(task.speedBytesPerSecond)}</dd></div>
              <div><dt>{t("downloads.eta")}</dt><dd>{task.status === "downloading" ? seconds > 0 ? `${Math.ceil(seconds / 60)} min` : t("downloads.calculating") : "—"}</dd></div>
              <div><dt>{t("downloads.depots")}</dt><dd>{task.depotIndex} / {task.depotTotal}</dd></div>
              <div><dt>{t("downloads.destination")}</dt><dd>{task.outputDir || task.downloadsRoot}</dd></div>
              <div><dt>{t("downloads.date")}</dt><dd>{date(task.queuedAt)}</dd></div>
              {task.finishedAt && <div><dt>{t("downloads.finished")}</dt><dd>{date(task.finishedAt)}</dd></div>}
            </dl>
            {task.errorMessage && <p role="alert">{task.errorMessage}</p>}
            {warning && <p role="status">{t("downloads.integrationWarning")} {integration?.message}</p>}
            {integration?.requiresSteamRestart && <p>{t("downloads.restartSteam")}</p>}
          </>}
          {error && <p role="alert">{error}</p>}
        </div>}
        <footer className="collection-modal__actions download-details-modal__actions">
          {removing ? <>
            <button className="button button--outline" type="button" onClick={onClose} disabled={busy}>{t("downloads.cancel")}</button>
            <button className="button button--outline" type="button" disabled={busy} onClick={() => void action(async () => { await deleteDownloadTask(task.id, !completed); onClose(); })}>{t(completed ? "downloads.confirmRemove" : "downloads.confirmCancel")}</button>
          </> : <>
            <button className="button button--outline" type="button" onClick={() => setRemoving(true)} disabled={busy}>{t("downloads.remove")}</button>
            {task.outputDir && <button className="button button--outline" type="button" disabled={busy} onClick={() => void action(() => ghostboxApi.revealDownloadFolder(task.outputDir))}>{t("downloads.openFolder")}</button>}
            {warning && integration?.status === "library-not-registered" && <button className="button button--outline" type="button" disabled={busy} onClick={() => void action(() => repairDownloadLibrary(task.id))}>{t("downloads.repair")}</button>}
            {task.status === "error" && <button className="button button--outline" type="button" disabled={busy} onClick={() => void action(async () => { await resumeDownloadTask(task.id); onClose(); })}>{t("downloads.retry")}</button>}
            {completed && integration?.status === "ok" && <button className="button button--primary" type="button" disabled={busy} onClick={() => void action(async () => { const result = await ghostboxApi.launchGame(task); if (!result?.success) throw new Error(result?.error || t("downloads.error")); })}>{t("downloads.play")}</button>}
          </>}
        </footer>
      </div>
    </div>, document.body,
  );
}
