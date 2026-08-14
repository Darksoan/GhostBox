import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Card flutuante removido", () => {
  it("os arquivos do card não existem mais", () => {
    expect(existsSync("src/components/layout/FloatingNav.tsx")).toBe(false);
    expect(existsSync("src/components/layout/FloatingNav.scss")).toBe(false);
  });

  it("o App não renderiza mais o card", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    // `isFloatingNavLayout` sobrevive (a Sidebar ainda depende dela até a
    // Task 10 removê-la); o que precisa sumir é o componente do card em si.
    expect(app).not.toContain("components/layout/FloatingNav");
    expect(app).not.toContain("<FloatingNav");
    expect(app).not.toContain("app-main--floating-nav");
  });

  // Herdado de `tests/floating-nav.test.ts`, que este passo deleta: sem isto o
  // guarda-corpo do desacoplamento da Task 8 sumiria junto com o arquivo.
  it("o GameModal não procura mais o card no DOM", () => {
    const modal = readFileSync("src/components/modals/GameModal.tsx", "utf8");
    expect(modal).not.toContain('querySelector(".floating-nav")');
    expect(modal).not.toContain("floatingNavTop");
    expect(modal).not.toContain("floatingNavGapPx");
    expect(modal).toContain("sidebarBottom");
  });
});
