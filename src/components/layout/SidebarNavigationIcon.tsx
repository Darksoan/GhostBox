import type { ElementType } from "react";

interface SidebarNavigationIconProps {
  // Lucide e reicon têm props de peso incompatíveis entre si; o componente
  // só repassa size/stroke/weight, então aceita qualquer assinatura.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ElementType<any>;
}

// 24px é 1:1 com a grade 24 do Lucide/Reicon, então a escala é 1 e cada
// coordenada inteira cai num pixel inteiro — não há posição subpixel para
// compensar, por isso nenhum `translate` aqui.
// O `strokeWidth` abaixo é o valor que o CSS aplica de qualquer forma (regra
// de autor vence atributo de apresentação); ele fica explícito para o markup
// não divergir do pintado. Os ícones Reicon que chegam aqui (Grid, Cup) são
// preenchidos e ignoram o `strokeWidth` — é de propósito.
// `weight="Outline"` mantém o desenho Reicon vazado, em vez do sólido Filled.
export function SidebarNavigationIcon({ icon: Icon }: SidebarNavigationIconProps) {
  return (
    <Icon
      size={24}
      strokeWidth={1.5}
      weight="Outline"
      className="sidebar__navigation-icon"
      aria-hidden="true"
    />
  );
}
