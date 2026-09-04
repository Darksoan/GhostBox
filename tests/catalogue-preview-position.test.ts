import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/**
 * O catálogo passou a ter os filtros numa barra horizontal no topo e o preview
 * fixado na coluna da direita — a faixa que antes era da barra lateral de
 * filtros. Estes testes cobrem esse arranjo; o cálculo de coordenada que o
 * preview flutuante usava saiu junto com ele.
 */
describe("catalogue preview column", () => {
  const css = compile("src/app.scss").css;
  const stylesheet = postcss.parse(css);

  const ruleFor = (selector: string) =>
    stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === selector
    );

  it("pins the preview column to the scrollport instead of the viewport", () => {
    const column = ruleFor(".catalogue-preview-column");

    expect(column?.toString()).toContain("position: sticky");
    // A coluna é quem prende; o painel dentro dela não posiciona nada.
    expect(ruleFor(".catalogue-hover-preview")?.toString()).not.toContain(
      "position: fixed"
    );
  });

  it("stacks the panel and the idle hint in one grid cell", () => {
    // Empilhados, o painel montado durante a transição de saída não empurra a
    // dica para fora da coluna.
    expect(ruleFor(".catalogue-preview-column")?.toString()).toContain(
      "display: grid"
    );
    expect(css).toContain(".catalogue-preview-column__idle");
  });

  it("renders the preview inside the column, not in a portal", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).not.toContain("createPortal");
    expect(component).not.toContain("computeCataloguePreviewPosition");
    // Nada de perseguir o cursor: sem listener de movimento.
    expect(component).not.toContain("pointermove");
  });

  it("mounts the preview in the catalogue preview column", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const asideBlock = page.slice(
      page.indexOf("<aside"),
      page.indexOf("</aside>")
    );

    expect(asideBlock).toContain("catalogue-preview-column");
    expect(asideBlock).toContain("CatalogueHoverPreview");
  });

  it("hides the preview and expands results in grid mode", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain('viewMode === "grid" ? " catalogue-page__content--grid"');
    expect(page).toContain('viewMode === "list" && (');
    expect(ruleFor(".catalogue-page__content--grid")?.toString()).toContain(
      "grid-template-columns: minmax(0, 1fr)"
    );
  });

  it("still reports the hovered card so the list contract is unchanged", () => {
    const list = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(list).toContain("anchor: itemRef.current");
  });
});

describe("catalogue filter bar", () => {
  const css = compile("src/app.scss").css;
  const stylesheet = postcss.parse(css);

  it("lays the filters out horizontally", () => {
    const bar = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".catalogue-filterbar"
    );

    expect(bar?.toString()).toContain("display: flex");
  });

  it("never clips the facet panels behind an overflow on the bar", () => {
    // Os painéis são filhos absolutos da pílula. Declarar `overflow-x` faz o
    // `overflow-y` computar como `auto` mesmo escrito `visible` (CSS Overflow
    // 3, §3), a barra vira scroller e o painel abre recortado — invisível.
    const bar = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ".catalogue-filterbar"
    );

    expect(bar?.toString()).not.toContain("overflow");
  });

  it("shares one toolbar row with the sort control", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const toolbar = page.slice(
      page.indexOf('className="catalogue-page__toolbar"'),
      page.indexOf('className="catalogue-page__content"')
    );

    expect(toolbar).toContain('className="catalogue-filterbar"');
    expect(toolbar).toContain("catalogue-page__sort");
  });

  it("matches the radius of the page's other controls", () => {
    const pill = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" && node.selector === ".catalogue-filter-section"
    );
    const panel = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-filter-section__content"
    );

    expect(pill?.toString()).toContain("border-radius: var(--radius-md)");
    expect(panel?.toString()).toContain("border-radius: var(--radius-md)");
  });

  it("opens each facet as a floating panel anchored to its pill", () => {
    const panel = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".catalogue-filter-section__content"
    );

    expect(panel?.toString()).toContain("position: absolute");
    expect(panel?.toString()).toContain("z-index: var(--z-popover)");
  });

  it("renders the facets in the top bar and drops the sidebar drawer", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");

    expect(page).toContain('className="catalogue-filterbar"');
    expect(page).not.toContain("catalogue-filters-backdrop");
    expect(page).not.toContain("catalogue-filters__mobile-header");
    expect(page).not.toContain("catalogue-page__filters-toggle");
    // O painel sai do DOM ao fechar em vez de colapsar para altura zero.
    expect(page).not.toContain('data-collapsed');
  });

  it("leaves no dead styles from the removed filters sidebar", () => {
    for (const selector of [
      ".catalogue-filters-backdrop",
      ".catalogue-filters__mobile-header",
      ".catalogue-filters__sections",
      ".catalogue-page__filters-toggle",
    ]) {
      expect(css).not.toContain(selector);
    }
  });
});
