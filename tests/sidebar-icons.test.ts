import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { primaryNavigation, secondaryNavigation } from "../src/components/layout/navigationItems";
import { SidebarNavigationIcon } from "../src/components/layout/SidebarNavigationIcon";
import { profileNavigationTabs } from "../src/features/profile/profileTabsShared";
import { settingsNavigationTabs } from "../src/features/settings/settingsTabsShared";

describe("sidebar navigation icons", () => {
  const navigationItems = [
    ...primaryNavigation,
    ...secondaryNavigation,
    ...settingsNavigationTabs,
    ...profileNavigationTabs,
  ];

  it.each(navigationItems)("renders $id in the same 24px box", ({ icon }) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));

    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain("sidebar__navigation-icon");
    expect(markup).toContain('aria-hidden="true"');
  });

  it.each(settingsNavigationTabs)("uses the shared 1.5 stroke for the $id settings icon", ({ icon }) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));

    expect(markup).toContain('stroke-width="1.5"');
  });

  it("renders reicon navigation icons in Outline to match the Heart weight", () => {
    const source = readFileSync("src/components/layout/SidebarNavigationIcon.tsx", "utf8");

    expect(source).toContain('weight="Outline"');
    expect(source).toContain("strokeWidth={1.5}");
  });

  it("shares the icon renderer across primary, secondary, settings and profile navigation", () => {
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

    expect(sidebar.match(/<SidebarNavigationIcon icon=\{Icon\} \/>/g)).toHaveLength(4);
    expect(sidebar).not.toContain("<Icon size={19}");
  });

  it("keeps the back chevron at its own 19px size", () => {
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const declarations = new Map<string, string>();
    stylesheet.walkRules(".sidebar__menu-item-button--back svg", (rule) => {
      rule.walkDecls((declaration) => { declarations.set(declaration.prop, declaration.value); });
    });

    expect(sidebar).toContain('viewBox="0 0 20 20" width="19" height="19"');
    expect(declarations.get("width")).toBe("19px");
    expect(declarations.get("height")).toBe("19px");
  });

  it("keeps navigation strokes at the Heart weight without changing collection or game icons", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const navigationIconStyles = styles.match(/&__navigation-icon\s*\{[\s\S]*?\n  \}/)?.[0];

    expect(navigationIconStyles).toContain("shape-rendering: geometricPrecision;");
    expect(navigationIconStyles).not.toContain("non-scaling-stroke");
  });

  it("uses primary text and inherited icon color on sidebar hover and focus", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const declarations = new Map<string, Map<string, string>>();
    stylesheet.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const values = declarations.get(selector) ?? new Map<string, string>();
        rule.walkDecls((declaration) => { values.set(declaration.prop, declaration.value); });
        declarations.set(selector, values);
      }
    });

    for (const state of ["hover", "focus-within"]) {
      const selector = `.sidebar__menu-item:${state}:not(.sidebar__menu-item--active):not(.sidebar__collection-item)`;
      expect(declarations.get(selector)?.get("color")).toBe("var(--text-primary)");
      expect(declarations.get(selector)?.get("background")).toBe("var(--sidebar-option-hover)");
    }
    for (const selector of [".sidebar__menu-item-button", ".sidebar__menu-item-button svg", ".sidebar__menu-item-label"]) {
      expect(declarations.get(selector)?.get("color"), selector).toBe("inherit");
    }
    expect(declarations.get(".sidebar__menu-item--active:hover")?.get("background")).toBe("var(--sidebar-option-active)");
  });
});
