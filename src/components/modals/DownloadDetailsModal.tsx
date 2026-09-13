import { FolderOpen, LoaderCircle, Pause, Play, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import {
  deleteDownloadTaskFiles,
  pauseDownloadTask,
  resumeDownloadTask,
  retryDownloadIgnoringStaleManifest,
  type DownloadTask,
} from "../../lib/downloadManager";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { formatBytes } from "../../utils/formatBytes";
import { isHeaderImageSource, isPortraitLibraryImageSource, layeredImageStyle } from "../../utils/image";
import { isSteamTitlePlaceholder } from "../../utils/steamTitles";

const emptyImageSources: string[] = [];

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
  const { showToast } = useOverlay();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [resolvedTitle, setResolvedTitle] = useState(task?.title ?? "");
  useEffect(() => {
    if (!task) return;
    if (!isSteamTitlePlaceholder(task.title, task.appId)) {
      setResolvedTitle(task.title);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const details =
          (await ghostboxApi.getGameDetails(task.appId).catch(() => null)) ??
          (await ghostboxApi
            .getGameStoreDetails(task.appId, appearance.language)
            .catch(() => null));
        if (
          !cancelled &&
          details?.title &&
          !isSteamTitlePlaceholder(details.title, task.appId)
        ) {
          setResolvedTitle(details.title);
          return;
        }
        if (cancelled) return;
        try {
          const result = await ghostboxApi.getGames({
            query: task.appId,
            limit: 5,
          });
          const match = result.games.find(
            (game) =>
              game.appId === task.appId &&
              !isSteamTitlePlaceholder(game.title, game.appId),
          );
          if (!cancelled && match) setResolvedTitle(match.title);
        } catch {}
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [task?.appId, task?.title, appearance.language]);
  const modalHeaderSources = useMemo(() => {
    if (!task) return emptyImageSources;
    const coverUrl = task.coverUrl?.trim();
    const isCoverHorizontalHeader =
      !!coverUrl &&
      (coverUrl.includes("header") || coverUrl.includes("capsule_616x353")) &&
      !coverUrl.includes("library_hero") &&
      !coverUrl.includes("library_600x900") &&
      !coverUrl.includes("hero_capsule") &&
      !coverUrl.includes("library_hero_2x");
    const header2xSources = [
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header_2x.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header_2x.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${task.appId}/header_2x.jpg`,
    ];
    const capsuleSources = [
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${task.appId}/capsule_616x353.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${task.appId}/capsule_616x353.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${task.appId}/capsule_616x353.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${task.appId}/capsule_616x353.jpg`,
    ];
    const headerSources = [
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header.jpg`,
      `https://shared.steamstatic.com/store_item_assets/steam/apps/${task.appId}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${task.appId}/header.jpg`,
    ];
    const filteredTaskSources = task.headerSources.filter(
      (src) =>
        !isPortraitLibraryImageSource(src) &&
        !src.includes("library_hero") &&
        !src.includes("hero_capsule") &&
        src !== coverUrl,
    );
    const capsuleHeaderSources = [
      ...header2xSources,
      ...(isCoverHorizontalHeader ? [coverUrl] : []),
      ...capsuleSources,
      ...headerSources,
    ];
    return [...capsuleHeaderSources, ...filteredTaskSources];
  }, [task?.appId, task?.coverUrl, task?.headerSources]);
  const previewHeaderSources = useMemo(
    () => [
      ...modalHeaderSources.filter(isHeaderImageSource),
      ...modalHeaderSources,
    ],
    [modalHeaderSources],
  );
  const coverSources = useCachedImageSources(modalHeaderSources);
  const previewSources = useCachedImageSources(previewHeaderSources);
  const previewCover = useLoadableImageCover(previewSources);
  const preferredCover = useLoadableImageCover(
    coverSources,
    { preferOrder: true },
  );
  const { source: headerSource, loaded: headerLoaded } =
    preferredCover.loaded ? preferredCover : previewCover;

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
  const isDownloading = task.status === "downloading";
  const isQueued = task.status === "queued";
  const isPaused = task.status === "paused";
  const isCompleted = task.status === "completed";
  const canPause = isDownloading || isQueued;
  const canResume = isPaused;
  // O que ainda falta viver no HUD, junto da barra: é a pergunta que a pessoa
  // faz de olho no download. Sem total conhecido, restante não existe.
  const remainingBytes =
    task.bytesTotal > 0 ? Math.max(0, task.bytesTotal - task.bytesDownloaded) : 0;

  const handlePause = () => {
    pauseDownloadTask(task.id);
  };

  const handleResume = () => {
    resumeDownloadTask(task.id);
  };

  const handleOpenFolder = async () => {
    try {
      await ghostboxApi.revealDownloadFolder(task.outputDir);
    } catch {
      showToast(t("downloads.openFolder"), t("downloads.openFolderError"), "error");
    }
  };

  const handleLaunch = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const appType = (await ghostboxApi.getSteamAppTypes([task.appId]))[task.appId];
      if (!appType || appType.toLowerCase() === "demo") return;
      await Promise.all([
        ghostboxApi.launchDownloadedGame(
          task.appId,
          resolvedTitle,
          task.downloadsRoot,
          task.outputDir,
          task.installDir,
        ),
        new Promise((resolve) => window.setTimeout(resolve, 700)),
      ]);
    } catch {
      showToast(t("downloads.launch"), t("downloads.launchError"), "error");
    } finally {
      setLaunching(false);
    }
  };

  const handleRetryStale = () => {
    retryDownloadIgnoringStaleManifest(task.id);
  };

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
        <p>{t("downloads.details.confirmDelete", { title: resolvedTitle })}</p>
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
        </header>

        <div className="download-details-modal__content">
          {/* Estado, título e progresso abrem a ficha, fora da arte: com o
              gradiente de fusão removido, a capa aparece inteira e texto sobre
              ela não teria contraste garantido. */}
          <section className="download-details-modal__summary" aria-label={t("downloads.details.progress")}>
            <div className="download-details-modal__summary-head">
              <div className="download-details-modal__summary-title">
                <h3 id="download-details-title">{resolvedTitle}</h3>
                <span className={`download-details-modal__state download-details-modal__state--${taskStateTone(task.status)}`}>
                  {t(taskStatusKey(task.status))}
                </span>
              </div>
              {isActive && (
                <strong className="download-details-modal__summary-percent">{taskProgressPercent(task)}%</strong>
              )}
            </div>
            {isActive && (
              <>
                <div
                  className="download-details-modal__summary-progress"
                  role="progressbar"
                  aria-label={t("downloads.details.progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={taskProgressPercent(task)}
                >
                  <span style={{ transform: `scaleX(${taskProgressPercent(task) / 100})` }} />
                </div>
                {remainingBytes > 0 && (
                  <span className="download-details-modal__summary-remaining">
                    {t("downloads.remaining", { size: formatBytes(remainingBytes) })}
                  </span>
                )}
              </>
            )}
          </section>

          <dl className="download-details-modal__facts">
            {isCompleted && (
              <>
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
              </>
            )}
            {/* A vaga liberada carrega o que a tela não dizia: depois de concluir,
                se a Steam já enxerga o jogo. Enquanto baixa, o que falta mora no
                HUD do hero, ao lado da barra — é pergunta de progresso, não ficha. */}
            {isCompleted && (
              <div>
                <dt>{t("downloads.details.steam")}</dt>
                <dd>
                  {task.steamIntegration?.status === "ok"
                    ? t("downloads.details.steamReady")
                    : t("downloads.details.steamPending")}
                </dd>
              </div>
            )}
          </dl>

          <section className="download-details-modal__path">
            <span className="download-details-modal__path-label">{t("downloads.details.destination")}</span>
            {/* Sem truncar: é o caminho que a pessoa vai colar em algum lugar, e
                um caminho com reticências não serve para nada. */}
            <strong>{task.outputDir || t("downloads.details.destinationPending")}</strong>
          </section>

          {task.staleManifest && (
            <div className="download-details-modal__stale" role="alert">
              <span className="download-details-modal__stale-detail">
                {t("downloads.staleManifestDetail", {
                  depots: task.staleManifest.depots.map((depot) => depot.depotId).join(", "),
                  buildId: task.staleManifest.publicBuildId || "--",
                })}
              </span>
              <button
                type="button"
                className="button button--outline"
                onClick={handleRetryStale}
              >
                {t("downloads.staleManifestDownloadAnyway")}
              </button>
            </div>
          )}

          {error && <p className="download-details-modal__error" role="alert">{error}</p>}
        </div>

        <footer className="download-details-modal__actions">
          <button
            type="button"
            className="button download-details-modal__danger"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting || confirmOpen}
          >
            <Trash size={18} strokeWidth={2} aria-hidden="true" />
            <span>{actionLabel}</span>
          </button>
          {(canPause || canResume) && (
            <button
              type="button"
              className="button button--outline download-details-modal__toggle"
              onClick={canPause ? handlePause : handleResume}
              aria-label={t(canPause ? "downloads.pause" : "downloads.resume")}
            >
              <Pause size={18} strokeWidth={2} data-active={canPause} aria-hidden="true" />
              <Play size={18} strokeWidth={2} data-active={canResume} aria-hidden="true" />
              <span>
                <span aria-hidden={!canPause}>{t("downloads.pause")}</span>
                <span aria-hidden={!canResume}>{t("downloads.resume")}</span>
              </span>
            </button>
          )}
          {isCompleted && (
            <>
              <button
                type="button"
                className="button button--outline"
                onClick={handleOpenFolder}
                aria-label={t("downloads.openFolder")}
              >
                <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
                <span>{t("downloads.openFolder")}</span>
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={handleLaunch}
                disabled={launching}
                aria-busy={launching}
                aria-label={t("downloads.launch")}
              >
                {launching ? (
                  <LoaderCircle
                    size={18}
                    strokeWidth={2}
                    className="download-details-modal__launch-spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <Play size={18} strokeWidth={2} aria-hidden="true" />
                )}
                <span>{t("downloads.launch")}</span>
              </button>
            </>
          )}
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
