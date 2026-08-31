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
  it("enche a capa horizontalmente para contagens altas caberem sem espremer", () => {
    const badge = blockOf("&__achievement-badges {");
    expect(badge).toContain("max-width: calc(100% - var(--space-4));");
    expect(badge).toContain("gap: var(--space-5);");
    expect(badge).toContain("padding: var(--space-3) var(--space-4);");
  });

  it("coloca o texto mais perto do ícone (gap ícone→texto menor)", () => {
    const summary = blockOf("&__summary-metric {");
    expect(summary).toContain("gap: var(--space-1);");
  });

  it("renderiza texto completo sem reticências nas contagens", () => {
    const summary = blockOf("&__summary-metric {");

    expect(summary).not.toContain("text-overflow: ellipsis;");
    expect(summary).not.toContain("flex: 0 1 auto;");
  });
});