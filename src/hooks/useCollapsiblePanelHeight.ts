import { useEffect, useRef, useState } from "react";

export function useCollapsiblePanelHeight() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const nextHeight = panel.scrollHeight;
      setPanelHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    });

    return () => window.cancelAnimationFrame(frame);
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const updateHeight = () => {
      const nextHeight = panel.scrollHeight;
      setPanelHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateHeight)
        : null;
    resizeObserver?.observe(panel);

    return () => {
      window.removeEventListener("resize", updateHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  return [panelRef, panelHeight] as const;
}
