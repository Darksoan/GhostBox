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

    // Shots trocam sem fade: não há classe de swapping nem transição nas shots.
    expect(selectors).not.toContain(
      ".catalogue-hover-preview--swapping .catalogue-hover-preview__media-stack"
    );
    expect(
      selectors.filter((selector) =>
        selector.includes("catalogue-hover-preview--swapping")
      )
    ).toEqual([]);

    // O painel ainda entra com fade; as shots não.
    const mediaStackRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-hover-preview__media-stack"
    );
    expect(mediaStackRule?.toString() ?? "").not.toContain("transition:");
    expect(mediaStackRule?.toString() ?? "").not.toContain("opacity");

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
      "font-weight: var(--weight-regular)"
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

  it("holds the panel until all screenshots decoded and shows skeleton", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("isMediaReady");
    expect(component).toContain("isShotsReady");
    expect(component).toContain("readyScreenshotCount >= displayShots.length");
    expect(component).toContain("slice(0, 3)");
    expect(component).toContain("catalogue-hover-preview__shot--skeleton");
    expect(component).toContain("skeleton");
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

  it("swaps the content without fading and without flashing the placeholder", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );
    const utils = readFileSync("src/utils/cataloguePreview.ts", "utf8");
    const stylesheet = postcss.parse(compile("src/app.scss").css);

    // Shots trocam sem fade: sem estado de swapping
    expect(component).not.toContain("catalogue-hover-preview--swapping");
    expect(component).not.toContain("CATALOGUE_PREVIEW_SWAP_TRANSITION_MS");
    expect(component).not.toContain("isContentSwapping");
    expect(component).not.toContain("isMotionDisabled()");
    expect(component).toContain("setDisplayedGame(game)");

    // Hold + stale: não pisca skeleton a cada troca
    expect(component).toContain("pendingGame");
    expect(component).toContain("pendingDisplayShots");
    expect(component).toContain("prevDisplayShotsRef");
    expect(component).toContain("showStale");
    expect(component).toContain("catalogue-hover-preview__shot--stale");
    expect(component).toContain("CATALOGUE_PREVIEW_PENDING_HOLD_MS");
    expect(component).toContain("loadedImageSources");
    expect(component).toContain("pendingHoldTimeoutRef");

    // Painel mantém transição de saída; shots não têm animação.
    expect(utils).toContain("CATALOGUE_PREVIEW_EXIT_TRANSITION_MS = 180");
    expect(utils).toContain("CATALOGUE_PREVIEW_PENDING_HOLD_MS = 250");
    const shotLinkRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        (node.selector === ".catalogue-hover-preview__shot--link" ||
          node.selector === ".catalogue-hover-preview__shot--link, .catalogue-hover-preview__shot--empty")
    );
    // Se a regra foi removida, não há animação; se ainda existir, não contém fade.
    if (shotLinkRule) {
      expect(shotLinkRule.toString()).not.toContain("animation:");
      expect(shotLinkRule.toString()).not.toContain("image-subtle-fade-in");
    }
    expect(compile("src/app.scss").css).not.toContain(
      "catalogue-hover-preview--swapping"
    );
  });
});
