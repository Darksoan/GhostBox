import { Gear, Grid, Home6, Library } from "reicon-react";
import type { Page } from "../../types";

type NavIcon = typeof Grid;

type NavItem = {
  id: Page;
  icon: NavIcon;
  labelKey: string;
};

/** Páginas principais, na ordem em que aparecem na sidebar e no card flutuante. */
export const primaryNavigation: NavItem[] = [
  { id: "home", labelKey: "nav.home", icon: Home6 },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Library },
];

/** Fica separado porque a sidebar o renderiza no rodapé da lista. */
export const secondaryNavigation: NavItem[] = [
  { id: "settings", labelKey: "nav.settings", icon: Gear },
];
