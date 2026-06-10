import {
  Code2,
  DatabaseBackup,
  Bell,
  FolderCog,
  Gauge,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsTabId =
  | "general"
  | "performance"
  | "library"
  | "backups"
  | "notifications"
  | "download";

export const settingsTabLabelKeys: Record<SettingsTabId, string> = {
  general: "settings.tabs.general.label",
  performance: "settings.tabs.performance.label",
  library: "settings.tabs.library.label",
  backups: "settings.tabs.backups.label",
  notifications: "settings.tabs.notifications.label",
  download: "settings.tabs.download.label",
};

export type SettingsNavigationTab = {
  id: SettingsTabId;
  icon: LucideIcon;
};

export const settingsNavigationTabs: SettingsNavigationTab[] = [
  { id: "general", icon: SlidersHorizontal },
  { id: "performance", icon: Gauge },
  { id: "library", icon: FolderCog },
  { id: "backups", icon: DatabaseBackup },
  { id: "notifications", icon: Bell },
  { id: "download", icon: Code2 },
];
