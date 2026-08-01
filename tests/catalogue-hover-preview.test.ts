import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Catalogue hover preview", () => {
  it("emits the preview selectors and reduced-motion rule", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    const mediaQueries: string[] = [];

    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));
    stylesheet.walkAtRules("media", (rule) => mediaQueries.push(rule.params));

    expect(selectors).toContain(".catalogue-hover-preview");
    expect(selectors).toContain(".catalogue-hover-preview__screenshots");
    expect(selectors).toContain(".catalogue-hover-preview__screenshot");
    expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");

    const previewRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".catalogue-hover-preview"
    );
    expect(previewRule?.toString()).not.toContain("border:");

    const titleRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".catalogue-hover-preview__title"
    );
    expect(titleRule?.toString()).toContain("font-weight: var(--weight-semibold)");

    const creditRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".catalogue-hover-preview__credit"
    );
    expect(creditRule?.toString()).toContain("font-weight: var(--weight-medium)");

    const screenshotRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-hover-preview__screenshot"
    );
    expect(screenshotRule?.toString()).not.toContain("transition:");
  });

  it("keeps preview copy localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");
    const component = readFileSync("src/components/ui/CatalogueHoverPreview.tsx", "utf8");

    expect(source).toContain("preview: {");
    expect(source).toContain('developer: "Desenvolvedora"');
    expect(source).toContain('developer: "Developer"');
    const previewBlocks = [...source.matchAll(/preview:\s*{([\s\S]*?)\n\s*},/g)];
    expect(previewBlocks).toHaveLength(2);
    expect(previewBlocks.every(([, block]) => !block.includes("publisher:"))).toBe(true);
    expect(component).toContain("1500");
    expect(component).not.toContain("catalogue.preview.publisher");
  });
});
