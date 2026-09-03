import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS,
  CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS,
  createCatalogueHoverPreviewIntent,
} from "../src/utils/cataloguePreview";

describe("catalogue hover settle delay", () => {
  it("waits longer for hovers the content caused, and commits once", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(show);

    // Três cartões deslizam sob o cursor parado enquanto a aba entra.
    intent.scheduleShow("terraria", CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS);
    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS);
    intent.scheduleShow("portal-2", CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS);
    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS);
    intent.scheduleShow("hades", CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS);

    expect(show).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith("hades");

    intent.dispose();
    vi.useRealTimers();
  });

  it("keeps the short delay for hovers the user drove", () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(show);

    intent.scheduleShow("terraria");
    vi.advanceTimersByTime(CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS);

    expect(show).toHaveBeenCalledWith("terraria");

    intent.dispose();
    vi.useRealTimers();
  });

  it("settles slower than the intent delay", () => {
    expect(CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS).toBeGreaterThan(
      CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS
    );
  });

  it("marks hovers as unsettled when the cursor did not move", () => {
    const list = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(list).toContain("const movedByLayout = previous?.x === x && previous?.y === y");
    expect(list).toContain("settled: !movedByLayout");
    expect(list).toContain("onPointerMove");
  });

  it("routes unsettled hovers through the long delay", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS");
    expect(page).toContain("options?.settled === false");
  });
});
