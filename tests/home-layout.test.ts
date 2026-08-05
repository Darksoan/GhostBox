import { readFileSync } from "node:fs";
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
    expect(customProperties.get("--n-0")).toBe("#0f0f0f");
    expect(customProperties.get("--surface-sidebar")).toBe("var(--n-1)");
    expect(customProperties.get("--surface-titlebar")).toBe("var(--surface-canvas)");
    expect(customProperties.get("--n-1")).toBe("#141414");
    expect(customProperties.get("--sidebar-option-hover")).toBe("var(--n-2)");
    expect(customProperties.get("--n-2")).toBe("#181818");
    expect(customProperties.get("--sidebar-option-selected")).toBe("var(--n-4)");
    expect(customProperties.get("--n-4")).toBe("#202020");
    expect(declarations.get(".sidebar")?.get("background")).toBe("var(--surface-sidebar)");
    expect(declarations.get(".subscription-plan-card")?.get("border")).toBe("0");
    expect(declarations.get(".app-main")?.get("background")).toBe("var(--app-gradient)");
    expect(declarations.get(".header")?.get("background-color")).toBe("var(--surface-titlebar)");
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

  it("removes the rated percentage and gives Home pills the full metadata row", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeCategoryCard");
    const sectionStart = component.indexOf("function HomeCategorySection");
    expect(cardStart).toBeGreaterThanOrEqual(0);
    expect(sectionStart).toBeGreaterThan(cardStart);
    const cardSource = component.slice(cardStart, sectionStart);

    expect(cardSource).not.toContain("home-category-card__rating");
    expect(cardSource).not.toContain("reviewScore");

    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const summaryRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".home-category-card__metadata-summary",
    );
    const genresRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".home-category-card__genres",
    );

    expect(summaryRule?.toString()).toContain("display: block");
    expect(genresRule?.toString()).toContain("width: 100%");
    expect(stylesheet.nodes).not.toContainEqual(
      expect.objectContaining({
        type: "rule",
        selector: ".home-category-card__rating",
      }),
    );
  });

  it("makes the recommended banner span the full tab width", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const declarations = new Map<string, Map<string, string>>();

    stylesheet.walkRules((rule) => {
      const ruleDeclarations = new Map<string, string>();
      rule.walkDecls((declaration) => {
        ruleDeclarations.set(declaration.prop, declaration.value);
      });
      const existing = declarations.get(rule.selector) ?? new Map<string, string>();
      ruleDeclarations.forEach((value, prop) => existing.set(prop, value));
      declarations.set(rule.selector, existing);
    });

    const stage = declarations.get(".home-recommended__stage");
    expect(stage?.get("margin-inline")).toBe(
      "calc(-1 * (var(--home-page-inline-padding) + var(--home-content-inline-inset)))"
    );
    expect(stage?.get("width")).toBe(
      "calc(100% + 2 * (var(--home-page-inline-padding) + var(--home-content-inline-inset)))"
    );

    const banner = declarations.get(".home-recommended__banner");
    expect(banner?.get("border-radius")).toBe("0");
  });
});
