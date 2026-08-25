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
    // Rampa estrutural renomeada de --n-* para --c-* (primitivos de COR).
    expect(customProperties.get("--surface-canvas")).toBe("var(--c-0)");
    expect(customProperties.get("--c-0")).toBe("#0a0a0a");
    expect(customProperties.get("--surface-sidebar")).toBe("var(--c-1)");
    expect(customProperties.get("--surface-titlebar")).toBe("var(--surface-canvas)");
    expect(customProperties.get("--c-1")).toBe("#101010");
    // Navegação clareia: sidebar sobe no hover e sobe de novo quando selecionada.
    expect(customProperties.get("--sidebar-option-hover")).toBe("var(--c-3)");
    expect(customProperties.get("--c-3")).toBe("#151515");
    expect(customProperties.get("--sidebar-option-selected")).toBe("var(--c-4)");
    expect(customProperties.get("--c-4")).toBe("#1a1a1a");
    // Conteúdo usa degrau seguinte no hover, mantendo separação da base.
    expect(customProperties.get("--surface-option")).toBe("var(--c-1)");
    expect(customProperties.get("--surface-option-hover")).toBe("var(--c-2)");
    expect(declarations.get(".sidebar")?.get("background")).toBe("var(--surface-sidebar)");
    // O card de plano se define por superfície + raio; nenhuma borda é
    // declarada (a antiga regra `border: 0` saiu junto com o reset).
    expect(declarations.get(".subscription-plan-card")?.get("border")).toBeUndefined();
    expect(declarations.get(".app-main")?.get("background")).toBe("var(--app-gradient)");
    expect(declarations.get(".header")?.get("background-color")).toBe("var(--surface-titlebar)");
    expect(declarations.get(".home-page")?.get("background")).toBe("var(--background-dark)");
  });

  it("removes the rated percentage and gives Home pills the full metadata row", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    // `HomeCategorySection` foi absorvida pelo rail genérico (`Shelf`); o fim do
    // card é a próxima declaração de função de topo no arquivo.
    const cardStart = component.indexOf("function HomeCategoryCard");
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    expect(cardStart).toBeGreaterThanOrEqual(0);
    expect(cardEnd).toBeGreaterThan(cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

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
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

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

  it("keeps the Top rated pill hover on the same step as the card hover", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const customProperties = new Map<string, string>();
    stylesheet.walkRules((rule) => {
      if (rule.selector !== ":root") return;
      rule.walkDecls((declaration) => {
        if (declaration.prop.startsWith("--")) {
          customProperties.set(declaration.prop, declaration.value);
        }
      });
    });

    const hoverRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".home-category-card--pill-rows .home-category-card__genre:hover",
    );

    // A pill é rótulo, não segundo botão: o hover direto dela pinta o mesmo
    // degrau estrutural (--c-4) que o hover do card aplica via --pill-bg-hover.
    // Nenhuma cor fora desse par repouso/elevação.
    expect(customProperties.get("--pill-bg")).toBe("var(--c-3)");
    expect(customProperties.get("--pill-bg-hover")).toBe("var(--c-4)");
    expect(hoverRule?.toString()).toContain("background: var(--c-4)");
  });

  it("wires the title toggle independently from the short description", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeCategoryCard");
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

    // O nome do jogo liga independente da descrição curta (showTitle vs.
    // showSummary), e os dois compartilham o mesmo modificador de respiro.
    expect(cardSource).toContain("showTitle");
    expect(cardSource).toContain("showTitleBlock = showSummary || showTitle");
    expect(cardSource).toContain("home-category-card--with-title");

    // Top rated renderiza o HomeTopRatedCard (arte + selo do Metacritic, nome,
    // grade de métricas e pills), sem reaproveitar as props de descrição da
    // grade.
    const shelfStart = component.indexOf("function HomeTopRatedShelf");
    const shelfEnd = component.indexOf("\nfunction ", shelfStart);
    const shelfSource = component.slice(shelfStart, shelfEnd);
    expect(shelfSource).toContain("<HomeTopRatedCard");
    expect(shelfSource).not.toContain("showSummary");
  });

  it("keeps the card to title and pills — no badge nor description", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeTopRatedCard");
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

    // Sem badge de popularidade e sem descrição curta: o card carrega só o
    // nome e a linha de pills. O corpo não reserva bloco de resumo.
    expect(cardSource).not.toContain("home-top-rated-card__players");
    expect(cardSource).not.toContain("home-top-rated-card__summary");
    expect(cardSource).not.toContain("home-top-rated-card__summary-line");
    expect(cardSource).not.toContain("home-top-rated-card__metric-value--skeleton");
    expect(cardSource).not.toContain("home-top-rated-card__metric-value--empty");
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
