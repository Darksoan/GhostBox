import { useEffect, useMemo, useRef } from "react";
import { CloudAlert, CloudCheck, FolderInput, Trash } from "lucide-react";
import type { PirateGame } from "../data";
import type { BackupEntry, BackupRootStatus, BackupSettings } from "../types";
import { useSettings } from "../context/settings";
import { pirateboxApi } from "../lib/pirateboxApi";

type BackupPageProps = {
  games: PirateGame[];
  installedGameAppIds?: Set<string>;
  isRefreshingInstallationStatus?: boolean;
  backupSettings: BackupSettings | null;
  backupRootStatus?: BackupRootStatus | null;
  onLocateBackupRoot?: () => void;
  onCreateBackupRoot?: () => void;
  onBackupSettingsChange?: (settings: BackupSettings) => void;
  onOpenBackupFolder?: (appId: string, backupPath?: string) => void;
  onDeleteBackupFolder?: (
    appId: string,
    title: string,
    backupPath?: string
  ) => void;
};

type BackupListItem = {
  appId: string;
  title: string;
  record?: BackupSettings["backupRecords"][string];
};

function formatBackupDate(value: string | undefined, language: "pt" | "en") {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBackupEntries(
  record: BackupSettings["backupRecords"][string] | undefined
): BackupEntry[] {
  if (record?.entries?.length) return record.entries;

  if (record?.lastBackupSuccess === true && record.lastBackupPath) {
    return [
      {
        path: record.lastBackupPath,
        backupAt: record.lastBackupAt,
        sizeBytes: record.lastBackupSizeBytes,
      },
    ];
  }

  return [];
}

function backupErrorMessage(error: string | undefined, language: "pt" | "en") {
  const normalized = error?.trim();
  if (!normalized) {
    return language === "en"
      ? "Backup did not finish successfully."
      : "O backup não terminou com sucesso.";
  }

  const lower = normalized.toLowerCase();
  if (lower.includes("sidecar") || lower.includes("ludusavi")) {
    return language === "en"
      ? `Ludusavi is not available: ${normalized}`
      : `Ludusavi não está disponível: ${normalized}`;
  }
  if (lower.includes("no saves") || lower.includes("sem saves")) {
    return language === "en"
      ? "No compatible saves were found for this game."
      : "Nenhum save compatível foi encontrado para este jogo.";
  }
  if (lower.includes("path") || lower.includes("caminho") || lower.includes("pasta")) {
    return language === "en"
      ? `Backup path problem: ${normalized}`
      : `Problema no caminho do backup: ${normalized}`;
  }

  return normalized;
}

export function BackupPage({
  games,
  backupSettings,
  backupRootStatus,
  onLocateBackupRoot,
  onCreateBackupRoot,
  onBackupSettingsChange,
  onOpenBackupFolder,
  onDeleteBackupFolder,
}: BackupPageProps) {
  const { appearance } = useSettings();
  const language = appearance.language;
  const refreshedMetadataSignatureRef = useRef("");

  const backupGames = useMemo(() => {
    const records = backupSettings?.backupRecords ?? {};
    const gamesByAppId = new Map(games.map((game) => [game.appId, game]));

    return Object.entries(records)
      .filter(
        ([, record]) =>
          getBackupEntries(record).length > 0 ||
          record?.lastBackupSuccess === false ||
          Boolean(record?.lastBackupError)
      )
      .map<BackupListItem>(([appId, record]) => {
        const game = gamesByAppId.get(appId);

        return {
          appId,
          title: game?.title ?? record?.title ?? appId,
          record,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [backupSettings, games]);

  useEffect(() => {
    if (backupRootStatus?.status !== "ok" || !backupGames.length) return;

    const metadataSignature = backupGames
      .map(
        ({ appId, record }) =>
          `${appId}:${getBackupEntries(record)
            .map((entry) => entry.path)
            .join("|")}`
      )
      .join(";");
    if (refreshedMetadataSignatureRef.current === metadataSignature) return;
    refreshedMetadataSignatureRef.current = metadataSignature;

    let cancelled = false;

    void (async () => {
      let latestSettings = backupSettings;
      let changed = false;

      for (const { appId, record } of backupGames.slice(0, 25)) {
        if (cancelled) continue;

        const settings = await pirateboxApi
          .refreshGameBackupMetadata(appId)
          .catch(() => null);
        const nextRecord = settings?.backupRecords[appId];
        if (
          settings &&
          JSON.stringify(nextRecord ?? null) !== JSON.stringify(record ?? null)
        ) {
          latestSettings = settings;
          changed = true;
        }
      }

      if (!cancelled && changed && latestSettings) {
        onBackupSettingsChange?.(latestSettings);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    backupGames,
    backupRootStatus?.status,
    backupSettings,
    onBackupSettingsChange,
  ]);

  return (
    <section className="backup-page content-section content-section--full">
      {backupRootStatus && backupRootStatus.status !== "ok" && (
        <div className="backup-page__sync-warning" role="status">
          <CloudAlert size={22} aria-hidden="true" />
          <div>
            <strong>
              {language === "en"
                ? "Backup folder not found"
                : "Pasta de backups não encontrada"}
            </strong>
            <span>{backupRootStatus.message}</span>
            <small>{backupRootStatus.outputPath}</small>
          </div>
          <div className="backup-page__sync-warning-actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={onLocateBackupRoot}
            >
              {language === "en" ? "Locate folder" : "Localizar pasta"}
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={onCreateBackupRoot}
            >
              {language === "en" ? "Create again" : "Criar novamente"}
            </button>
          </div>
        </div>
      )}

      {backupGames.length > 0 ? (
        <ul
          className="backup-list"
          aria-label={
            language === "en"
              ? "Games with automatic backup"
              : "Jogos com backup automático"
          }
        >
          {backupGames.map(({ appId, title, record }) => {
            const recordEntries = getBackupEntries(record);
            const backupPath = recordEntries[0]?.path;
            const canResolveBackupFolder = Boolean(
              backupPath || record?.lastBackupSuccess === true
            );
            const canOpenBackupFolder = Boolean(
              canResolveBackupFolder && onOpenBackupFolder
            );
            const canDeleteBackupFolder = Boolean(
              canResolveBackupFolder && onDeleteBackupFolder
            );
            const latestBackupDate = formatBackupDate(
              recordEntries[0]?.backupAt,
              language
            );
            const hasSuccessfulBackup = recordEntries.length > 0;
            const backupError =
              record?.lastBackupSuccess === false || record?.lastBackupError
                ? backupErrorMessage(record?.lastBackupError, language)
                : "";
            const isRootSynced = backupRootStatus?.status === "ok";
            const useSuccessIcon = hasSuccessfulBackup && isRootSynced;

            return (
              <li
                key={appId}
                className={`backup-list__item ${
                  useSuccessIcon
                    ? "backup-list__item--success"
                    : "backup-list__item--missing"
                }`}
              >
                <div className="backup-list__content" role="group">
                  <div className="backup-list__copy-row">
                    {useSuccessIcon ? (
                      <CloudCheck
                        className="backup-list__icon"
                        size={28}
                        aria-hidden="true"
                      />
                    ) : (
                      <CloudAlert
                        className="backup-list__icon"
                        size={28}
                        aria-hidden="true"
                      />
                    )}
                    <div className="backup-list__copy">
                      <strong>{title}</strong>
                      {backupError && (
                        <span className="backup-list__error">{backupError}</span>
                      )}
                      {latestBackupDate && <small>{latestBackupDate}</small>}
                    </div>
                  </div>

                  <div className="backup-list__actions">
                    <button
                      type="button"
                      className="backup-list__action-button"
                      disabled={!canOpenBackupFolder}
                      aria-label={
                        language === "en"
                          ? "Open backup folder"
                          : "Abrir pasta do backup"
                      }
                      onClick={() =>
                        canOpenBackupFolder &&
                        onOpenBackupFolder?.(appId, backupPath)
                      }
                    >
                      <FolderInput size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="backup-list__action-button backup-list__action-button--danger"
                      disabled={!canDeleteBackupFolder}
                      aria-label={
                        language === "en"
                          ? "Delete backup folder"
                          : "Excluir pasta do backup"
                      }
                      onClick={() =>
                        canDeleteBackupFolder &&
                        onDeleteBackupFolder?.(appId, title, backupPath)
                      }
                    >
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="backup-page__empty">
          {language === "en"
            ? "No backups found in the backup folder. Add games to your library to restore existing backups automatically."
            : "Nenhum backup encontrado na pasta de backups. Adicione jogos à biblioteca para restaurar backups existentes automaticamente."}
        </div>
      )}
    </section>
  );
}
