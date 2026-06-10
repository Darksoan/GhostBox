import type { PirateGame } from "../data";
import type { BackupSettings } from "../types";

/** Optional UI dev seeds until backend commands are implemented. */
export const frontendMockBackupSettings: BackupSettings = {
  outputPath: "",
  automaticBackupsForLibrary: false,
  automaticBackups: {},
  backupRecords: {},
  customExecutables: {},
};

export const frontendMockCatalogueGames: PirateGame[] = [];
