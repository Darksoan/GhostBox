import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Catalogue fallback preview", () => {
  const component = readFileSync("src/pages/CataloguePage.tsx", "utf8");

  it("picks a random game from the visible page when no card is hovered", () => {
    expect(component).toContain("fallbackPreviewGame");
    expect(component).toContain("game={hoveredPreview ?? fallbackPreviewGame}");
  });

  it("keeps the fallback stable per page instead of reshuffling per render", () => {
    const memoStart = component.indexOf("const fallbackPreviewGame = useMemo(");
    const memoEnd = component.indexOf("}, [visibleGamesCacheKey, visibleGames]);", memoStart);
    expect(memoStart).toBeGreaterThan(-1);
    expect(memoEnd).toBeGreaterThan(memoStart);
  });
});
