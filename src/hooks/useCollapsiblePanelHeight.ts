import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export function useCollapsiblePanelHeight() {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    setPanel(node);
  }, []);

  useLayoutEffect(() => {
    if (!panel) return;

    const nextHeight = panel.scrollHeight;
    setPanelHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight
    );
  }, [panel]);

  useEffect(() => {
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
    for (const child of panel.children) {
      resizeObserver?.observe(child);
    }

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(updateHeight)
        : null;
    mutationObserver?.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      window.removeEventListener("resize", updateHeight);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [panel]);

  return [panelRef, panelHeight] as const;
}
