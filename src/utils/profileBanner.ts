type Point = { x: number; y: number };

/** Available travel after object-fit: cover and zoom, in viewport pixels. */
export function getBannerPanRange(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): Point {
  if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0 };
  }
  const fit = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return {
    x: Math.max(0, imageWidth * fit * zoom - viewportWidth),
    y: Math.max(0, imageHeight * fit * zoom - viewportHeight),
  };
}

/** Follow the pointer with a slight gain; clamp to the edges without empty space. */
export function panBannerPosition(origin: Point, delta: Point, range: Point): Point {
  const sensitivity = 1.15;
  const pan = (position: number, offset: number, travel: number) =>
    travel > 0
      ? Math.min(100, Math.max(0, position - (offset * sensitivity * 100) / travel))
      : position;
  return {
    x: pan(origin.x, delta.x, range.x),
    y: pan(origin.y, delta.y, range.y),
  };
}

/** Keep the same image point under the cursor while changing zoom. */
export function zoomBannerPosition(
  position: Point & { scale?: number },
  cursor: Point,
  viewport: { width: number; height: number },
  range: Point,
  scale: number,
) {
  const ratio = scale / (position.scale ?? 1);
  const anchor = (percent: number, pointer: number, size: number, travel: number) => {
    const nextTravel = (size + travel) * ratio - size;
    if (nextTravel <= 0) return percent;
    const offset = (pointer + (travel * percent) / 100) * ratio - pointer;
    return Math.min(100, Math.max(0, (offset / nextTravel) * 100));
  };
  return {
    x: anchor(position.x, cursor.x, viewport.width, range.x),
    y: anchor(position.y, cursor.y, viewport.height, range.y),
    scale,
  };
}
