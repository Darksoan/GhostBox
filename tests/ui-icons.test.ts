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

  it("defines one 20px size and a thinner 1.5px Lucide stroke", () => {
    const tokens = declarations(":root");
    expect(tokens["--ui-icon-size"]?.value).toBe("20px");
    expect(tokens["--ui-icon-stroke-width"]?.value).toBe("1.5");
  });

  it("uses 22px only for horizontal chevrons while keeping sidebar navigation at the global size", () => {
    expect(declarations("svg.ui-icon--22")["--ui-icon-size"]?.value).toBe("22px");
    expect(declarations("svg.sidebar__navigation-icon")["--ui-icon-size"]).toBeUndefined();
    expect(declarations(":root")["--ui-icon-size"]?.value).toBe("20px");
  });

  it("uses 24px for the titlebar feedback icon", () => {
    expect(declarations("svg.header__feedback-icon")["--ui-icon-size"]?.value).toBe("24px");
  });

  it("uses 24px for the titlebar subscription icon", () => {
    expect(declarations("svg.header__premium-crown")["--ui-icon-size"]?.value).toBe("24px");
  });

  it("uses 24px for the titlebar Discord logo without changing its artwork", () => {
    const discord = declarations(".header__discord-button svg");
    expect(discord.width).toEqual({ value: "24px", important: true });
    expect(discord.height).toEqual({ value: "24px", important: true });
  });

  it("overrides legacy and maximized icon dimensions without flex shrinking", () => {
    const icons = declarations("svg:is(.lucide, .reicon)");
    expect(icons.width).toEqual({ value: "var(--ui-icon-size)", important: true });
    expect(icons.height).toEqual({ value: "var(--ui-icon-size)", important: true });
    expect(icons.flex).toEqual({ value: "0 0 var(--ui-icon-size)", important: true });
    expect(icons["shape-rendering"]).toEqual({ value: "auto", important: true });
  });

  it("preserves Lucide round caps and joins without adding strokes to filled Reicon paths", () => {
    const lucide = declarations("svg.lucide");
    expect(lucide["stroke-width"]).toEqual({ value: "var(--ui-icon-stroke-width)", important: true });
    expect(lucide["stroke-linecap"]?.value).toBe("round");
    expect(lucide["stroke-linejoin"]?.value).toBe("round");
    expect(declarations("svg:is(.lucide, .reicon)")["stroke-width"]).toBeUndefined();
    expect(iconStyles).not.toMatch(/\bfill\s*:/);
  });

  it("keeps the token stroke in actual pixels when the 24-unit drawing is reduced to 20px", () => {
    const shapes = declarations("svg.lucide :is(path, rect, circle, ellipse, line, polyline, polygon)");
    expect(shapes["vector-effect"]?.value).toBe("non-scaling-stroke");
    expect(declarations("svg.lucide")["vector-effect"]).toBeUndefined();
  });

  it("aligns the House walls, door and base to the pixel grid without a second outline", () => {
    expect(declarations("svg.lucide-house").translate?.value).toBe("0.5px 0.5px");
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon: Home }));
    const paths = [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
    expect(markup.match(/<svg\b/g)).toHaveLength(1);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    expect(iconStyles).not.toMatch(/\b(?:filter|box-shadow)\s*:/);
  });

  it.each([Home, Search, Heart, Settings, ChevronDown, X])("uses the shared metrics for Lucide icon %#", (icon) => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon }));
    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
    expect(markup).toContain('stroke-width="2"');
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('stroke-linejoin="round"');
    expect(markup).toMatch(/class="lucide /);
  });

  it("keeps Reicon navigation in its original Outline drawing at 20px", () => {
    const markup = renderToStaticMarkup(createElement(SidebarNavigationIcon, { icon: Grid }));
    const original = renderToStaticMarkup(createElement(Grid, { size: 20, weight: "Outline" }));
    const svgContents = (svg: string) => svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
    expect(markup).toContain('class="reicon ');
    expect(svgContents(markup)).toBe(svgContents(original));
  });

  it("uses the same close icon in modals, notifications and the titlebar", () => {
    const markup = renderToStaticMarkup(createElement(ModalCloseIcon));
    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
    expect(markup).toContain('stroke-width="2"');
    expect(markup).toContain('stroke-linecap="round"');

    for (const path of [
      "src/components/layout/Header.tsx",
      "src/components/ui/Toast.tsx",
      "src/components/ui/AchievementToast.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('<X size={20} strokeWidth={2} aria-hidden="true" />');
      expect(source).not.toContain("absoluteStrokeWidth");
    }
  });

  it("does not select brand SVGs, images or custom checkbox artwork", () => {
    const selectors: string[] = [];
    postcss.parse(compile("src/styles/_icons.scss").css).walkRules((rule) => {
      selectors.push(rule.selector);
    });
    expect(selectors).toEqual([
      "svg.ui-icon--22",
      "svg.header__feedback-icon",
      "svg.header__premium-crown",
      ".header__discord-button svg",
      "svg:is(.lucide, .reicon)",
      "svg.lucide",
      "svg.lucide :is(path, rect, circle, ellipse, line, polyline, polygon)",
      "svg.lucide-house",
    ]);
    expect(css).not.toContain("svg:not([data-preserve-stroke])");
  });

  it("keeps icon rotation and loading animations while avoiding fractional play-icon scaling", () => {
    expect(iconStyles).not.toMatch(/\b(?:transform|animation)\s*:/);
    stylesheet.walkRules((rule) => {
      if (!rule.selector.split(",").some((selector) => selector.trim() === ".game-card__play-button svg")) return;
      rule.walkDecls("transform", (declaration) => {
        expect(declaration.value).toBe("none");
      });
    });
    expect(declarations(".modal__nav-button:hover svg").transform?.value).toBe("none");
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
    expect(sidebar).toContain('<Plus size={20} className="sidebar__add-icon"');
  });

  it("also loads the shared style in the tray without changing game artwork", () => {
    const tray = readFileSync("src/components/tray/TrayMenu.tsx", "utf8");
    expect(tray).toContain('import "../../app.scss";');
    expect(tray).toContain('<Icon size={20} strokeWidth={2} weight="Outline" />');
    expect(declarations(".tray-menu__game-icon").width?.value).toBe("16px");
    expect(declarations(".tray-menu__game-icon--fallback").width?.value).toBe("var(--ui-icon-size)");
  });
});
