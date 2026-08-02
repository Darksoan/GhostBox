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
