import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

  it.each(settingsNavigationTabs)("uses the shared 1.25 stroke for the $id settings icon", ({ icon }) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));

    expect(markup).toContain('stroke-width="1.25"');
  });

  it("renders reicon navigation icons in Outline to match the Heart weight", () => {
    const source = readFileSync("src/components/layout/SidebarNavigationIcon.tsx", "utf8");

    expect(source).toContain('weight="Outline"');
    expect(source).toContain("strokeWidth={1.25}");
  });

  it("shares the icon renderer across primary, secondary, settings and profile navigation", () => {
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

    expect(sidebar.match(/<SidebarNavigationIcon icon=\{Icon\} \/>/g)).toHaveLength(4);
    expect(sidebar).not.toContain("<Icon size={19}");
  });

  it("keeps navigation strokes at the Heart weight without changing collection or game icons", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const navigationIconStyles = styles.match(/&__navigation-icon\s*\{[\s\S]*?\n  \}/)?.[0];

    expect(navigationIconStyles).toContain("shape-rendering: geometricPrecision;");
    expect(navigationIconStyles).not.toContain("non-scaling-stroke");
  });
});
