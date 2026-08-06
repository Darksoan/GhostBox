import { compile } from "sass-embedded";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Catalogue filter search layout", () => {
  it("keeps the filter searchbar at the #202020 token on hover", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let defaultBackground: string | undefined;
    const interactiveBackgrounds: string[] = [];

    stylesheet.walkRules((rule) => {
      if (rule.selector === ".catalogue-filter-section__search") {
        rule.walkDecls("background", (declaration) => {
          defaultBackground = declaration.value;
        });
      }

      if (rule.selectors?.includes(".catalogue-filter-section__search:hover")) {
        rule.walkDecls("background", (declaration) => {
          interactiveBackgrounds.push(declaration.value);
        });
      }
    });

    expect(defaultBackground).toBe("var(--surface-option-hover)");
    expect(interactiveBackgrounds).toEqual(["var(--surface-option-hover)"]);
  });

  it("does not render a client-side recommendation section", () => {
    const source = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    expect(source).not.toContain("useCatalogueRecommendations");
    expect(source).not.toContain('className="catalogue-recommended"');
  });
});

describe("Skeleton primitive", () => {
  const css = compile("src/app.scss").css;

  it("collapses the three dead loading variants into one flat .skeleton", () => {
    const stylesheet = postcss.parse(css);
    let skeletonFill: string | undefined;

    stylesheet.walkRules(".skeleton", (rule) => {
      rule.walkDecls("background", (declaration) => {
        skeletonFill = declaration.value;
      });
    });

    expect(skeletonFill).toBe("var(--skeleton-fill)");
    expect(css).not.toContain("loading-wave");
    expect(css).not.toContain("loading-plate");
    expect(css).not.toContain("loading-pulse-skeleton");
    expect(css).not.toContain("@keyframes pulse-skeleton");
  });

  it("drops the placeholder classes with no TSX consumer", () => {
    for (const selector of [
      ".catalogue-list__placeholder-cover",
      ".catalogue-list__placeholder-content",
      ".catalogue-list__placeholder-genres",
      ".catalogue-list__placeholder-title",
      ".catalogue-list__placeholder-chip",
      ".catalogue-list__placeholder-action-slot",
      ".catalogue-page__result-count-placeholder",
      ".catalogue-filters__eyebrow-placeholder",
      ".catalogue-filters__title-placeholder",
      ".catalogue-filter-section__chevron-placeholder",
      ".catalogue-filter-section__header-title-placeholder",
      ".catalogue-filter-section__header-count-placeholder",
    ]) {
      expect(css).not.toContain(selector);
    }
  });

  it("keeps the catalogue skeleton down to the two masses of the real row", () => {
    const source = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");
    const listState = source.slice(
      source.indexOf("export function CatalogueListLoadingState"),
      source.indexOf("export function CatalogueFilterSectionsLoadingState")
    );

    expect(listState).toContain("catalogue-list--skeleton");
    expect(listState).toContain("catalogue-list__cover--skeleton skeleton");
    expect(listState).not.toContain("catalogue-list__content");
    expect(listState).not.toContain("catalogue-list__genres");
    expect(listState).not.toContain("catalogue-list__actions");
  });

  it("has no pulse/animate prop chain left in the catalogue loading path", () => {
    for (const file of [
      "src/components/ui/LoadingStates.tsx",
      "src/pages/CataloguePage.tsx",
      "src/components/routing/PageRouter.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("pulseLoading");
      expect(source).not.toContain("animateListText");
      expect(source).not.toContain("animateFilterPlaceholders");
    }
  });
});
