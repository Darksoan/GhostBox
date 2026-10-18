import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronDown, Heart, Home, Search, Settings, X } from "lucide-react";
import { Grid } from "reicon-react";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { ModalCloseIcon } from "../src/components/ui/ModalCloseIcon";
import { SidebarNavigationIcon } from "../src/components/layout/SidebarNavigationIcon";

/** Lucide e Reicon desenham numa grade de 24 unidades. */
const ICON_VIEWBOX = 24;
const REDUCED_DRAWING = ":is(svg.lucide, svg.reicon, .header__discord-button svg) > :is(path, rect, circle, ellipse, line, polyline, polygon, g)";
const SIDEBAR_CHEVRONS = "svg.sidebar__section-toggle-chevron,\nsvg.sidebar__collection-chevron";
const ARROWS = ".header__nav-btn svg.lucide,\n:is(.home-banner__arrow, .home-top-rated__arrow, .home-explore__arrow, .home-recommended__arrow) svg.lucide";
const CHEVRON_PATHS = "svg:is(.sidebar__section-toggle-chevron, .sidebar__collection-chevron) path";
const ARROW_PATHS = ".header__nav-btn svg.lucide path,\n:is(.home-banner__arrow, .home-top-rated__arrow, .home-explore__arrow, .home-recommended__arrow) svg.lucide path";

describe("shared interface icon metrics", () => {
  const css = compile("src/app.scss").css;
  const stylesheet = postcss.parse(css);
  const iconStyles = readFileSync("src/styles/_icons.scss", "utf8");

  function declarations(selector: string) {
    const values: Record<string, { value: string; important: boolean }> = {};
    stylesheet.walkRules((rule) => {
      if (rule.selector !== selector) return;
      rule.walkDecls((declaration) => {
        values[declaration.prop] = {
          value: declaration.value,
          important: Boolean(declaration.important),
        };
      });
    });
    return values;
  }

  it("renders shared icons at 20px without an extra internal scale", () => {
    const tokens = declarations(":root");
    const size = Number.parseFloat(tokens["--ui-icon-size"]?.value ?? "");

    expect(size / ICON_VIEWBOX).toBe(20 / 24);
    expect(tokens["--ui-icon-size"]?.value).toBe("20px");
  });

  it("uses a thin stroke that keeps the light band symmetric", () => {
    const stroke = Number(declarations(":root")["--ui-icon-stroke-width"]?.value);

    expect(stroke).toBe(1.5);
  });

  it("preserves the Lucide stroke when rendering at 20px", () => {
    const shapes = "svg.lucide :is(path, rect, circle, ellipse, line, polyline, polygon)";
    expect(declarations(shapes)["vector-effect"]?.value).toBe("non-scaling-stroke");
    expect(declarations("svg.lucide")["vector-effect"]).toBeUndefined();
    const selectorsWith = (prop: string) => {
      const found: string[] = [];
      stylesheet.walkDecls(prop, (declaration) => found.push(declaration.parent.selector));
      return found;
    };
    expect(selectorsWith("vector-effect")).toEqual([
      shapes,
      CHEVRON_PATHS,
      ARROW_PATHS,
    ]);
    expect(selectorsWith("translate")).toEqual([]);
    expect(css).not.toContain("svg.lucide-house");
  });

  it("enforces the shared stroke over legacy component attributes and local styles", () => {
    expect(declarations("svg.lucide")["stroke-width"]).toEqual({
      value: "var(--ui-icon-stroke-width)",
      important: true,
    });
  });

  it("leaves Reicon paths filled, without a stroke that would deform them", () => {
    expect(declarations("svg.reicon")["stroke-width"]).toBeUndefined();
  });

  it("carries no manual nudge to fake a pixel grid", () => {
    // O `translate: 0.5px` do House saía das coordenadas certas para um
    // caso pior (traço ímpar). Não existe ajuste manual que conserte o 5/6.
    expect(iconStyles).not.toMatch(/\btranslate\s*:/);
    expect(css).not.toContain("svg.lucide-house");
  });

  it("leaves rendering hints to the components instead of forcing them", () => {
    expect(declarations("svg:is(.lucide, .reicon)")["shape-rendering"]).toBeUndefined();
  });

  it("keeps every interface drawing at native scale", () => {
    expect(declarations(REDUCED_DRAWING).transform).toBeUndefined();
    expect(iconStyles).not.toContain("scale(0.8333333333)");
  });

  it("keeps chevrons and sidebar navigation at the global size", () => {
    expect(declarations("svg.ui-icon--22")["--ui-icon-size"]).toBeUndefined();
    expect(declarations("svg.sidebar__navigation-icon")["--ui-icon-size"]).toBeUndefined();
  });

  it("uses the global size for the titlebar feedback icon", () => {
    expect(declarations("svg.header__feedback-icon")["--ui-icon-size"]).toBeUndefined();
  });

  it("uses the global size for the titlebar subscription icon", () => {
    expect(declarations("svg.header__premium-crown")["--ui-icon-size"]).toBeUndefined();
  });

  it("uses the global size for the titlebar Discord logo without changing its artwork", () => {
    const discord = declarations(".header__discord-button svg");
    expect(discord.width).toEqual({ value: "var(--ui-icon-size)", important: true });
    expect(discord.height).toEqual({ value: "var(--ui-icon-size)", important: true });
  });

  it("overrides legacy and maximized icon dimensions without flex shrinking", () => {
    const icons = declarations("svg:is(.lucide, .reicon)");
    expect(icons.width).toEqual({ value: "var(--ui-icon-size)", important: true });
    expect(icons.height).toEqual({ value: "var(--ui-icon-size)", important: true });
    expect(icons.flex).toEqual({ value: "0 0 var(--ui-icon-size)", important: true });
  });

  it("preserves explicit chevron and arrow sizes and shares titlebar metrics in both window states", () => {
    const overrides: string[] = [];
    stylesheet.walkDecls("--ui-icon-size", (decl) => {
      if (decl.parent.type === "rule" && decl.parent.selector !== ":root") {
        overrides.push(decl.parent.selector);
      }
    });
    expect(overrides).toEqual([SIDEBAR_CHEVRONS, ARROWS]);
    expect(declarations(SIDEBAR_CHEVRONS)["--ui-icon-size"]?.value).toBe("22px");
    expect(declarations(ARROWS)["--ui-icon-size"]?.value).toBe("22px");
    const headerSizes: string[] = [];
    stylesheet.walkDecls("--header-icon", (decl) => { headerSizes.push(decl.value); });
    expect(headerSizes.length).toBeGreaterThan(0);
    expect(headerSizes.every((size) => size === "var(--ui-icon-size)")).toBe(true);
  });

  it("aligns the House without a second outline", () => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon: Home }));
    const paths = [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
    expect(markup.match(/<svg\b/g)).toHaveLength(1);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    expect(iconStyles).not.toMatch(/\b(?:filter|box-shadow)\s*:/);
  });

  it.each([Home, Search, Heart, Settings, ChevronDown, X])("uses the shared metrics for Lucide icon %#", (icon) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('stroke-linejoin="round"');
    expect(markup).toMatch(/class="lucide /);
  });

  it("keeps Reicon navigation in its original Outline drawing at 24px", () => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon: Grid }));
    const original = renderToStaticMarkup(createElement(Grid, { size: 24, weight: "Outline" }));
    const svgContents = (svg: string) => svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('class="reicon ');
    expect(svgContents(markup)).toBe(svgContents(original));
  });

  it("uses the same close icon in modals, notifications and the titlebar", () => {
    const markup = renderToStaticMarkup(createElement(ModalCloseIcon));
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('stroke-width="1.25"');
    expect(markup).toContain('stroke-linecap="round"');

    for (const path of [
      "src/components/layout/Header.tsx",
      "src/components/ui/Toast.tsx",
      "src/components/ui/AchievementToast.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('<X size={24} strokeWidth={1.25} aria-hidden="true" />');
      expect(source).not.toContain("absoluteStrokeWidth");
    }
  });

  it("does not select brand SVGs, images or custom checkbox artwork", () => {
    const selectors: string[] = [];
    postcss.parse(compile("src/styles/_icons.scss").css).walkRules((rule) => {
      selectors.push(rule.selector);
    });
    expect(selectors).toEqual([
      ".header__discord-button svg",
      "svg:is(.lucide, .reicon)",
      SIDEBAR_CHEVRONS,
      "svg.lucide",
      "svg.lucide :is(path, rect, circle, ellipse, line, polyline, polygon)",
      CHEVRON_PATHS,
      ARROWS,
      ARROW_PATHS,
    ]);
    expect(css).not.toContain("svg:not([data-preserve-stroke])");
  });

  it("keeps icon rotation and loading animations while avoiding fractional play-icon scaling", () => {
    expect(iconStyles).not.toMatch(/\banimation\s*:/);
    const transforms: string[] = [];
    postcss.parse(compile("src/styles/_icons.scss").css).walkDecls("transform", (decl) => {
      if (decl.parent.type === "rule") transforms.push(decl.parent.selector);
    });
    expect(transforms).toEqual([]);
    stylesheet.walkRules((rule) => {
      if (!rule.selector.split(",").some((selector) => selector.trim() === ".game-card__play-button svg")) return;
      rule.walkDecls("transform", (declaration) => {
        expect(declaration.value).toBe("none");
      });
    });
    expect(declarations(".modal__nav-button:hover svg").transform?.value).toBe("none");
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
    expect(sidebar).toContain('<span className="sidebar__add-icon" aria-hidden="true" />');
  });

  it("also loads the shared style in the tray without changing game artwork", () => {
    const tray = readFileSync("src/components/tray/TrayMenu.tsx", "utf8");
    expect(tray).toContain('import "../../app.scss";');
    expect(tray).toContain('<Icon size={24} strokeWidth={1.25} weight="Outline" />');
    expect(declarations(".tray-menu__game-icon").width?.value).toBe("16px");
    expect(declarations(".tray-menu__game-icon--fallback").width?.value).toBe("var(--ui-icon-size)");
  });
});
