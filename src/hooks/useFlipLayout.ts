import { useLayoutEffect, useRef, type RefObject } from "react";

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

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-layout-id]"),
    );
    const nextRects = new Map<string, DOMRect>();

    for (const element of elements) {
      const id = element.dataset.layoutId;
      if (id) nextRects.set(id, element.getBoundingClientRect());
    }

    if (enabled && !motionIsDisabled() && previousRectsRef.current.size > 0) {
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

  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
  }, []);

  return containerRef;
}
