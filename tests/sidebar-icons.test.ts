import { readFileSync } from "node:fs";
import { Gear, Home6, Library } from "reicon-react";
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

  it.each(navigationItems)("keeps $id in its 20px box", ({ icon }) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));

    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain("sidebar__navigation-icon");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("data-preserve-stroke");
    expect(markup).not.toContain("sidebar__navigation-icon--settings");
  });

  it("renders Gear at 20px while preserving the original Reicon Outline geometry", () => {
    const settings = secondaryNavigation.find(({ id }) => id === "settings");
    expect(settings?.icon).toBe(Gear);

    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon: Gear }));
    const original = renderToStaticMarkup(createElement(Gear, { size: 20, weight: "Outline" }));
    const svgContents = (svg: string) => svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));

    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('class="reicon ');
    expect(markup).toContain("sidebar__navigation-icon");
    expect(markup).not.toContain("sidebar__navigation-icon--settings");
    expect(markup).toContain('aria-hidden="true"');
    expect(svgContents(markup)).toBe(svgContents(original));
  });

  it.each(settingsNavigationTabs)("keeps the shared 2 stroke for the $id settings tab", ({ icon }) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));

    expect(markup).toContain('stroke-width="2"');
  });

  it("uses Reicon Home6 for home navigation", () => {
    const home = primaryNavigation.find(({ id }) => id === "home");
    expect(home?.icon).toBe(Home6);
  });

  it("uses Reicon Library for library navigation", () => {
    const library = primaryNavigation.find(({ id }) => id === "library");
    expect(library?.icon).toBe(Library);
  });

  it("keeps reicon navigation icons in Outline", () => {
    const source = readFileSync("src/components/layout/SidebarNavigationIcon.tsx", "utf8");

    expect(source).toContain('weight="Outline"');
  });

  it("shares the icon renderer across primary, secondary, settings and profile navigation", () => {
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

    expect(sidebar.match(/<SidebarNavigationIcon icon=\{Icon\} \/>/g)).toHaveLength(4);
    expect(sidebar).not.toContain("<Icon size={19}");
  });

  it("preserves the shared navigation rendering without changing collection or game icons", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const navigationIconStyles = styles.match(/&__navigation-icon\s*\{[\s\S]*?\n  \}/)?.[0];

    expect(navigationIconStyles).toContain("shape-rendering: auto;");
    expect(navigationIconStyles).not.toContain("non-scaling-stroke");
  });

  it("keeps navigation at 20px in normal and maximized windows without a Settings exception", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const normalIcons = styles.match(/&__menu-item-button\s*\{[\s\S]*?\bsvg\s*\{([^}]*)\}/)?.[1];
    const maximizedIcons = styles.match(/\.sidebar--maximized \.sidebar__menu-item-button svg\s*\{[^}]*\}/)?.[0];

    expect(normalIcons).toContain("width: 20px;");
    expect(normalIcons).toContain("height: 20px;");
    expect(maximizedIcons).toContain("width: 20px;");
    expect(maximizedIcons).toContain("height: 20px;");
    expect(styles).toContain('@use "./styles/icons";');
    expect(styles).not.toContain("data-preserve-stroke");
  });
});
