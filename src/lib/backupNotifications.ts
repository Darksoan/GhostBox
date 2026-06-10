import type { BackupRecord, BackupSettings } from "../types";
import type { ToastVariant } from "../components/ui/Toast";

export type BackupToastPayload = {
  title: string;
  message: string;
  variant: ToastVariant;
};

export function getBackupRecordLatestKey(record: BackupRecord) {
  const latestEntry = record.entries?.[0];
  return [
    latestEntry?.path ?? record.lastBackupPath ?? "",
    latestEntry?.backupAt ?? record.lastBackupAt ?? "",
    record.lastBackupSuccess ? "ok" : "failed",
  ].join("|");
}

export function getLatestChangedBackupRecord(
  previous: BackupSettings | null,
  next: BackupSettings
): BackupRecord | null {
  if (!previous) return null;

  return Object.entries(next.backupRecords).reduce<BackupRecord | null>(
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

      if (!latest) return record;
      return Date.parse(record.lastBackupAt) > Date.parse(latest.lastBackupAt)
        ? record
        : latest;
    },
    null
  );
}

export function createBackupToastFromRecord(
  record: BackupRecord
): BackupToastPayload {
  if (record.lastBackupSuccess) {
    return {
      title: "Backup concluído",
      message: `${record.title} foi salvo com sucesso.`,
      variant: "success",
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
