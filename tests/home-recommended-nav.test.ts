import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Home recommended grid chevrons", () => {
  it("keeps chevron labels localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");

    expect(source).toContain('recommendedPreviousGame: "Jogo anterior"');
    expect(source).toContain('recommendedNextGame: "Próximo jogo"');
    expect(source).toContain('recommendedPreviousGame: "Previous game"');
    expect(source).toContain('recommendedNextGame: "Next game"');
  });

  it("drives the recommended rail through the shared Shelf carousel", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const shelf = readFileSync("src/components/ui/Shelf.tsx", "utf8");

    expect(component).toContain('blockName="home-recommended"');
    // O padrão de 5 esconderia as setas com o pool atual de 4 jogos.
    expect(component).toContain(
      "minItemsForControls={homeRecommendedCardCount}"
    );

    // A rolagem vem do Shelf, o mesmo componente do rail de explorar: voo
    // determinístico via rAF (duração/easing fixos) em vez do `smooth` nativo,
    // cuja duração varia com a distância e alternava a velocidade.
    expect(shelf).toContain("ChevronLeft");
    expect(shelf).toContain("ChevronRight");
    expect(shelf).toContain("requestAnimationFrame");
    expect(shelf).toContain("SHELF_SCROLL_DURATION_MS");
    expect(shelf).toContain("__carousel--animating");
    expect(shelf).not.toContain('behavior: "smooth"');
    expect(shelf).toContain("__arrow--prev");
    expect(shelf).toContain("__arrow--next");
  });

  it("scrolls the rail smoothly and keeps the chevrons clear of the cards", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const shelf = readFileSync("src/components/ui/Shelf.tsx", "utf8");
    const selectors: string[] = [];
    const mediaQueries: string[] = [];
    const declarations = new Map<string, Map<string, string>>();

    stylesheet.walkRules((rule) => {
      selectors.push(...(rule.selectors ?? []));
      const ruleDeclarations = declarations.get(rule.selector) ?? new Map<string, string>();
      rule.walkDecls((declaration) => {
        ruleDeclarations.set(declaration.prop, declaration.value);
      });
      declarations.set(rule.selector, ruleDeclarations);
    });
    stylesheet.walkAtRules("media", (rule) => mediaQueries.push(rule.params));

    expect(selectors).toContain(".home-recommended__arrow");
    expect(selectors).toContain(".home-recommended__arrow--prev");
    expect(selectors).toContain(".home-recommended__arrow--next");

    // A animação de rolamento é do JS (`Shelf`, rAF com duração/easing fixos),
    // igual ao rail de explorar. Lê a regra de topo, não o mapa acumulado: o
    // override do toggle interno usa outro seletor e não sobrescreveria o
    // valor aqui.
    const carouselRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".home-recommended__carousel"
    );
    expect(carouselRule?.toString()).toContain("scroll-behavior: auto");
    expect(carouselRule?.toString()).toContain("scroll-snap-type: x proximity");

    // O voo programático ignora efeitos do SO desligados: o `Shelf` só congela
    // pelo toggle interno (`html.no-animations`), nunca por `matchMedia` do
    // sistema. O CSS trava `auto` no bloco do toggle como trava extra.
    expect(shelf).toContain("no-animations");
    expect(shelf).not.toContain("prefers-reduced-motion");
    const animationsOff = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        typeof node.selector === "string" &&
        node.selector.includes("html.no-animations") &&
        node.toString().includes(".home-recommended__carousel")
    );
    expect(animationsOff?.toString()).toContain("scroll-behavior: auto");

    // Deslocamento negativo: a seta cai no inset de 36px da seção, fora da
    // grade, em vez de sobrepor o primeiro/último card.
    expect(declarations.get(".home-recommended__arrow--prev")?.get("left")).toBe(
      "-28px"
    );
    expect(declarations.get(".home-recommended__arrow--next")?.get("right")).toBe(
      "-28px"
    );

    // Sem pílula escura por cima da arte — o rail de explorar usa fundo
    // transparente e a cor do ícone é o único feedback.
    const arrowRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".home-recommended__arrow"
    );
    expect(arrowRule?.toString()).toContain("background: transparent");
    expect(arrowRule?.toString()).not.toContain("opacity: 0");
    expect(arrowRule?.toString()).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
