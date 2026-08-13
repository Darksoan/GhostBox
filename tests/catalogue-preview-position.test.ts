import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_PREVIEW_BOTTOM_SAFE_AREA,
  CATALOGUE_PREVIEW_COLUMN_OVERLAP_RATIO,
  CATALOGUE_PREVIEW_VIEWPORT_MARGIN,
  computeCataloguePreviewPosition,
} from "../src/utils/cataloguePreview";

const viewport = { width: 1440, height: 900 };
const preview = { width: 340, height: 300 };
const column = { left: 1040, width: 340 };

describe("catalogue preview placement", () => {
  it("parks in the same right-hand strip, overlapping the filters column", () => {
    const card = { top: 300, left: 80, width: 860, height: 120 };
    const position = computeCataloguePreviewPosition({
      card,
      column,
      preview,
      viewport,
    });

    const rightEdge = position.left + preview.width;
    expect(rightEdge).toBe(
      column.left + column.width * CATALOGUE_PREVIEW_COLUMN_OVERLAP_RATIO
    );
    // Cobre um pedaço dos filtros, mas não chega na borda direita deles.
    expect(rightEdge).toBeGreaterThan(column.left);
    expect(rightEdge).toBeLessThan(column.left + column.width);
  });

  it("keeps the same horizontal strip whatever card is hovered", () => {
    const first = computeCataloguePreviewPosition({
      card: { top: 200, left: 80, width: 860, height: 120 },
      column,
      preview,
      viewport,
    });
    const second = computeCataloguePreviewPosition({
      card: { top: 640, left: 80, width: 860, height: 120 },
      column,
      preview,
      viewport,
    });

    expect(second.left).toBe(first.left);
    expect(second.top).not.toBe(first.top);
  });

  it("centres the panel on the hovered card", () => {
    const card = { top: 300, left: 80, width: 860, height: 120 };

    expect(
      computeCataloguePreviewPosition({ card, column, preview, viewport }).top
    ).toBe(card.top + card.height / 2 - preview.height / 2);
  });

  it("falls back to the cursor when the card was not measured", () => {
    expect(
      computeCataloguePreviewPosition({
        pointer: { x: 400, y: 500 },
        column,
        preview,
        viewport,
      }).top
    ).toBe(500 - preview.height / 2);
  });

  it("falls back to the viewport edge without a filters column", () => {
    const position = computeCataloguePreviewPosition({
      card: { top: 300, left: 80, width: 860, height: 120 },
      preview,
      viewport,
    });

    expect(position.left + preview.width).toBe(
      viewport.width - CATALOGUE_PREVIEW_VIEWPORT_MARGIN
    );
  });

  it("leaves the bottom strip free for the filter dropdown", () => {
    const position = computeCataloguePreviewPosition({
      card: { top: 840, left: 80, width: 860, height: 120 },
      column,
      preview,
      viewport,
    });

    expect(position.top + preview.height).toBeLessThanOrEqual(
      viewport.height -
        CATALOGUE_PREVIEW_VIEWPORT_MARGIN -
        CATALOGUE_PREVIEW_BOTTOM_SAFE_AREA
    );
  });

  it("never rides above the header", () => {
    const topBoundary = 52 + CATALOGUE_PREVIEW_VIEWPORT_MARGIN;

    expect(
      computeCataloguePreviewPosition({
        card: { top: -40, left: 80, width: 860, height: 120 },
        column,
        preview,
        viewport,
        topBoundary,
      }).top
    ).toBe(topBoundary);
  });

  it("pins to the header when the panel is taller than the free space", () => {
    const topBoundary = 68;

    expect(
      computeCataloguePreviewPosition({
        card: { top: 400, left: 80, width: 860, height: 120 },
        column,
        preview: { width: 340, height: 880 },
        viewport,
        topBoundary,
      }).top
    ).toBe(topBoundary);
  });
});

describe("catalogue preview anchoring wiring", () => {
  it("renders the panel outside the filters sidebar", () => {
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const asideBlock = page.slice(
      page.indexOf("<aside"),
      page.indexOf("</aside>")
    );

    expect(asideBlock).not.toContain("CatalogueHoverPreview");
    expect(page).toContain("columnRef={filtersColumnRef}");
    expect(page).toContain("ref={filtersColumnRef}");
  });

  it("passes the hovered card as the anchor", () => {
    const list = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(list).toContain("anchor: itemRef.current");
  });

  it("places the panel once and leaves it parked", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("createPortal");
    expect(component).toContain("computeCataloguePreviewPosition");
    // Nada de perseguir o cursor: sem listener de movimento.
    expect(component).not.toContain("pointermove");
  });

  it("pins the panel to the viewport above the listing", () => {
    const previewRule = postcss
      .parse(compile("src/app.scss").css)
      .nodes.find(
        (node) =>
          node.type === "rule" && node.selector === ".catalogue-hover-preview"
      );

    expect(previewRule?.toString()).toContain("position: fixed");
    // Acima da listagem, abaixo dos modais: um card clicado abre o modal por
    // cima do preview que ainda está saindo.
    expect(previewRule?.toString()).toContain("z-index: var(--z-overlay)");
  });
});
