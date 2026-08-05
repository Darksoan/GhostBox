import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
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

  it("emits hover-reveal chevron styles with a reduced-motion fallback", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    const mediaQueries: string[] = [];

    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));
    stylesheet.walkAtRules("media", (rule) => mediaQueries.push(rule.params));

    expect(selectors).toContain(".home-recommended__nav");
    expect(selectors).toContain(".home-recommended__nav--prev");
    expect(selectors).toContain(".home-recommended__nav--next");
    expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");
    expect(mediaQueries).toContain("(hover: hover) and (pointer: fine)");

    const navRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".home-recommended__nav"
    );
    expect(navRule?.toString()).toContain("opacity: 0");
    expect(navRule?.toString()).not.toContain("pointer-events: none");
    expect(navRule?.toString()).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
