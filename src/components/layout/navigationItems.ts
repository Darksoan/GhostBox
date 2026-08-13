import { Download, Home, Layers, Settings, type LucideIcon } from "lucide-react";
import { Grid } from "reicon-react";
import type { Page } from "../../types";

export type NavIcon = LucideIcon | typeof Grid;

export type NavItem = {
  id: Page;
  icon: NavIcon;
  labelKey: string;
};

/** Páginas principais, na ordem em que aparecem na sidebar e no card flutuante. */
export const primaryNavigation: NavItem[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Layers },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
];

/** Fica separado porque a sidebar o renderiza no rodapé da lista. */
export const secondaryNavigation: NavItem[] = [
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];

export const allNavigation: NavItem[] = [...primaryNavigation, ...secondaryNavigation];
