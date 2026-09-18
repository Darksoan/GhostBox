import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Catalogue view mode toggle", () => {
  const component = readFileSync("src/pages/CataloguePage.tsx", "utf8");
  const list = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");
  const i18n = readFileSync("src/i18n.ts", "utf8");
  const stylesheet = readFileSync("src/app.scss", "utf8");

  it("keeps the view mode labels localized in PT and EN", () => {
    expect(i18n).toContain('label: "Método de visualização"');
    expect(i18n).toContain('list: "Listagem"');
    expect(i18n).toContain('grid: "Grade"');
    expect(i18n).toContain('label: "View mode"');
    expect(i18n).toContain('list: "List"');
    expect(i18n).toContain('grid: "Grid"');
  });

  it("renders a view dropdown in the toolbar and wires it to the list", () => {
    expect(component).toContain("catalogue-page__view");
    expect(component).toContain('t("catalogue.view.label")');
    expect(component).toContain("setViewMode");
    expect(component).toContain("viewMode={viewMode}");
  });

  it("renders grid mode with dedicated catalogue cards", () => {
    expect(list).toContain('viewMode = "list"');
    expect(list).toContain("CatalogueGridCard");
    expect(list).toContain("catalogue-card__button--grid");
    expect(list).toContain("catalogue-card__cover");
    expect(list).toContain("catalogue-card__rating");
    expect(list).not.toContain("catalogue-card__developer");
    expect(list).not.toContain("home-top-rated-card__");
    expect(list).toContain("catalogue-list--cards");
    // A grade própria do catálogo não deve reutilizar a grade de capsules
    // legada (`catalogue-list--grid`), que tem outro visual.
    expect(list).not.toContain("catalogue-list--grid");
  });

  it("uses a page size that fills the fixed grid without orphans", () => {
    const constants = readFileSync("src/constants/catalogue.ts", "utf8");

    expect(constants).toContain("export const cataloguePageSize = 21;");
  });

  it("keeps the cards grid on three fixed-width columns", () => {
    expect(stylesheet).toContain(
      ".catalogue-list--cards {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 460px))"
    );
    expect(stylesheet).not.toContain(
      ".catalogue-list--cards {\n  display: grid;\n  grid-template-columns: repeat(auto-fill"
    );
  });

  it("tracks the cards grid in the stylesheet with semantic tokens only", () => {
    expect(stylesheet).toContain(".catalogue-list--cards");
    expect(stylesheet).toContain(".catalogue-card__actions--overlay");
  });
});
