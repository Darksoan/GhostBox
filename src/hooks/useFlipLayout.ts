import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  isViewportResizing,
  startViewportResizeTracking,
  subscribeViewportResize,
} from "../utils/viewportResize";

const flipDurationMs = 180;
const flipEasing = "cubic-bezier(0.4, 0, 0.2, 1)";

function motionIsDisabled() {
  return document.documentElement.classList.contains("no-animations");
}

export function useFlipLayout<T extends HTMLElement>(
  layoutKey: string,
  enabled = true,
): RefObject<T> {
  const containerRef = useRef<T>(null);
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const animationsRef = useRef(new Map<string, Animation>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Quando a animação está desligada não há motivo para medir cada nó: o
    // `getBoundingClientRect` em todo card força um reflow do layout inteiro
    // e escala linear com a lista. Limpa o cache e sai antes de qualquer leitura.
    //
    // Durante o arrasto da janela vale o mesmo: as posições anteriores foram
    // medidas em outra largura, então o FLIP animaria os cards a partir de um
    // lugar onde eles nunca estiveram — é o "teleporte" que se vê ao redimensionar
    // e trocar de filtro em seguida.
    if (!enabled || motionIsDisabled() || isViewportResizing()) {
      previousRectsRef.current = new Map();
      return;
    }

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-layout-id]"),
    );
    const nextRects = new Map<string, DOMRect>();

    for (const element of elements) {
      const id = element.dataset.layoutId;
      if (id) nextRects.set(id, element.getBoundingClientRect());
    }

    if (previousRectsRef.current.size > 0) {
      for (const element of elements) {
        const id = element.dataset.layoutId;
        if (!id) continue;

        const previousRect = previousRectsRef.current.get(id);
        const nextRect = nextRects.get(id);
        if (!nextRect || nextRect.width === 0) {
          continue;
        }

        if (!previousRect) {
          animationsRef.current.get(id)?.cancel();
          const animation = element.animate(
            [
              { transform: "scale(0.985)", opacity: 0 },
              { transform: "scale(1)", opacity: 1 },
            ],
            { duration: flipDurationMs, easing: flipEasing },
          );
          animationsRef.current.set(id, animation);
          animation.addEventListener("finish", () => {
            if (animationsRef.current.get(id) === animation) {
              animationsRef.current.delete(id);
            }
          }, { once: true });
          continue;
        }

        if (previousRect.width === 0) continue;

        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

        animationsRef.current.get(id)?.cancel();
        const animation = element.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          { duration: flipDurationMs, easing: flipEasing },
        );
        animationsRef.current.set(id, animation);
        animation.addEventListener("finish", () => {
          if (animationsRef.current.get(id) === animation) {
            animationsRef.current.delete(id);
          }
        }, { once: true });
      }
    }

    previousRectsRef.current = nextRects;
  }, [enabled, layoutKey]);

  // Redimensionar reposiciona todo mundo sem passar por `layoutKey`. As medidas
  // guardadas viram lixo nesse instante: descarta e corta as animações em voo,
  // senão elas terminam mirando coordenadas de antes do resize.
  useEffect(() => {
    const release = startViewportResizeTracking();
    const unsubscribe = subscribeViewportResize((resizing) => {
      if (!resizing) return;
      previousRectsRef.current = new Map();
      for (const animation of animationsRef.current.values()) animation.cancel();
      animationsRef.current.clear();
    });

    return () => {
      unsubscribe();
      release();
    };
  }, []);

  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
  }, []);

  return containerRef;
}
