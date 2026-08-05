import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home recommended banner chevrons", () => {
  it("keeps chevron labels localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");

    expect(source).toContain('recommendedPreviousGame: "Jogo anterior"');
    expect(source).toContain('recommendedNextGame: "Próximo jogo"');
    expect(source).toContain('recommendedPreviousGame: "Previous game"');
    expect(source).toContain('recommendedNextGame: "Next game"');
  });
});
