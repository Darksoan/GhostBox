import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesces high-frequency callbacks (e.g. scroll handlers) to at most one
 * invocation per animation frame, so we never run setState more than once per
 * painted frame during a scroll gesture.
 */
export function useRafThrottle(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      callbackRef.current();
    });
  }, []);
}
