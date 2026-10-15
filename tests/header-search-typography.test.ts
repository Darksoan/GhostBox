import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("header search typography", () => {
  it("matches the Premium control's font size, weight and line height", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const declarations = (selector: string) => {
      const values = new Map<string, string>();
      stylesheet.walkRules((rule) => {
        if (rule.selector !== selector) return;
        rule.walkDecls((declaration) => {
          values.set(declaration.prop, declaration.value);
        });
      });
      return values;
    };
    const search = declarations(".header__search input");
    const premium = declarations(".header__premium-indicator");
    const placeholder = declarations(".header__search input::placeholder");

    for (const property of ["font-size", "font-weight", "line-height"]) {
      expect(search.get(property), property).toBe(premium.get(property));
    }
    expect(search.get("line-height")).toBe("1");
    expect(search.get("font-weight")).toBe("var(--weight-regular)");
    expect(placeholder.get("font-weight")).toBe(search.get("font-weight"));
  });

  it("matches the Premium control's hover background step", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const backgrounds = new Map<string, string>();
    stylesheet.walkRules((rule) => {
      if (
        rule.selector !== ".header__search:hover, .header__search:focus-within" &&
        rule.selector !== ".header__premium-indicator:hover, .header__premium-indicator:focus-visible"
      ) {
        return;
      }
      rule.walkDecls("background", (declaration) => {
        backgrounds.set(rule.selector, declaration.value);
      });
    });

    expect(backgrounds.get(".header__search:hover, .header__search:focus-within")).toBe(
      "var(--surface-titlebar-control-hover)",
    );
    expect(backgrounds.get(".header__premium-indicator:hover, .header__premium-indicator:focus-visible")).toBe(
      "var(--surface-option-hover)",
    );

    const tokens = new Map<string, string>();
    stylesheet.walkRules((rule) => {
      if (rule.selector !== ":root") return;
      rule.walkDecls(/^--/, (declaration) => {
        tokens.set(declaration.prop, declaration.value);
      });
    });
    const resolve = (name: string): string => {
      const value = tokens.get(name);
      const variable = value?.match(/^var\((--[^)]+)\)$/)?.[1];
      return variable ? resolve(variable) : (value ?? "");
    };

    // Mesma subida de rampa (c-1 → c-3) nos dois controles.
    expect(resolve("--surface-titlebar-control-hover")).toBe(resolve("--surface-option-hover"));
  });
});
