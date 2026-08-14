import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

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
    expect(customProperties.get("--n-0")).toBe("#0a0a0a");
    expect(customProperties.get("--surface-sidebar")).toBe("var(--n-1)");
    expect(customProperties.get("--surface-titlebar")).toBe("var(--surface-canvas)");
    expect(customProperties.get("--n-1")).toBe("#101010");
    // Navegação clareia: sidebar sobe no hover e sobe de novo quando selecionada.
    expect(customProperties.get("--sidebar-option-hover")).toBe("var(--n-3)");
    expect(customProperties.get("--n-3")).toBe("#151515");
    expect(customProperties.get("--sidebar-option-selected")).toBe("var(--n-4)");
    expect(customProperties.get("--n-4")).toBe("#1a1a1a");
    // Conteúdo usa degrau seguinte no hover, mantendo separação da base.
    expect(customProperties.get("--surface-option")).toBe("var(--n-1)");
    expect(customProperties.get("--surface-option-hover")).toBe("var(--n-2)");
    expect(declarations.get(".library-panel")?.get("background")).toBe("var(--surface-sidebar)");
    expect(declarations.get(".subscription-plan-card")?.get("border")).toBe("0");
    expect(declarations.get(".app-main")?.get("background")).toBe("var(--app-gradient)");
    expect(declarations.get(".header")?.get("background-color")).toBe("var(--surface-titlebar)");
    expect(declarations.get(".home-page")?.get("background")).toBe("var(--background-dark)");
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

  it("caps Home pills at three, closed to a single line", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    expect(component).toContain("const homeMetadataCategoryLimit = 3;");

    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const genresRule = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".home-category-card__genres",
    );

    // Uma linha fecha em exatamente uma altura de pill — sem o `* 2 + gap` de
    // quando o card reservava duas linhas.
    expect(genresRule?.toString()).toContain("height: var(--pill-height)");
    expect(genresRule?.toString()).not.toContain("calc(var(--pill-height) * 2");
  });

  it("reserves the second pill row before the async data lands", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeCategoryCard");
    const sectionStart = component.indexOf("function HomeCategorySection");
    const cardSource = component.slice(cardStart, sectionStart);

    // As pills vêm do enrichment assíncrono, card a card. Ligar a linha ao
    // conteúdo (`secondaryCategories.length > 0`) fazia o card crescer uma
    // altura de pill quando a resposta dele voltava, remexendo a linha do grid.
    expect(cardSource).toContain("{showSecondaryPills ? (");
    expect(cardSource).not.toContain("showSecondaryPills && secondaryCategories.length");

    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const tagsRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".home-category-card__tags",
    );

    // A altura fixa é o que faz a linha vazia ocupar o mesmo espaço da cheia.
    expect(tagsRule?.toString()).toContain("height: var(--pill-height)");
  });

  it("keeps Top rated pill color unchanged on hover", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const hoverRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".home-category-card--pill-rows .home-category-card__genre:hover",
    );

    expect(hoverRule?.toString()).toContain("background: var(--pill-bg)");
  });

  it("lets Top rated cards show the game title without the short description", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeCategoryCard");
    const sectionStart = component.indexOf("function HomeCategorySection");
    const cardSource = component.slice(cardStart, sectionStart);

    // O nome do jogo liga independente da descrição curta (showTitle vs.
    // showSummary), e os dois compartilham o mesmo modificador de respiro.
    expect(cardSource).toContain("showTitle");
    expect(cardSource).toContain("showTitleBlock = showSummary || showTitle");
    expect(cardSource).toContain("home-category-card--with-title");

    const featuredSectionStart = component.indexOf('title={t("home.featuredGames")}');
    const featuredSectionEnd = component.indexOf("/>", featuredSectionStart);
    const featuredSection = component.slice(featuredSectionStart, featuredSectionEnd);
    expect(featuredSection).toContain("showTitle");
    expect(featuredSection).not.toContain("showSummary");
  });

  it("gives the section header real hierarchy over card body copy", () => {
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

    const sectionTitle = declarations.get(".section-header__title");
    expect(sectionTitle?.get("font-size")).toBe("var(--type-size-section)");
    expect(sectionTitle?.get("line-height")).toBe("var(--type-line-section)");
    expect(sectionTitle?.get("font-weight")).toBe("var(--weight-semibold)");
    expect(sectionTitle?.get("color")).toBe("var(--text-primary)");
  });

  it("lays the recommended section out as three inline cards, not a full-bleed banner", () => {
    const css = compile("src/app.scss").css;
    const stylesheet = postcss.parse(css);
    const declarations = new Map<string, Map<string, string>>();
    const selectorRules: Array<{ selector: string; text: string; rule: postcss.Rule }> = [];

    stylesheet.walkRules((rule) => {
      const ruleDeclarations = new Map<string, string>();
      rule.walkDecls((declaration) => {
        ruleDeclarations.set(declaration.prop, declaration.value);
      });
      const existing = declarations.get(rule.selector) ?? new Map<string, string>();
      ruleDeclarations.forEach((value, prop) => existing.set(prop, value));
      declarations.set(rule.selector, existing);
      selectorRules.push({ selector: rule.selector, text: rule.toString(), rule });
    });

    // O rail não sangra mais até a borda da janela: alinha com as seções de
    // baixo.
    const rail = declarations.get(".home-recommended__rail");
    expect(rail?.get("margin-inline")).toBeUndefined();
    expect(rail?.get("width")).toBeUndefined();

    // Base: três cards por tela, largura derivada dos dois gaps entre eles.
    // Janela larga (>=1400px): quatro cards, derivada de três gaps.
    const cardRules = selectorRules.filter(
      (rule) => rule.selector === ".home-recommended__track .home-category-card"
    );
    const cardFlexValues = cardRules.map((rule) =>
      rule.rule.nodes.find((node) => node.type === "decl" && node.prop === "flex")?.toString()
    );
    expect(cardFlexValues).toEqual([
      "flex: 0 0 calc((100% - var(--home-category-gap) * 2) / 3)",
      "flex: 0 0 calc((100% - var(--home-category-gap) * 3) / 4)",
    ]);

    expect(css).not.toContain(".home-recommended__banner");
  });

  it("closes every recommended card at the same height", () => {
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

    const title = declarations.get(".home-category-card__title");
    expect(title?.get("white-space")).toBe("nowrap");
    expect(title?.get("text-overflow")).toBe("ellipsis");

    // Altura fechada, não `max-height`: a short description da Steam vai de uma
    // linha a um parágrafo e a grade não pode variar de altura por causa disso.
    const description = declarations.get(".home-category-card__description");
    expect(description?.get("height")).toBe("calc(var(--type-line-compact) * 2)");
    expect(description?.get("-webkit-line-clamp")).toBe("2");
  });
});
