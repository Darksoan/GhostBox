import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("keeps catalogue text at 14px and pills compact in both window modes", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const declarations = (selector: string) => {
    const values = new Map<string, string>();
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls((declaration) => {
        values.set(declaration.prop, declaration.value);
      });
    });
    return values;
  };

  expect(declarations(":root").get("--catalogue-text-size")).toBe("14px");
  expect(declarations(":root").get("--catalogue-game-title-size")).toBe("16px");
  for (const selector of [
    ".catalogue-card__title",
    ".catalogue-card__list-content strong",
    ".catalogue-hover-preview__title",
  ]) {
    expect(declarations(selector).get("font-size")).toBe("var(--catalogue-game-title-size)");
  }
  expect(declarations(".catalogue-hover-preview__developer").get("font-size")).toBe(
    "var(--catalogue-text-size)",
  );
  const page = declarations(".catalogue-page");
  for (const role of ["micro", "caption", "compact", "body", "body-emphasis", "pill"]) {
    expect(page.get(`--type-size-${role}`)).toBe("var(--catalogue-text-size)");
  }
  expect(page.get("--pill-height")).toBe("24px");

  stylesheet.walkRules((rule) => {
    if (!rule.selector.includes(".sidebar--maximized")) return;
    if (rule.selector.includes(".catalogue-card__list-content strong")) {
      rule.walkDecls("font-size", (declaration) => {
        expect(declaration.value).toBe("var(--catalogue-game-title-size)");
      });
    }
    if (rule.selector.includes(".catalogue-card__genre-chip")) {
      rule.walkDecls("min-height", (declaration) => {
        expect(declaration.value).toBe("var(--pill-height)");
      });
    }
    if (rule.selector.endsWith(".catalogue-card__genres")) {
      rule.walkDecls("height", (declaration) => {
        expect(declaration.value).toBe("var(--pill-height)");
      });
    }
  });
});
