import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import { deleteDownloadTaskFiles, type DownloadTask } from "../../lib/downloadManager";
import { formatBytes } from "../../utils/formatBytes";
import { layeredImageStyle } from "../../utils/image";

const emptyImageSources: string[] = [];

/**
 * O hero do modal tem ~640px de largura e recebia `header.jpg` (460px) esticado
 * sempre que o `header_2x` sem hash dava 404 — o que acontece em todo jogo já
 * migrado. Estas URLs sem hash servem de chave: o manifesto injeta a variante
 * com hash na frente de cada uma. `library_hero` entra como segunda opção
 * porque alguns jogos não publicam `header_2x`.
 */
function highDensityHeaderSources(appId: string): string[] {
  if (!appId) return [];
  return [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header_2x.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
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

/**
 * Marca de estado do download. É o único ponto saturado do modal: o estado é a
 * informação que a pessoa vem conferir, e antes ele era o elemento mais discreto
 * da tela — um texto cinza em caixa alta acima do título.
 */
function taskStateTone(status: DownloadTask["status"]): string {
  if (status === "error") return "error";
  if (status === "completed") return "done";
  return "active";
}

function taskProgressPercent(task: DownloadTask): number {
  if (task.bytesTotal <= 0) return 0;
  return Math.min(100, Math.round((task.bytesDownloaded / task.bytesTotal) * 100));
}

interface DownloadDetailsModalProps {
  task: DownloadTask | null;
  onClose: () => void;
  confirmDeleteOnOpen?: boolean;
  confirmationOnly?: boolean;
}

export function DownloadDetailsModal({
  task,
  onClose,
  confirmDeleteOnOpen = false,
  confirmationOnly = false,
}: DownloadDetailsModalProps) {
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
    // Sem o `preferOrder`, o `header.jpg` que o card da lista já decodificou
    // vencia o `header_2x` no topo da lista e o hero ficava com a arte de 460px.
    { preferOrder: true },
  );

  useEffect(() => {
    setConfirmOpen(Boolean(task && confirmDeleteOnOpen));
    setError("");
  }, [confirmDeleteOnOpen, task?.id]);

  useEffect(() => {
    if (!task) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deleting) return;
      if (confirmOpen) {
        setConfirmOpen(false);
        if (confirmationOnly) onClose();
      }
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen, confirmationOnly, deleting, onClose, task]);

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
      setConfirmOpen(false);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("downloads.details.deleteError"));
      if (!confirmationOnly) setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const closeConfirmation = () => {
    setConfirmOpen(false);
    if (confirmationOnly) onClose();
  };

  const confirmationModal = (
    <section
      className="confirm-modal"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="download-delete-confirm-title"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="confirm-modal__header">
        <h3 id="download-delete-confirm-title">{actionLabel}</h3>
      </header>
      <div className="confirm-modal__content">
        <p>{t("downloads.details.confirmDelete", { title: task.title })}</p>
        {error && <p className="download-details-modal__error" role="alert">{error}</p>}
      </div>
      <div className="confirm-modal__actions">
        <button type="button" className="button button--outline" onClick={closeConfirmation} disabled={deleting} autoFocus>
          {t("downloads.details.keepFiles")}
        </button>
        <button type="button" className="button download-details-modal__danger confirm-modal__confirm" onClick={() => void handleDelete()} disabled={deleting}>
          {deleting ? t("downloads.details.removing") : actionLabel}
        </button>
      </div>
    </section>
  );

  if (confirmationOnly) {
    return createPortal(
      <div className="backdrop backdrop--download-details" onClick={deleting ? undefined : onClose}>
        {confirmOpen ? confirmationModal : null}
      </div>,
      document.body,
    );
  }

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
            <span className={`download-details-modal__state download-details-modal__state--${taskStateTone(task.status)}`}>
              <i aria-hidden="true" />
              {t(taskStatusKey(task.status))}
            </span>
            <h3 id="download-details-title">{task.title}</h3>
          </div>
        </header>

        <div className="download-details-modal__content">
          <dl className="download-details-modal__facts">
            <div>
              <dt>{t("downloads.details.allocated")}</dt>
              <dd>{formatBytes(taskAllocatedBytes(task))}</dd>
            </div>
            {/* Data e hora eram dois blocos para o mesmo instante — três colunas
                existiam porque havia três vagas, não porque havia três fatos. */}
            <div>
              <dt>{t("downloads.details.downloadedAt")}</dt>
              <dd>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(timestamp)}
              </dd>
            </div>
            {/* A vaga liberada passa a carregar o que a tela não dizia: quanto
                falta, enquanto baixa; e se a Steam já enxerga o jogo, depois. */}
            <div>
              <dt>{isActive ? t("downloads.details.progress") : t("downloads.details.steam")}</dt>
              <dd>
                {isActive
                  ? `${taskProgressPercent(task)}%`
                  : task.steamIntegration?.status === "ok"
                    ? t("downloads.details.steamReady")
                    : t("downloads.details.steamPending")}
              </dd>
            </div>
          </dl>

          <div className="download-details-modal__path">
            <span>{t("downloads.details.destination")}</span>
            {/* Sem truncar: é o caminho que a pessoa vai colar em algum lugar, e
                um caminho com reticências não serve para nada. */}
            <strong>{task.outputDir || t("downloads.details.destinationPending")}</strong>
          </div>

          {error && <p className="download-details-modal__error" role="alert">{error}</p>}
        </div>

        <footer className="download-details-modal__actions">
          <button
            type="button"
            className="button button--outline"
            onClick={onClose}
            disabled={deleting}
            autoFocus
          >
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
            {confirmationModal}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
