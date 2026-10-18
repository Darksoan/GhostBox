import { compile } from "sass-embedded";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Catalogue filter search layout", () => {
  it("keeps filters and selectors on one row without clipping dropdown panels", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    for (const selector of [".catalogue-page__toolbar", ".catalogue-filterbar"]) {
      const values: Record<string, string> = {};
      stylesheet.walkRules((rule) => {
        if (!rule.selectors.includes(selector) || rule.parent.type !== "root") return;
        rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
      });
      expect(values["flex-wrap"]).toBe("nowrap");
      expect(values).not.toHaveProperty("overflow", "hidden");
      expect(values).not.toHaveProperty("overflow-x", "auto");
    }
  });
  it("keeps catalogue triggers tertiary at rest and secondary on interaction", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let baseColor: string | undefined;
    const catalogueOverrideColors: string[] = [];

    stylesheet.walkRules((rule) => {
      if (rule.selector === ".settings-dropdown__trigger") {
        rule.walkDecls("color", (declaration) => {
          baseColor = declaration.value;
        });
      }

      if (rule.selector.includes(".catalogue-page__sort")) {
        rule.walkDecls("color", (declaration) => {
          catalogueOverrideColors.push(declaration.value);
        });
      }
    });

    expect(baseColor).toBe("var(--text-secondary)");
    expect(catalogueOverrideColors).not.toContain("var(--text-primary)");
    expect(catalogueOverrideColors).toContain("var(--text-tertiary)");
    expect(catalogueOverrideColors).toContain("var(--text-secondary)");
  });

  it("keeps the filter searchbar flat on hover and focus without decorative border", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let defaultBackground: string | undefined;
    let panelBackground: string | undefined;
    const interactiveBackgrounds: string[] = [];
    const interactiveBorders: string[] = [];
    const interactiveOutlines: string[] = [];
    const interactiveShadows: string[] = [];

    stylesheet.walkRules((rule) => {
      if (rule.selector === ".catalogue-filter-section__search") {
        rule.walkDecls("background", (declaration) => {
          defaultBackground = declaration.value;
        });
      }

      if (rule.selector === ".catalogue-filter-section__content") {
        rule.walkDecls("background", (declaration) => {
          panelBackground = declaration.value;
        });
      }

      if (rule.selectors?.includes(".catalogue-filter-section__search:hover")) {
        rule.walkDecls("background", (declaration) => {
          interactiveBackgrounds.push(declaration.value);
        });
        rule.walkDecls("border", (declaration) => {
          interactiveBorders.push(declaration.value);
        });
        rule.walkDecls("outline", (declaration) => {
          interactiveOutlines.push(declaration.value);
        });
        rule.walkDecls("box-shadow", (declaration) => {
          interactiveShadows.push(declaration.value);
        });
      }
    });

    expect(defaultBackground).toBe("var(--surface-raised)");
    // Sem degrau em hover/foco — mantém mesmo background, sem borda decorativa.
    expect(interactiveBackgrounds).toEqual(["var(--surface-raised)"]);
    expect(interactiveBorders).toEqual(["0"]);
    expect(interactiveOutlines).toEqual(["none"]);
    expect(interactiveShadows).toEqual(["none"]);
    // O painel não pode empatar com o campo, senão o campo some no fundo.
    expect(panelBackground).not.toBe(defaultBackground);
  });

  it("drops the focus ring from the filter searchbar", () => {
    const css = compile("src/app.scss").css;

    expect(css).not.toContain(
      ".catalogue-filter-section__search:focus-visible {\n  outline:"
    );
  });

  it("keeps catalogue cards keyboard-operable with a native primary button", () => {
    const source = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(source).toContain('className="catalogue-card__button catalogue-card__button--list"');
    expect(source).toContain('type="button"');
    expect(source).not.toContain('role="button"');
  });

  it("keeps a dedicated action column at the narrow catalogue breakpoint", () => {
    const css = compile("src/app.scss").css;

    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 48px");
    expect(css).toContain("grid-template-columns: 140px minmax(0, 1fr)");
    expect(css).toContain(".catalogue-card__button--list");
  });

  it("renders accessible pagination semantics", () => {
    const source = readFileSync("src/components/ui/PaginationControls.tsx", "utf8");

    expect(source).toContain('aria-current={p === page ? "page" : undefined}');
    expect(source).toContain("catalogue.pagination.previous");
    expect(source).toContain("catalogue.pagination.next");
    expect(source).toContain("<span");
  });

  it("does not render a client-side recommendation section", () => {
    const source = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    expect(source).not.toContain("useCatalogueRecommendations");
    expect(source).not.toContain('className="catalogue-recommended"');
  });
  it("pauses hover work during scroll without changing the preview", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("CATALOGUE_SCROLL_IDLE_DELAY_MS");
    expect(page).toContain(
      'addEventListener("scroll", handleScroll, { passive: true })'
    );
    expect(page).not.toContain("elementFromPoint(pointer.x, pointer.y)");
    expect(page).toContain("setTimeout(finishScroll, CATALOGUE_SCROLL_IDLE_DELAY_MS)");
    expect(page).toContain("paused={isCatalogueScrolling}");
  });

  it("releases the scroll pause without selecting a new game on focus", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain("const handleWindowFocus = () => finishScroll();");
    expect(page).toContain('window.addEventListener("focus", handleWindowFocus)');
    expect(page).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(page).toContain("finishScroll();");
    expect(page).not.toContain("handleHoverGame(game, { pointer })");
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
    expect(listState).toContain('catalogue-card__button--${viewMode}');
    expect(listState).toContain("catalogue-card__cover--skeleton skeleton");
    expect(listState).not.toContain("catalogue-card__list-content");
    expect(listState).not.toContain("catalogue-card__genres");
    expect(listState).not.toContain("catalogue-card__actions");
  });

  it("keeps the loading cards in the selected catalogue layout", () => {
    const source = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const css = compile("src/app.scss").css;

    expect(source).toContain('viewMode = "list"');
    expect(source).toContain('isGrid ? " catalogue-list--cards" : ""');
    expect(source).toContain("catalogue-card__grid-body--skeleton");
    expect(page).toContain("<CatalogueListLoadingState viewMode={viewMode} />");
    expect(css).toContain(".catalogue-card__grid-body--skeleton");
    expect(css).toContain(".catalogue-card__skeleton-title");
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
