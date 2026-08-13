import { compile } from "sass-embedded";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  allNavigation,
  primaryNavigation,
  secondaryNavigation,
} from "../src/components/layout/navigationItems";

describe("Floating nav — navigation items", () => {
  it("keeps the five pages the card renders, in order", () => {
    expect(allNavigation.map((item) => item.id)).toEqual([
      "home",
      "catalogue",
      "library",
      "downloads",
      "settings",
    ]);
  });

  it("gives every item a translation key and an icon", () => {
    for (const item of [...primaryNavigation, ...secondaryNavigation]) {
      expect(item.labelKey).toMatch(/^nav\./);
      expect(item.icon).toBeTruthy();
    }
  });
});

describe("Floating nav — styles", () => {
  const css = postcss.parse(
    compile("src/components/layout/FloatingNav.scss").css
  );

  it("floats above the content without leaving the app chrome", () => {
    let position: string | undefined;
    let bottom: string | undefined;

    css.walkRules((rule) => {
      if (rule.selector !== ".floating-nav") return;
      rule.walkDecls("position", (declaration) => {
        position = declaration.value;
      });
      rule.walkDecls("bottom", (declaration) => {
        bottom = declaration.value;
      });
    });

    expect(position).toBe("absolute");
    expect(bottom).toBeDefined();
  });

  it("never hides itself — the card has no hidden state", () => {
    const source = readFileSync(
      "src/components/layout/FloatingNav.scss",
      "utf8"
    );
    expect(source).not.toContain("floating-nav--hidden");
  });

  it("stays above the game modal instead of half-buried under it", () => {
    let navZIndex: string | undefined;

    css.walkRules((rule) => {
      if (rule.selector !== ".floating-nav") return;
      rule.walkDecls("z-index", (declaration) => {
        navZIndex = declaration.value;
      });
    });

    expect(navZIndex).toBe("var(--z-popover)");

    // O token do card tem que ficar acima do usado por `.container--modal-open`
    // e abaixo do de toast, senão a correção só troca quem some.
    const primitives = readFileSync("src/styles/_primitives.scss", "utf8");
    const tokenValue = (name: string) =>
      Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(primitives)?.[1]);

    expect(tokenValue("popover")).toBeGreaterThan(tokenValue("modal"));
    expect(tokenValue("popover")).toBeLessThan(tokenValue("toast"));
  });

  it("reserves room at the end of the game modal so the card covers nothing", () => {
    const styles = postcss.parse(compile("src/app.scss").css);
    let modalPadding: string | undefined;

    styles.walkRules((rule) => {
      if (rule.selector !== ".modal__details") return;
      rule.walkDecls("padding", (declaration) => {
        modalPadding = declaration.value;
      });
    });

    // O piso é `--page-bottom-space`, que no layout flutuante já embute a altura
    // do card. `.backdrop--details` não serve para isso: é `inset: 0` e o
    // conteúdo transborda o padding em vez de ser empurrado por ele.
    expect(modalPadding).toContain("var(--page-bottom-space)");
    expect(modalPadding).toContain("max(");
  });

  it("keeps the game modal's Ver mais button clear of the card", () => {
    const source = readFileSync("src/components/modals/GameModal.tsx", "utf8");

    // O botão é posicionado pela altura calculada do bloco "sobre", que seguia
    // só o fim da sidebar sticky — e essa podia terminar atrás do card.
    expect(source).toContain('querySelector(".floating-nav")');
    expect(source).toContain("Math.min(sidebarBottom, floatingNavTop)");
    // Sidebar sticky e card fixo mudam de posição relativa ao rolar, e nenhum
    // ResizeObserver vê isso.
    expect(source).toContain("subscribeScrollIdle(updateCollapsedHeight)");
  });

  it("follows the card radius used across the app", () => {
    let radius: string | undefined;

    css.walkRules((rule) => {
      if (rule.selector !== ".floating-nav__card") return;
      rule.walkDecls("border-radius", (declaration) => {
        radius = declaration.value;
      });
    });

    expect(radius).toBe("var(--radius-lg)");
  });
});

describe("Vertical covers — a single hover badge style", () => {
  it("drops the favorites-only progress badge in favor of the shared one", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const favorites = readFileSync("src/pages/FavoritesPage.tsx", "utf8");
    const loading = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");

    for (const source of [styles, favorites, loading]) {
      expect(source).not.toContain("achievement-progress");
    }

    expect(favorites).toContain("game-card__achievement-badges");
  });
});
