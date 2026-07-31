import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import { deleteDownloadTaskFiles, type DownloadTask } from "../../lib/downloadManager";
import { formatBytes } from "../../utils/formatBytes";
import { layeredImageStyle } from "../../utils/image";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

const emptyImageSources: string[] = [];

function highDensityHeaderSources(appId: string): string[] {
  if (!appId) return [];
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header_2x.jpg`,
  ];
}

function taskStatusKey(status: DownloadTask["status"]): string {
  if (status === "downloading") return "downloads.statusDownloading";
  if (status === "queued") return "downloads.statusQueued";
  if (status === "paused") return "downloads.statusPaused";
  if (status === "completed") return "downloads.statusCompleted";
  return "downloads.statusError";
}

function taskTimestamp(task: DownloadTask): number {
  return task.finishedAt ?? task.startedAt ?? task.queuedAt;
}

function taskAllocatedBytes(task: DownloadTask): number {
  return [task.totalBytesAll, task.bytesTotal, task.totalBytesDownloaded, task.bytesDownloaded]
    .find((value) => typeof value === "number" && value > 0) ?? 0;
}

interface DownloadDetailsModalProps {
  task: DownloadTask | null;
  onClose: () => void;
}

export function DownloadDetailsModal({ task, onClose }: DownloadDetailsModalProps) {
  const { appearance, t } = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const modalHeaderSources = useMemo(
    () => task
      ? [...highDensityHeaderSources(task.appId), ...task.headerSources]
      : emptyImageSources,
    [task?.appId, task?.headerSources],
  );
  const coverSources = useCachedImageSources(modalHeaderSources);
  const { source: headerSource, loaded: headerLoaded } = useLoadableImageCover(
    coverSources,
    { appId: task?.appId ?? "", kind: "header" },
  );

  useEffect(() => {
    if (!task) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deleting) return;
      if (confirmOpen) setConfirmOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen, deleting, onClose, task]);

  if (!task || typeof document === "undefined") return null;

  const locale = appearance.language === "en" ? "en-US" : "pt-BR";
  const timestamp = new Date(taskTimestamp(task));
  const isActive = task.status === "downloading" || task.status === "queued" || task.status === "paused";
  const actionLabel = isActive ? t("downloads.details.cancel") : t("downloads.details.uninstall");

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteDownloadTaskFiles(task.id);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("downloads.details.deleteError"));
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="backdrop backdrop--download-details" onClick={deleting ? undefined : onClose}>
      <section
        className="download-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="download-details-modal__hero">
          <span
            className={`download-details-modal__hero-image${headerLoaded && headerSource ? " download-details-modal__hero-image--loaded" : ""}`}
            style={layeredImageStyle(headerLoaded && headerSource ? [headerSource] : emptyImageSources, "")}
            aria-hidden="true"
          />
          <span className="download-details-modal__hero-shade" aria-hidden="true" />
          <div className="download-details-modal__hero-copy">
            <span>{t(taskStatusKey(task.status))}</span>
            <h3 id="download-details-title">{task.title}</h3>
          </div>
          <button
            type="button"
            className="download-details-modal__close"
            onClick={onClose}
            aria-label={t("downloads.details.close")}
            disabled={deleting || confirmOpen}
            autoFocus
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="download-details-modal__content">
          <dl className="download-details-modal__facts">
            <div>
              <dt>{t("downloads.details.allocated")}</dt>
              <dd>{formatBytes(taskAllocatedBytes(task))}</dd>
            </div>
            <div>
              <dt>{t("downloads.details.date")}</dt>
              <dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(timestamp)}</dd>
            </div>
            <div>
              <dt>{t("downloads.details.time")}</dt>
              <dd>{new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(timestamp)}</dd>
            </div>
          </dl>

          <div className="download-details-modal__path">
            <span>{t("downloads.details.destination")}</span>
            <strong title={task.outputDir}>{task.outputDir}</strong>
          </div>

          {error && <p className="download-details-modal__error" role="alert">{error}</p>}
        </div>

        <footer className="download-details-modal__actions">
          <button type="button" className="button button--outline" onClick={onClose} disabled={deleting || confirmOpen}>
            {t("downloads.details.close")}
          </button>
          <button
            type="button"
            className="button download-details-modal__danger"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting || confirmOpen}
          >
            <Trash2 size={15} aria-hidden="true" />
            {actionLabel}
          </button>
        </footer>

        {confirmOpen && (
          <div className="download-details-modal__confirm-backdrop" onClick={deleting ? undefined : () => setConfirmOpen(false)}>
            <section
              className="confirm-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="download-delete-confirm-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="confirm-modal__header">
                <h3 id="download-delete-confirm-title">{actionLabel}</h3>
                <AlertTriangle size={19} aria-hidden="true" />
              </header>
              <div className="confirm-modal__content">
                <p>{t("downloads.details.confirmDelete", { title: task.title })}</p>
              </div>
              <div className="confirm-modal__actions">
                <button type="button" className="button button--outline" onClick={() => setConfirmOpen(false)} disabled={deleting} autoFocus>
                  {t("downloads.details.keepFiles")}
                </button>
                <button type="button" className="button download-details-modal__danger confirm-modal__confirm" onClick={() => void handleDelete()} disabled={deleting}>
                  {deleting ? t("downloads.details.removing") : actionLabel}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
