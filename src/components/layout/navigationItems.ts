import { Home, Layers, Settings, type LucideIcon } from "lucide-react";
import { Grid } from "reicon-react";
import type { Page } from "../../types";

type NavIcon = LucideIcon | typeof Grid;

type NavItem = {
  id: Page;
  icon: NavIcon;
  labelKey: string;
};

/** Páginas principais, na ordem em que aparecem na sidebar e no card flutuante. */
// Mixa Lucide e Reicon de propósito: o Catálogo (Grid) é Reicon e fica como
// está. Os demais seguem o Lucide dos commits anteriores. A diferença de
// estilo existe — o Reicon desenha preenchido e o Lucide contornado —, mas
// o peso na sidebar é dado pelo `non-scaling-stroke` em _icons.scss, não pelo
// tipo de preenchimento.
export const primaryNavigation: NavItem[] = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "catalogue", labelKey: "nav.catalogue", icon: Grid },
  { id: "library", labelKey: "nav.library", icon: Layers },
];

/** Fica separado porque a sidebar o renderiza no rodapé da lista. */
export const secondaryNavigation: NavItem[] = [
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];
