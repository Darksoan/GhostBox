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

  it("keeps failed and empty slots non-interactive", () => {
    // Só a shot pronta vira botão; slots esgotados continuam `<div>`.
    expect(component).toContain("catalogue-hover-preview__shot--empty");
    expect(component).toContain('shot.status === "ready" && shot.source');
    expect(component).not.toContain("catalogue-hover-preview__shot--skeleton");
  });

  it("tracks the clickable shot in the stylesheet with semantic tokens", () => {
    expect(stylesheet).toContain("&__shot--link");
  });
});
