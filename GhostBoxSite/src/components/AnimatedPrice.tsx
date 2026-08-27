import { useEffect, useRef, useState } from "react";

const PRICE_PATTERN = /^(\D*)([\d.,]+)(\D*)$/;

/** Quebra "R$ 6,99" em prefixo, número e separador decimal usado. */
function parsePrice(label: string) {
  const match = PRICE_PATTERN.exec(label.trim());
  if (!match) return null;
  const [, prefix, digits, suffix] = match;
  const separator = digits.includes(",") ? "," : ".";
  const value = Number(digits.replace(/\./g, separator === "." ? "." : "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const decimals = digits.split(separator)[1]?.length ?? 0;
  return { prefix, suffix, separator, value, decimals };
}

/**
 * Contagem de entrada do preço. Só roda uma vez, quando o cartão entra na tela,
 * e só se o usuário não pediu redução de movimento. O rótulo final é sempre o
 * que veio de `planPriceLabel` — a animação nunca inventa formato.
 */
export function AnimatedPrice({ label, duration = 700 }: { label: string; duration?: number }) {
  const parsed = parsePrice(label);
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(label);

  useEffect(() => {
    setDisplay(label);
    const node = ref.current;
    if (!node || !parsed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let start = 0;

    const tick = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      // ease-out cúbico: chega rápido e assenta, igual ao resto do site.
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (parsed.value * eased).toFixed(parsed.decimals);
      setDisplay(
        `${parsed.prefix}${current.replace(".", parsed.separator)}${parsed.suffix}`,
      );
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        frame = window.requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, duration]);

  return (
    <span ref={ref}>
      {/* O valor final fica sempre disponível para leitores de tela; a contagem
          é puramente visual. */}
      <span aria-hidden="true">{display}</span>
      <span className="site-visually-hidden">{label}</span>
    </span>
  );
}
