export type LayoutRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Container-relative coordinates exclude scrolling from layout movement. */
export function relativeLayoutRect(
  rect: LayoutRect,
  container: Pick<LayoutRect, "left" | "top">,
): LayoutRect {
  return {
    left: rect.left - container.left,
    top: rect.top - container.top,
    width: rect.width,
    height: rect.height,
  };
}
