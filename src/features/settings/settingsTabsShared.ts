import {
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
  | "notifications";

export const settingsTabLabelKeys: Record<SettingsTabId, string> = {
  general: "settings.tabs.general.label",
  performance: "settings.tabs.performance.label",
  library: "settings.tabs.library.label",
  connections: "settings.tabs.connections.label",
  subscription: "settings.tabs.subscription.label",
  notifications: "settings.tabs.notifications.label",
};

/** Descripciones por aba — texto corto bajo el título del encabezado de página. */
export const settingsTabDescriptionKeys: Record<SettingsTabId, string> = {
  general: "settings.tabs.general.description",
  performance: "settings.tabs.performance.description",
  library: "settings.tabs.library.description",
  connections: "settings.tabs.connections.description",
  subscription: "settings.tabs.subscription.description",
  notifications: "settings.tabs.notifications.description",
};

type SettingsNavigationTab = {
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
];
