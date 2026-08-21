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
    expect(selectors).toContain(".catalogue-hover-preview__control");
    expect(selectors).toContain(".catalogue-hover-preview--visible");
    expect(selectors).toContain(".catalogue-hover-preview--hidden");
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
    expect(screenshotRule?.toString()).toContain("transition:");

    const controlRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".catalogue-hover-preview__control"
    );
    expect(controlRule?.toString()).toContain(
      "background-color: color-mix(in srgb, var(--black) 40%, transparent)"
    );
    expect(controlRule?.toString()).toContain("color: var(--text-primary)");
    expect(controlRule?.toString()).not.toContain("pointer-events: none");
    expect(controlRule?.toString()).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("keeps preview copy localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");
    const component = readFileSync("src/components/ui/CatalogueHoverPreview.tsx", "utf8");

    expect(source).toContain("preview: {");
    expect(source).toContain('developer: "Desenvolvedora"');
    expect(source).toContain('developer: "Developer"');
    expect(source).toContain('previousScreenshot: "Screenshot anterior"');
    expect(source).toContain('nextScreenshot: "Próxima screenshot"');
    expect(source).toContain('previousScreenshot: "Previous screenshot"');
    expect(source).toContain('nextScreenshot: "Next screenshot"');
    const previewBlocks = [...source.matchAll(/preview:\s*{([\s\S]*?)\n\s*},/g)];
    expect(previewBlocks).toHaveLength(2);
    expect(previewBlocks.every(([, block]) => !block.includes("publisher:"))).toBe(true);
    expect(component).toContain("3200");
    expect(component).not.toContain("catalogue.preview.publisher");
  });

  it("caps the achievement row at six icons", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("const ACHIEVEMENT_PREVIEW_COUNT = 6");
    // Cortado pela constante, não por um literal solto que sai de sincronia.
    expect(component).toMatch(
      /achievementList\.slice\(\s*0,\s*ACHIEVEMENT_PREVIEW_COUNT\s*\)/
    );
    expect(component).not.toMatch(/achievementList\.slice\(\s*0,\s*\d/);
  });

  it("reveals the achievement icons as one group", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );
    const css = compile("src/app.scss").css;

    // Escopado ao bloco de conquistas: as screenshots 2 e 3 seguem em `lazy` de
    // propósito, então uma busca no arquivo inteiro acusaria falso positivo.
    const achievementsBlock = component.slice(
      component.indexOf("__achievements-row"),
      component.lastIndexOf("__achievements-icon")
    );

    // Pré-carregados e decodificados antes de aparecer: sem `lazy`, que traria
    // de volta a pintura peça a peça.
    expect(component).toContain("preloadBrowserImage");
    expect(achievementsBlock).not.toContain("loading=");
    expect(component).toContain("achievementIconsReady");
    expect(css).toContain(".catalogue-hover-preview__achievements-row--ready");
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
