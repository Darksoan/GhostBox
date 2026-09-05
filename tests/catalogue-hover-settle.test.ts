import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("catalogue preview hover loading", () => {
  it("starts the preview load in the pointerenter without an intent delay", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const utils = readFileSync("src/utils/cataloguePreview.ts", "utf8");

    expect(page).toContain("preloadCataloguePreviewAssets([game], { idle: false, limit: 1 })");
    expect(page).toContain("commitHoveredPreview(game)");
    expect(page).not.toContain("createCatalogueHoverPreviewIntent");
    expect(utils).not.toContain("CATALOGUE_HOVER_PREVIEW_INTENT_DELAY_MS");
    expect(utils).not.toContain("CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS");
  });

  it("prefetches only the first three visible games while idle", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("preloadCataloguePreviewAssets(visibleGames");
    expect(page).toContain("limit: 3");
    expect(page).toContain("idle: true");
    expect(page).toContain("cancelPreviewPreload()");
  });

  it("commits the last card entered while scrolling when scrolling settles", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("deferredHoverGameRef.current = game");
    expect(page).toContain("const deferredGame = deferredHoverGameRef.current");
    expect(page).toContain("commitHoveredPreview(deferredGame)");
    expect(page).toContain("deferredHoverGameRef.current = null");
  });
});
