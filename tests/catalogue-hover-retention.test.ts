import { describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_HOVER_PREVIEW_RETENTION_MS,
  createCatalogueHoverPreviewRetention,
} from "../src/utils/cataloguePreview";

describe("catalogue hover preview retention", () => {
  it("holds the preview for the retention window before clearing", () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    const retention = createCatalogueHoverPreviewRetention(clear);

    retention.scheduleClear();
    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_RETENTION_MS - 1);
    expect(clear).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(clear).toHaveBeenCalledOnce();
    retention.dispose();
    vi.useRealTimers();
  });

  it("cancels a pending clear when the preview receives a new hover", () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    const retention = createCatalogueHoverPreviewRetention(clear);

    retention.scheduleClear();
    retention.cancelClear();
    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_RETENTION_MS);

    expect(clear).not.toHaveBeenCalled();
    retention.dispose();
    vi.useRealTimers();
  });
});
