import { useEffect, useRef } from "react";

/**
 * Parallax de baixo custo: escreve --site-parallax no elemento a cada frame de
 * scroll, limitado a `range` px. Só transform/opacity leem esse token, então o
 * navegador não precisa reflowar. Morre sob prefers-reduced-motion.
 */
export function useParallax<T extends HTMLElement>(range = 48) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      // -1 (abaixo da dobra) → 1 (acima da dobra)
      const progress = (viewport / 2 - (rect.top + rect.height / 2)) / viewport;
      const offset = Math.max(-1, Math.min(1, progress)) * range;
      node.style.setProperty("--site-parallax", `${offset.toFixed(2)}px`);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      node.style.removeProperty("--site-parallax");
    };
  }, [range]);

  return ref;
}
