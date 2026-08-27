import { useEffect } from "react";

const REVEAL_SELECTOR = ".reveal";
const VISIBLE_CLASS = "is-visible";

/**
 * Um único IntersectionObserver para toda a página. Cada elemento `.reveal`
 * ganha `is-visible` uma vez e sai do observer — reveal é entrada, não estado.
 * Sob prefers-reduced-motion o CSS já nasce visível e nada disto roda.
 */
export function useReveal(enabled = true, resetKey?: unknown): void {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(VISIBLE_CLASS);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );

    for (const node of document.querySelectorAll(REVEAL_SELECTOR)) {
      observer.observe(node);
    }

    return () => observer.disconnect();
    // resetKey entra na lista de propósito: trocar de idioma remonta a página e
    // os elementos `.reveal` antigos deixam de existir.
  }, [enabled, resetKey]);
}

/** Atraso de cascata de um item. Teto de 400ms para o grupo inteiro (< 500ms). */
export function staggerDelay(index: number, step = 70, max = 400): React.CSSProperties {
  return { "--reveal-delay": `${Math.min(index * step, max)}ms` } as React.CSSProperties;
}
