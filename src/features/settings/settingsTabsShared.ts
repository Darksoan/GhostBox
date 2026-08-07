import {
  Code2,
  Crown,
  Bell,
  FolderCog,
  Gauge,
  Link2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsTabId =
  | "general"
  | "performance"
  | "library"
  | "connections"
  | "subscription"
  | "notifications"
  | "download";

export const settingsTabLabelKeys: Record<SettingsTabId, string> = {
  general: "settings.tabs.general.label",
  performance: "settings.tabs.performance.label",
  library: "settings.tabs.library.label",
  connections: "settings.tabs.connections.label",
  subscription: "settings.tabs.subscription.label",
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
  { id: "connections", icon: Link2 },
  { id: "subscription", icon: Crown },
  { id: "notifications", icon: Bell },
  { id: "download", icon: Code2 },
];
