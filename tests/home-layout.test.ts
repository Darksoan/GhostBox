import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function resolvePixels(value: string, customProperties: Map<string, string>): number | null {
  const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  if (variable) {
    const resolved = customProperties.get(variable);
    return resolved ? resolvePixels(resolved, customProperties) : null;
  }

  const pixels = value.match(/^(\d+(?:\.\d+)?)px$/)?.[1];
  return pixels ? Number(pixels) : null;
}

describe("Home layout", () => {
  it("keeps the app, titlebar, and page backgrounds on the raised canvas", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const customProperties = new Map<string, string>();
    const declarations = new Map<string, Map<string, string>>();

    stylesheet.walkRules((rule) => {
      const ruleDeclarations = new Map<string, string>();

      rule.walkDecls((declaration) => {
        ruleDeclarations.set(declaration.prop, declaration.value);
      });

      if (rule.selector === ":root") {
        ruleDeclarations.forEach((value, prop) => {
          if (prop.startsWith("--")) customProperties.set(prop, value);
        });
      }

      const existingDeclarations = declarations.get(rule.selector) ?? new Map<string, string>();
      ruleDeclarations.forEach((value, prop) => existingDeclarations.set(prop, value));
      declarations.set(rule.selector, existingDeclarations);
    });

    expect(customProperties.get("--background")).toBe("var(--surface-canvas)");
    expect(customProperties.get("--background-dark")).toBe("var(--surface-canvas)");
    expect(customProperties.get("--surface-canvas")).toBe("var(--n-0)");
    expect(customProperties.get("--n-0")).toBe("#0b0b0b");
    expect(declarations.get(".app-main")?.get("background")).toBe("var(--app-gradient)");
    expect(declarations.get(".header")?.get("background-color")).toBe("var(--app-gradient)");
    expect(declarations.get(".home-page")?.get("background")).toBe("var(--background-dark)");
  });

  it("keeps the terminal wishlist chevron clear of the window edge", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const customProperties = new Map<string, string>();
    let terminalMargin: string | undefined;

    stylesheet.walkRules((rule) => {
      if (rule.selector === ":root") {
        rule.walkDecls(/^--/, (declaration) => {
          customProperties.set(declaration.prop, declaration.value);
        });
      }

      if (rule.selector === ".home-wishlist__more") {
        rule.walkDecls("margin-block-end", (declaration) => {
          terminalMargin = declaration.value;
        });
      }
    });

    expect(terminalMargin, "the terminal chevron needs its own bottom clearance").toBeDefined();
    expect(resolvePixels(terminalMargin ?? "", customProperties)).toBeGreaterThanOrEqual(16);
  });
});
