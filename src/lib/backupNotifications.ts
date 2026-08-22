import type { BackupRecord, BackupSettings } from "../types";
import type { ToastVariant } from "../components/ui/Toast";
import { highDensityHeaderSources } from "../utils/image";

export type BackupToastPayload = {
  title: string;
  message: string;
  variant: ToastVariant;
  imageSources?: string[];
};

export function getBackupRecordLatestKey(record: BackupRecord) {
  const latestEntry = record.entries?.[0];
  return [
    latestEntry?.path ?? record.lastBackupPath ?? "",
    latestEntry?.backupAt ?? record.lastBackupAt ?? "",
    record.lastBackupSuccess ? "ok" : "failed",
  ].join("|");
}

export type ChangedBackupRecord = { appId: string; record: BackupRecord };

export function getLatestChangedBackupRecord(
  previous: BackupSettings | null,
  next: BackupSettings
): ChangedBackupRecord | null {
  if (!previous) return null;

  return Object.entries(next.backupRecords).reduce<ChangedBackupRecord | null>(
    (latest, [appId, record]) => {
      const previousRecord = previous.backupRecords[appId];
      if (
        !record.lastBackupAt ||
        (previousRecord?.lastBackupAt === record.lastBackupAt &&
          previousRecord?.lastBackupSuccess === record.lastBackupSuccess &&
          previousRecord?.lastBackupError === record.lastBackupError)
      ) {
        return latest;
      }

      if (!latest) return { appId, record };
      return Date.parse(record.lastBackupAt) > Date.parse(latest.record.lastBackupAt)
        ? { appId, record }
        : latest;
    },
    null
  );
}

export function createBackupToastFromRecord(
  record: BackupRecord,
  appId?: string
): BackupToastPayload {
  if (record.lastBackupSuccess) {
    return {
      title: `${record.title} salvo com sucesso!`,
      // O título já informa o resultado; a capsule do jogo ocupa o lugar do texto.
      message: "",
      variant: "success",
      imageSources: appId ? highDensityHeaderSources(appId) : undefined,
    };
  }

  return {
    title: "Falha no backup",
    message: record.lastBackupError || `${record.title} não pôde ser salvo.`,
    variant: "error",
  };
}

export function isAppFocused() {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

export function showDesktopBackupNotification(
  payload: BackupToastPayload,
  enabled: boolean
) {
  if (!enabled || typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;

  const show = () => {
    try {
      new Notification(payload.title, { body: payload.message });
    } catch {
      // Ignore unsupported desktop notification environments.
    }
  };

  if (Notification.permission === "granted") {
    show();
    return;
  }

  void Notification.requestPermission().then((permission) => {
    if (permission === "granted") show();
  });
}
