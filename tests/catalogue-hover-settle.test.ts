import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("catalogue preview hover loading", () => {
  it("starts the preview load in the pointerenter without an intent delay", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const utils = readFileSync("src/utils/cataloguePreview.ts", "utf8");

    expect(page).not.toContain("preloadCataloguePreviewAssets([game]");
    expect(page).toContain("commitHoveredPreview(game)");
    expect(page).not.toContain("createCatalogueHoverPreviewIntent");
    expect(utils).not.toContain("CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS");
    expect(utils).not.toContain("CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS");
  });

  it("lets the visible preview load without duplicate background prefetches", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).not.toContain("preloadCataloguePreviewAssets");
    expect(page).toContain("<CatalogueHoverPreview");
  });

  it("commits the last card entered while scrolling when scrolling settles", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("deferredHoverGameRef.current = game");
    expect(page).toContain("const deferredGame = deferredHoverGameRef.current");
    expect(page).toContain("commitHoveredPreview(deferredGame)");
    expect(page).toContain("deferredHoverGameRef.current = null");
  });
});
