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
    expect(selectors).toContain(".catalogue-hover-preview--visible");
    expect(selectors).toContain(".catalogue-hover-preview--hidden");
    expect(selectors).toContain(".catalogue-hover-preview__header");
    expect(selectors).toContain(".catalogue-hover-preview__media-stack");
    expect(selectors).toContain(".catalogue-hover-preview__shot");
    expect(selectors).toContain(".catalogue-hover-preview__shot-image");
    expect(mediaQueries).toContain("(prefers-reduced-motion: reduce)");

    const previewRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".catalogue-hover-preview"
    );
    expect(previewRule?.toString()).not.toContain("border:");
    // A entrada do painel continua animada (opacity + transform).
    expect(previewRule?.toString()).toContain("transition:");

    const titleRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".catalogue-hover-preview__title"
    );
    expect(titleRule?.toString()).toContain("font-weight: var(--weight-semibold)");

    const developerRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-hover-preview__developer"
    );
    expect(developerRule?.toString()).toContain(
      "font-weight: var(--weight-medium)"
    );
  });

  it("keeps preview copy localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");
    const component = readFileSync("src/components/ui/CatalogueHoverPreview.tsx", "utf8");

    // O rótulo da coluna vem do i18n; o título do painel usa ternário pt/en
    // inline porque interpola o nome do jogo.
    expect(source).toContain('columnLabel: "Preview do jogo"');
    expect(source).toContain('columnLabel: "Game preview"');
    expect(component).toContain("`Preview of ${displayedGame.title}`");
    expect(component).toContain("`Preview de ${displayedGame.title}`");
    expect(component).not.toContain("catalogue.preview.publisher");
  });

  it("holds the panel until its first screenshot decoded", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("MEDIA_REVEAL_TIMEOUT_MS");
    expect(component).toContain("isMediaReady");
    // A classe de visível depende das duas condições.
    expect(component).toContain("isVisible && isMediaReady");
  });

  it("keeps the panel mounted during exit and drives visibility via a class", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("CATALOGUE_PREVIEW_EXIT_TRANSITION_MS");
    expect(component).toContain("catalogue-hover-preview--visible");
    expect(component).toContain("catalogue-hover-preview--hidden");
    expect(component).toContain("displayedGame");
  });
});
