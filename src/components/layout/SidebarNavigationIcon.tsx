import type { ElementType } from "react";

interface SidebarNavigationIconProps {
  // Lucide e reicon têm props de peso incompatíveis entre si; o componente
  // só repassa size/stroke/weight, então aceita qualquer assinatura.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ElementType<any>;
}

// Traço efetivo igual ao Heart das coleções (size 16, stroke 2 → ~1.33px):
// size 20 com stroke 1.6 rende o mesmo peso visual na caixa padrão de 20px.
// `weight="Outline"` mantém os ícones reicon (Grid/Cup) no traço vazado,
// em vez do sólido Filled padrão do patch.
export function SidebarNavigationIcon({ icon: Icon }: SidebarNavigationIconProps) {
  return (
    <Icon
      size={20}
      strokeWidth={1.6}
      weight="Outline"
      className="sidebar__navigation-icon"
      aria-hidden="true"
    />
  );
}
