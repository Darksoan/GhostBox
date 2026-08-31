import type { BackupRecord, BackupSettings } from "../types";

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
