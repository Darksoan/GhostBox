import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/ui/LoadingStates";
import { DownloadDetailsModal } from "../components/modals/DownloadDetailsModal";
import { useSettings } from "../context/settings";
import { useCachedImageSources, useLoadableImageCover } from "../hooks/useCachedImageSources";
import {
  clearFinishedDownloadTasks,
  downloadTasksChangedEvent,
  pauseDownloadTask,
  readDownloadTasks,
  removeDownloadTask,
  resumeDownloadTask,
  type DownloadTask,
} from "../lib/downloadManager";
import { formatBytes, formatSpeed } from "../utils/formatBytes";
import { layeredImageStyle } from "../utils/image";

const emptyImageSources: string[] = [];

const statusRank: Record<DownloadTask["status"], number> = {
  downloading: 0,
  queued: 0,
  paused: 0,
  error: 1,
  completed: 1,
};

function isActiveTask(task: DownloadTask) {
  return task.status === "downloading" || task.status === "queued" || task.status === "paused";
}

function sortTasks(tasks: DownloadTask[]): DownloadTask[] {
  return [...tasks].sort((left, right) => {
    const rankDiff = statusRank[left.status] - statusRank[right.status];
    if (rankDiff !== 0) return rankDiff;
    if (isActiveTask(left) && isActiveTask(right)) {
      return left.queuedAt - right.queuedAt;
    }
    return (right.finishedAt ?? 0) - (left.finishedAt ?? 0);
  });
}

/**
 * Uma unidade só. A segunda casa muda a cada segundo sem alterar a decisão de
 * ninguém, e ainda fazia o rótulo oscilar de largura o tempo todo.
 */
function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";

  const totalSeconds = Math.ceil(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  // Arredonda ao minuto mais próximo: com `ceil`, 61s virava "2min".
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatDownloadTimestamp(timestamp: number | undefined, language: "pt" | "en") {
  if (!timestamp || !Number.isFinite(timestamp)) return "--";

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function DownloadCard({
  task,
  queuePosition,
  onPause,
  onResume,
  onOpen,
}: {
  task: DownloadTask;
  queuePosition: number | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { appearance, t } = useSettings();
  const progressPercent =
    task.bytesTotal > 0
      ? Math.min(100, Math.round((task.bytesDownloaded / task.bytesTotal) * 100))
      : 0;
  // O texto de "calculando" é o rótulo inteiro, não o valor: interpolado como
  // `{time}` ele saía como "calculando… restantes".
  const etaLabel =
    typeof task.estimatedSecondsRemaining === "number"
      ? t("downloads.estimatedTime", {
          time: formatEta(task.estimatedSecondsRemaining),
        })
      : t("downloads.estimatedTimeCalculating");
  const statusLabel =
    task.status === "queued"
      ? t("downloads.queuePosition", { position: queuePosition ?? 1 })
      : task.status === "downloading"
        ? t("downloads.statusDownloading")
        : task.status === "paused"
          ? t("downloads.statusPaused")
          : task.status === "completed"
            ? t("downloads.statusCompleted")
            : t("downloads.statusError");
  const downloadedAt = formatDownloadTimestamp(task.startedAt ?? task.queuedAt, appearance.language);
  // Retomar passa por "queued" antes de "downloading", então os três estados precisam
  // do mesmo esqueleto: sem isso a linha de progresso pisca a cada pause/resume.
  const showsProgress =
    task.status === "downloading" || task.status === "paused" || task.status === "queued";
  const showsLiveSpeed = task.status === "downloading";

  /**
   * Uma linha só, em vez dos quatro fragmentos que antes ficavam ancorados em
   * cantos diferentes do card. Sem separador: o espaçamento entre itens já
   * marca a quebra, um "·" era decoração sem função.
   *
   * Ordem por estabilidade de largura: o que muda a cada segundo vai por
   * último, para não empurrar o resto da linha. "Baixando" fica de fora — os
   * números já dizem isso, e a palavra ocupava a posição mais nobre à toa. A
   * data não entra aqui: com o download já terminado ela vai para o canto
   * direito, junto do título, não disputando espaço com o tamanho baixado.
   */
  const metaItems = (
    showsProgress
      ? [
          task.status === "downloading" ? "" : statusLabel,
          `${formatBytes(task.bytesDownloaded)} / ${
            task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : "--"
          }`,
          showsLiveSpeed ? etaLabel : "",
          showsLiveSpeed ? formatSpeed(task.speedBytesPerSecond) : "",
        ]
      : [
          statusLabel,
          task.status === "completed"
            ? t("downloads.totalDownloaded", {
                size: formatBytes(task.totalBytesDownloaded ?? 0),
              })
            : "",
          task.status === "completed" && task.failedFiles
            ? t("downloads.failedFiles", { count: task.failedFiles })
            : "",
        ]
  ).filter(Boolean);
  const canPause = task.status === "downloading" || task.status === "queued";
  const canResume = task.status === "paused";
  const canCancel = task.status === "downloading" || task.status === "queued" || task.status === "paused";
  // Só para erro: concluído não tem nada para descartar além do registro em
  // si, e um X ali ao lado de um download que deu certo lia como se algo
  // tivesse dado errado.
  const canRemove = task.status === "error";
  const hasControls = canPause || canResume || canCancel || canRemove;
  const controls = (
    <span className="download-card__controls">
      {canPause ? (
        <button
          type="button"
          className="download-card__icon-button"
          onClick={() => onPause(task.id)}
          aria-label={t("downloads.pause")}
          title={t("downloads.pause")}
        >
          <Pause size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canResume ? (
        <button
          type="button"
          className="download-card__icon-button"
          onClick={() => onResume(task.id)}
          aria-label={t("downloads.resume")}
          title={t("downloads.resume")}
        >
          <Play size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          className="download-card__icon-button download-card__icon-button--danger"
          onClick={() => onOpen(task.id)}
          aria-label={t("downloads.cancel")}
          title={t("downloads.cancel")}
        >
          <X size={15} strokeWidth={2} />
        </button>
      ) : null}
      {canRemove ? (
        <button
          type="button"
          className="download-card__remove"
          onClick={() => removeDownloadTask(task.id)}
          aria-label={t("downloads.remove")}
          title={t("downloads.remove")}
        >
          <X size={15} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );

  const coverSources = useCachedImageSources(task.headerSources);
  // O appId sai das próprias URLs do Steam em `useCachedImageSources`; não há
  // mais override explícito no hook.
  const { source: headerSource, loaded: headerLoaded } =
    useLoadableImageCover(coverSources);

  return (
    <article
      className={`download-card download-card--${task.status}${
        hasControls ? "" : " download-card--no-controls"
      }`}
    >
      <button
        type="button"
        className="download-card__open"
        onClick={() => onOpen(task.id)}
        aria-label={t("downloads.details.open", { title: task.title })}
      />
      <span className="download-card__cover-slot" aria-hidden="true">
        <span
          className={`download-card__cover${
            headerLoaded && headerSource
              ? " download-card__cover--loaded"
              : " download-card__cover--loading"
          }`}
          style={layeredImageStyle(
            headerLoaded && headerSource ? [headerSource] : emptyImageSources,
            "",
          )}
        />
      </span>

      <div className="download-card__content">
        {/* Só aparece com o download terminado: durante o progresso a barra
            ocupa esse espaço e a data ainda não interessa. Ancorada no card
            (o `__content` não é `relative`), então vai para o canto superior
            direito sem que a largura do título a desloque. */}
        {showsProgress ? null : (
          <span className="download-card__date">{downloadedAt}</span>
        )}

        <strong className="download-card__title">{task.title}</strong>

        {showsProgress ? (
          <span
            className="download-card__progress-track"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        ) : null}

        <span className="download-card__meta-line">
          {metaItems.map((item) => (
            <span key={item} className="download-card__meta-item">
              {item}
            </span>
          ))}
        </span>

        {task.status === "error" ? (
          <span className="download-card__error">
            {task.errorMessage ?? t("downloads.genericError")}
          </span>
        ) : null}
      </div>

      {hasControls ? controls : null}
    </article>
  );
}

export function DownloadsPage() {
  const { t } = useSettings();
  const [tasks, setTasks] = useState<DownloadTask[]>(() => readDownloadTasks());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setTasks(readDownloadTasks());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(downloadTasksChangedEvent, refresh);
    return () => window.removeEventListener(downloadTasksChangedEvent, refresh);
  }, [refresh]);

  const sortedTasks = sortTasks(tasks);
  const queuedTasks = sortedTasks.filter((task) => task.status === "queued");
  const hasFinishedTasks = tasks.some(
    (task) => task.status === "completed" || task.status === "error",
  );
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  return (
    <section className="downloads-page content-section content-section--full">
      {sortedTasks.length > 0 ? (
        <div className="downloads-page__list">
          {sortedTasks.map((task) => (
            <DownloadCard
              key={task.id}
              task={task}
              queuePosition={
                task.status === "queued"
                  ? queuedTasks.findIndex((entry) => entry.id === task.id) + 1
                  : null
              }
              onPause={pauseDownloadTask}
              onResume={resumeDownloadTask}
              onOpen={setSelectedTaskId}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="downloads-page__empty"
          title={t("downloads.emptyTitle")}
        />
      )}

      {hasFinishedTasks && (
        <div className="downloads-page__footer">
          <button
            type="button"
            className="downloads-page__clear"
            onClick={() => clearFinishedDownloadTasks()}
          >
            {t("downloads.clear")}
          </button>
        </div>
      )}

      <DownloadDetailsModal task={selectedTask} onClose={() => setSelectedTaskId(null)} />
    </section>
  );
}
