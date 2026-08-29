import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Catalogue preview shot opens the game modal", () => {
  const component = readFileSync(
    "src/components/ui/CatalogueHoverPreview.tsx",
    "utf8"
  );
  const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
  const stylesheet = readFileSync("src/app.scss", "utf8");

  it("wires the preview shots to the game modal", () => {
    expect(component).toContain("onOpenGame?: (game: GhostBoxGame) => void;");
    expect(component).toContain("catalogue-hover-preview__shot--link");
    expect(component).toContain("onClick={() => onOpenGame?.(displayedGame)}");
    expect(page).toContain("onOpenGame={onOpenGame}");
  });

  it("keeps skeletons and the empty state non-interactive", () => {
    // Só a shot pronta vira botão; skeleton e vazio continuam `<div>`.
    expect(component).toContain(
      '<div className="catalogue-hover-preview__shot catalogue-hover-preview__shot--empty" />'
    );
    expect(component).toContain(
      'className="catalogue-hover-preview__shot catalogue-hover-preview__shot--skeleton skeleton"'
    );
  });

  it("tracks the clickable shot in the stylesheet with semantic tokens", () => {
    expect(stylesheet).toContain("&__shot--link");
  });
});
