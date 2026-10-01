import { describe, expect, it } from "vitest";
import { getBannerPanRange, panBannerPosition, zoomBannerPosition } from "../src/utils/profileBanner";

describe("Profile banner panning", () => {
  it("allows horizontal travel after zooming a width-fitted cover", () => {
    const unzoomed = getBannerPanRange(3840, 2160, 1600, 440, 1);
    expect(unzoomed.x).toBe(0);
    const zoomed = getBannerPanRange(3840, 2160, 1600, 440, 1.5);
    expect(zoomed.x).toBeCloseTo(800);
    expect(zoomed.y).toBeCloseTo(910);
    const moved = panBannerPosition({ x: 50, y: 50 }, { x: 100, y: 0 }, zoomed);
    expect(moved.x).toBeLessThan(50);
    expect(moved.y).toBe(50);
    expect(((50 - moved.x) / 100) * zoomed.x).toBeCloseTo(115);
  });

  it.each([
    [3840, 2160],
    [4000, 600],
    [1000, 2000],
  ])("tracks pointer motion equally in both axes for a %dx%d image", (width, height) => {
    const range = getBannerPanRange(width, height, 1200, 440, 2);
    const moved = panBannerPosition({ x: 50, y: 50 }, { x: 20, y: -20 }, range);
    expect(((50 - moved.x) / 100) * range.x).toBeCloseTo(23);
    expect(((50 - moved.y) / 100) * range.y).toBeCloseTo(-23);
  });

  it("clamps at image edges and preserves an axis with no overflow", () => {
    const range = getBannerPanRange(1600, 900, 1600, 440, 1);
    expect(panBannerPosition({ x: 50, y: 50 }, { x: 10000, y: 10000 }, range))
      .toEqual({ x: 50, y: 0 });
    expect(panBannerPosition({ x: 50, y: 50 }, { x: -10000, y: -10000 }, range))
      .toEqual({ x: 50, y: 100 });
  });

  it("preserves sub-percent motion rather than dropping small pointer moves", () => {
    const moved = panBannerPosition({ x: 50, y: 50 }, { x: 1, y: 1 }, { x: 5000, y: 5000 });
    expect(moved.x).toBeLessThan(50);
    expect(moved.x).toBeGreaterThan(49.9);
  });

  it("does not move an image whose dimensions are not loaded", () => {
    const range = getBannerPanRange(0, 0, 1200, 440, 2);
    expect(panBannerPosition({ x: 50, y: 50 }, { x: 100, y: 100 }, range))
      .toEqual({ x: 50, y: 50 });
  });
});

describe("Cursor-anchored banner zoom", () => {
  it.each([
    [3840, 2160, 1],
    [4000, 600, 1],
    [1000, 2000, 1],
    [3840, 2160, 1.5],
    [4000, 600, 1.5],
    [1000, 2000, 1.5],
  ])("keeps the image point beneath the cursor for %dx%d at zoom %s", (width, height, scale) => {
    const viewport = { width: 1200, height: 440 };
    const cursor = { x: 220, y: 310 };
    const position = { x: 31, y: 62, scale };
    const before = getBannerPanRange(width, height, viewport.width, viewport.height, scale);
    const zoomed = zoomBannerPosition(position, cursor, viewport, before, scale + 0.08);
    const after = getBannerPanRange(width, height, viewport.width, viewport.height, zoomed.scale);
    // Compare the source-image point, not the CSS percentages: object-fit and
    // the available travel change with zoom, but the point must remain fixed.
    expect((cursor.x + before.x * position.x / 100) / (viewport.width + before.x))
      .toBeCloseTo((cursor.x + after.x * zoomed.x / 100) / (viewport.width + after.x), 10);
    expect((cursor.y + before.y * position.y / 100) / (viewport.height + before.y))
      .toBeCloseTo((cursor.y + after.y * zoomed.y / 100) / (viewport.height + after.y), 10);
  });

  it("restores the framing when zooming in and back out at the same cursor point", () => {
    const viewport = { width: 1200, height: 440 };
    const cursor = { x: 350, y: 180 };
    const position = { x: 40, y: 55, scale: 1.5 };
    const zoomed = zoomBannerPosition(position, cursor, viewport,
      getBannerPanRange(3840, 2160, 1200, 440, 1.5), 1.58);
    const restored = zoomBannerPosition(zoomed, cursor, viewport,
      getBannerPanRange(3840, 2160, 1200, 440, 1.58), 1.5);
    expect(restored.x).toBeCloseTo(position.x, 10);
    expect(restored.y).toBeCloseTo(position.y, 10);
  });

  it("clamps zoom-out near an edge so the banner does not reveal empty space", () => {
    const zoomed = zoomBannerPosition({ x: 0, y: 100, scale: 2 },
      { x: 1200, y: 0 }, { width: 1200, height: 440 },
      getBannerPanRange(3840, 2160, 1200, 440, 2), 1.1);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBe(100);
  });
});
