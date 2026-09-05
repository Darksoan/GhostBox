import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Catalogue fallback preview", () => {
  const component = readFileSync("src/pages/CataloguePage.tsx", "utf8");

  it("keeps the last confirmed hover when no card is hovered", () => {
    expect(component).toContain("fallbackPreviewGame");
    expect(component).toContain("lastPreviewGameRef");
    expect(component).toContain("hoveredPreview ?? lastPreviewGameRef.current ?? fallbackPreviewGame");
    expect(component).toContain("commitHoveredPreview");
  });

  it("uses a deterministic fallback instead of reshuffling per render", () => {
    expect(component).toContain("const fallbackPreviewGame = visibleGames[0] ?? null");
    expect(component).not.toContain("Math.random()");
  });
});
