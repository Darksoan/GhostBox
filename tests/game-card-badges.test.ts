import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/app.scss", import.meta.url), "utf8");

/** Retorna o bloco `{ ... }` que segue o primeiro `needle`, com o seletor. */
function blockOf(needle: string): string {
  const selectorIndex = source.indexOf(needle);
  expect(selectorIndex).toBeGreaterThan(-1);

  const braceOpen = source.indexOf("{", selectorIndex);
  let depth = 0;
  let end = -1;
  for (let index = braceOpen; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  expect(end).toBeGreaterThan(-1);
  return source.slice(selectorIndex, end);
}

describe("badge de conquistas/horas das capas", () => {
  it("mantém a faixa de conquistas alinhada com a largura da capa", () => {
    const badge = blockOf("&__achievement-badges {");
    expect(badge).toContain("left: 0;");
    expect(badge).toContain("right: 0;");
    expect(badge).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(badge).toContain("gap: var(--space-2) var(--space-5);");
    expect(badge).toContain("padding: 0 var(--space-4);");
  });

  it("coloca o texto mais perto do ícone (gap ícone→texto menor)", () => {
    const summary = blockOf("&__summary-metric {");
    expect(summary).toContain("gap: var(--space-1);");
  });

  it("anima o enchimento da barra quando a contagem atualiza no hover", () => {
    const progress = blockOf("&__achievement-progress {");
    expect(progress).toContain(
      "transition: width var(--motion-base) var(--ease);",
    );
  });

  it("renderiza texto completo sem reticências nas contagens", () => {
    const summary = blockOf("&__summary-metric {");

    expect(summary).not.toContain("text-overflow: ellipsis;");
    expect(summary).not.toContain("flex: 0 1 auto;");
  });
});
