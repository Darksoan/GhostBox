import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home recommended banner chevrons", () => {
  it("keeps chevron labels localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");

    expect(source).toContain('recommendedPreviousGame: "Jogo anterior"');
    expect(source).toContain('recommendedNextGame: "Próximo jogo"');
    expect(source).toContain('recommendedPreviousGame: "Previous game"');
    expect(source).toContain('recommendedNextGame: "Next game"');
  });

  it("renders prev/next chevron buttons wired to the carousel", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");

    expect(component).toContain("ChevronLeft");
    expect(component).toContain("ChevronRight");
    expect(component).toContain("home-recommended__nav--prev");
    expect(component).toContain("home-recommended__nav--next");
    expect(component).toContain(
      "(index) => (index - 1 + visibleGames.length) % visibleGames.length"
    );
    expect(component).toContain(
      "setActiveIndex((index) => (index + 1) % visibleGames.length)"
    );
  });
});
