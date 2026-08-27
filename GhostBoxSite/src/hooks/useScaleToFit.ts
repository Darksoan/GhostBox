import { useEffect, useRef } from "react";

/**
 * Mede a largura do elemento e escreve `--lm-scale` com a razão para a largura
 * de projeto. É JS porque CSS não divide comprimento por comprimento: sem isso
 * a janela de 1280px não teria como saber que precisa caber em 560px.
 */
export function useScaleToFit<T extends HTMLElement>(
  designWidth: number,
  designHeight: number,
  /**
   * Piso da redução. Numa coluna de celular a razão real seria ~0.28 e a
   * interface viraria um selo ilegível — abaixo do piso a janela passa a ser
   * cortada na borda em vez de encolher mais.
   */
  minScale = 0.42,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const apply = (width: number) => {
      if (!width) return;
      const scale = Math.max(width / designWidth, minScale);
      node.style.setProperty("--lm-scale", String(scale));
      node.style.setProperty("--lm-height", `${designHeight * scale}px`);
    };

    apply(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [designWidth, designHeight, minScale]);

  return ref;
}
