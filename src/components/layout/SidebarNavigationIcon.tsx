import type { ElementType } from "react";

interface SidebarNavigationIconProps {
  // Lucide e reicon têm props de peso incompatíveis entre si; o componente
  // só repassa size/stroke/weight, então aceita qualquer assinatura.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ElementType<any>;
}

// Traço de 1.8 compartilhado com os demais ícones do app.
// `weight="Outline"` mantém os ícones reicon (Grid/Cup) no traço vazado,
// em vez do sólido Filled padrão do patch.
export function SidebarNavigationIcon({ icon: Icon }: SidebarNavigationIconProps) {
  return (
    <Icon
      size={20}
      strokeWidth={1.8}
      weight="Outline"
      className="sidebar__navigation-icon"
      aria-hidden="true"
    />
  );
}
