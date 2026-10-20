import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";
import { deleteDownloadTask, type DownloadTask } from "../../lib/downloadManager";

export function DownloadRemoveModal({ task, onClose }: { task: DownloadTask; onClose: () => void }) {
  const { t } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const interaction = useRef({ busy, onClose });
  interaction.current = { busy, onClose };
  const completed = task.status === "completed";
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
          <div><h3 id="download-details-title">{t(completed ? "downloads.removeTitle" : "downloads.cancelTitle")}</h3><p>{t(completed ? "downloads.removeHistoryDescription" : "downloads.cancelDescription")}</p></div>
          <button className="collection-modal__close" type="button" onClick={onClose} disabled={busy} aria-label={t("downloads.close")}><ModalCloseIcon /></button>
        </header>
        {error && <div className="collection-modal__content download-details-modal__content"><p role="alert">{error}</p></div>}
        <footer className="collection-modal__actions download-details-modal__actions">
          <button className="button button--outline" type="button" onClick={onClose} disabled={busy}>{t("downloads.cancel")}</button>
          <button className="button button--outline" type="button" disabled={busy} onClick={() => void action(async () => { await deleteDownloadTask(task.id, !completed); onClose(); })}>{t(completed ? "downloads.confirmRemove" : "downloads.confirmCancel")}</button>
        </footer>
      </div>
    </div>, document.body,
  );
}
