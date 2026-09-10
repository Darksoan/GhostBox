import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function paddingBlockEnd(value: string): string {
  const parts = value.trim().split(/\s+/);

  if (parts.length < 3) return parts[0];
  return parts[2];
}

describe("Page bottom spacing", () => {
  it("uses the canonical bottom spacing across every app tab", () => {
    const stylesheet = postcss.parse(
      [
        compile("src/app.scss").css,
        compile("src/pages/ProfilePage.scss").css,
        compile("src/pages/GameAchievementsPage.scss").css,
      ].join("\n"),
    );
    const selectors = [
      ".home-page",
      ".catalogue-page__results",
      ".content-section--library",
      ".favorites-page",
      ".settings-page--tabs",
      ".profile-page__content-section",
      ".notifications-page",
      ".downloads-page",
      ".backup-page",
      ".game-achievements-page__content",
    ];

    selectors.forEach((selector) => {
      const values: string[] = [];

      stylesheet.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;

        rule.walkDecls(/^padding(?:-bottom)?$/, (declaration) => {
          values.push(
            declaration.prop === "padding-bottom"
              ? declaration.value
              : paddingBlockEnd(declaration.value),
          );
        });
      });

      expect(values, `${selector} needs explicit bottom spacing`).not.toHaveLength(0);
      expect(values, `${selector} must use --page-bottom-space`).toEqual(
        values.map(() => "var(--page-bottom-space)"),
      );
    });
  });

  // `content-visibility: auto` sem a palavra-chave `auto` em
  // `contain-intrinsic-size` faz o placeholder voltar ao tamanho estimado toda
  // vez que a seção sai da viewport. O `scrollHeight` do scroller compartilhado
  // encolhe junto e o respiro final da aba vira inalcançável.
  it("remembers the measured size of every content-visibility section", () => {
    const stylesheet = postcss.parse(
      [
        compile("src/app.scss").css,
        compile("src/pages/ProfilePage.scss").css,
        compile("src/pages/GameAchievementsPage.scss").css,
      ].join("\n"),
    );

    stylesheet.walkRules((rule) => {
      let skipsContent = false;

      rule.walkDecls("content-visibility", (declaration) => {
        if (declaration.value.trim() === "auto") skipsContent = true;
      });
      if (!skipsContent) return;

      rule.walkDecls("contain-intrinsic-size", (declaration) => {
        expect(
          declaration.value.trim().startsWith("auto "),
          `${rule.selector} must use "contain-intrinsic-size: auto <size>"`,
        ).toBe(true);
      });
    });
  });

  // `min-height: 100%` substitui o mínimo automático do flex (`min-height:
  // auto`), então cada elo da cadeia do scroller pode encolher até a altura do
  // scrollport e deixar o conteúdo mais alto TRANSBORDAR. Quando isso acontece o
  // `padding-bottom` da raiz fica acima do conteúdo, fora da tela, e o último
  // elemento encosta na borda inferior da janela.
  it("keeps the scroller chain from shrinking below its content", () => {
    const stylesheet = postcss.parse(
      [
        compile("src/app.scss").css,
        compile("src/pages/ProfilePage.scss").css,
        compile("src/pages/GameAchievementsPage.scss").css,
      ].join("\n"),
    );
    const selectors = [
      ".page-stack",
      ".page-stack__base",
      ".page-stack__overlay",
      ".page",
      ".page--backup",
      ".page--game-achievements",
      ".home-page",
      ".settings-page",
      ".notifications-page",
      ".downloads-page",
      ".backup-page",
      ".profile-page",
      ".game-achievements-page",
    ];

    selectors.forEach((selector) => {
      let shrink: string | null = null;
      let declaresMinHeight = false;

      stylesheet.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        if (rule.parent.type === "atrule") return;

        rule.walkDecls(/^(flex|flex-shrink|min-height)$/, (declaration) => {
          if (declaration.prop === "min-height") {
            declaresMinHeight = declaration.value.trim() === "100%";
            return;
          }
          shrink =
            declaration.prop === "flex-shrink"
              ? declaration.value.trim()
              : (declaration.value.trim().split(/\s+/)[1] ?? "1");
        });
      });

      expect(declaresMinHeight, `${selector} should floor at the scrollport`).toBe(true);
      expect(shrink, `${selector} must not shrink below its content`).toBe("0");
    });
  });

  it("keeps the game details modal scrollable below the narrow breakpoint", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const narrowRule = stylesheet.nodes.find(
      (node) =>
        node.type === "atrule" &&
        node.name === "media" &&
        node.params === "(max-width: 1200px)",
    );

    expect(narrowRule?.type).toBe("atrule");
    const modalRule = narrowRule?.nodes?.find(
      (node) => node.type === "rule" && node.selector === ".modal--details",
    );
    const declarations =
      modalRule?.type === "rule"
        ? modalRule.nodes
            .filter((node) => node.type === "decl")
            .map((node) => ({ prop: node.prop, value: node.value }))
        : [];

    expect(declarations).toContainEqual({ prop: "min-height", value: "100%" });
    expect(declarations.some(({ prop }) => prop === "padding-bottom")).toBe(true);
    expect(
      declarations.some(({ prop, value }) => prop === "height" && value === "100%"),
    ).toBe(false);
    expect(
      declarations.some(({ prop, value }) => prop === "overflow" && value === "hidden"),
    ).toBe(false);
  });
});
