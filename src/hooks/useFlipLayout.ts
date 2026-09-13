import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isMotionDisabled } from "../utils/motion";
import { relativeLayoutRect, type LayoutRect } from "../utils/flipLayout";

// Tokens do sistema de movimento (motion design):
// Duração base calibrada para reorganização de grid (220ms) e curva ease-out com
// desaceleração suave (cubic-bezier(0.16, 1, 0.3, 1)).
const FLIP_DURATION_MS = 220;
const FLIP_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

export function useFlipLayout<T extends HTMLElement>(
  layoutKey: string,
  enabled = true,
): RefObject<T> {
  const containerRef = useRef<T>(null);
  const previousRectsRef = useRef(new Map<string, LayoutRect>());
  const animationsRef = useRef(new Map<string, Animation>());
  const lastContainerWidthRef = useRef<number>(0);

  const performFlip = (isResize = false) => {
    const container = containerRef.current;
    if (!container) return;

    if (!enabled || isMotionDisabled()) {
      previousRectsRef.current = new Map();
      for (const animation of animationsRef.current.values()) {
        animation.cancel();
      }
      animationsRef.current.clear();
      return;
    }

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-layout-id]"),
    );
    if (elements.length === 0) {
      previousRectsRef.current = new Map();
      return;
    }

    // Se houver animações em andamento, capturamos a posição visual ao vivo (incluindo o transform atual)
    // para garantir que qualquer nova interpolação parta exatamente de onde o card está visualmente.
    const containerRect = container.getBoundingClientRect();
    const currentVisualRects = new Map<string, LayoutRect>();
    for (const element of elements) {
      const id = element.dataset.layoutId;
      if (id) {
        currentVisualRects.set(id, relativeLayoutRect(element.getBoundingClientRect(), containerRect));
      }
    }

    // Cancela as animações ativas para que possamos medir a posição natural de destino de cada card.
    const wasAnimating = new Set<string>();
    for (const [id, animation] of animationsRef.current) {
      wasAnimating.add(id);
      animation.cancel();
    }
    animationsRef.current.clear();

    const nextRects = new Map<string, LayoutRect>();
    for (const element of elements) {
      const id = element.dataset.layoutId;
      if (id) {
        nextRects.set(id, relativeLayoutRect(element.getBoundingClientRect(), containerRect));
      }
    }

    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : 1080;
    const hasPrevious = previousRectsRef.current.size > 0;
    const isAppend = hasPrevious && elements.length > previousRectsRef.current.size &&
      [...previousRectsRef.current.keys()].every(
        (id, index) => elements[index]?.dataset.layoutId === id,
      );

    if (hasPrevious) {
      for (const element of elements) {
        const id = element.dataset.layoutId;
        if (!id) continue;

        const nextRect = nextRects.get(id);
        if (!nextRect || nextRect.width === 0 || nextRect.height === 0) continue;

        // Otimização de performance: anima apenas cards que estão dentro ou próximos
        // do scrollport visível (-250px a +250px), evitando reflows/GPU thrashing com listas longas.
        const viewportTop = nextRect.top + containerRect.top;
        const isNearViewport =
          viewportTop + nextRect.height >= -250 && viewportTop <= viewportHeight + 250;

        const previousRect = wasAnimating.has(id)
          ? currentVisualRects.get(id)
          : previousRectsRef.current.get(id);

        if (!previousRect) {
          // Paginação por scroll revela skeletons estáveis, sem animação de entrada.
          if (!isResize && !isAppend && isNearViewport) {
            element.style.willChange = "transform, opacity";
            const animation = element.animate(
              [
                { transform: "scale(0.96)", opacity: 0 },
                { transform: "scale(1)", opacity: 1 },
              ],
              { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: "none" },
            );
            animationsRef.current.set(id, animation);
            const cleanup = () => {
              element.style.willChange = "";
              if (animationsRef.current.get(id) === animation) {
                animationsRef.current.delete(id);
              }
            };
            animation.addEventListener("finish", cleanup, { once: true });
            animation.addEventListener("cancel", cleanup, { once: true });
          }
          continue;
        }

        if (previousRect.width === 0 || previousRect.height === 0) continue;

        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;

        // Se o card não mudou de posição no grid, pula a animação
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

        if (!isNearViewport) continue;

        element.style.willChange = "transform";
        const animation = element.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: "none" },
        );
        animationsRef.current.set(id, animation);

        const cleanup = () => {
          element.style.willChange = "";
          if (animationsRef.current.get(id) === animation) {
            animationsRef.current.delete(id);
          }
        };
        animation.addEventListener("finish", cleanup, { once: true });
        animation.addEventListener("cancel", cleanup, { once: true });
      }
    }

    previousRectsRef.current = nextRects;
  };

  // Reorganização em resposta a mudanças de dados / filtros / ordenação
  useLayoutEffect(() => {
    performFlip(false);
  }, [enabled, layoutKey]);

  // Reorganização em resposta a redimensionamento do container (janela, maximizar, snap, sidebar)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let resizeRafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width === 0) continue;

        if (lastContainerWidthRef.current === 0) {
          lastContainerWidthRef.current = width;
          performFlip(true);
          return;
        }

        // Se a largura não mudou (apenas altura mudou), não reorganiza as colunas do grid
        if (Math.abs(width - lastContainerWidthRef.current) < 1) return;

        lastContainerWidthRef.current = width;

        if (resizeRafId !== null) {
          cancelAnimationFrame(resizeRafId);
        }

        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          performFlip(true);
        });
      }
    });

    observer.observe(container);

    return () => {
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
      }
      observer.disconnect();
    };
  }, [enabled]);

  useLayoutEffect(
    () => () => {
      for (const animation of animationsRef.current.values()) animation.cancel();
      animationsRef.current.clear();
    },
    [],
  );

  return containerRef;
}
