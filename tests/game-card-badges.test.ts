import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/app.scss", import.meta.url), "utf8");
const componentSource = readFileSync(
  new URL("../src/components/ui/GameCard.tsx", import.meta.url),
  "utf8",
);

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
  it("usa o resumo da conta como piso mesmo quando o schema já tem lista", () => {
    expect(componentSource).toContain("getUnlockedAchievementCount(game)");
    expect(componentSource).toContain("getAchievementTotal(game)");
    expect(componentSource).toContain("hasAvailableAchievements(game)");
    expect(componentSource).not.toContain(
      "achievementListTotal > 0",
    );
  });

  it("não mostra o badge quando o jogo não tem conquistas disponíveis", () => {
    expect(componentSource).toContain("const hasAchievementBadge =");
    expect(componentSource).toContain(
      "showAchievements && hasAvailableAchievements(game)",
    );
    expect(componentSource).toContain(
      "hasAchievementBadge && !showLockedBadge",
    );
  });

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

  it("mostra o preenchimento final sem animação de loading", () => {
    const progress = blockOf("&__achievement-progress {");
    expect(progress).toContain("transform-origin: left center;");
    expect(progress).toContain(
      "transition: none;",
    );
    expect(componentSource).toContain(
      "transform: `scaleX(${achievementProgress / 100})`",
    );
  });

  it("renderiza texto completo sem reticências nas contagens", () => {
    const summary = blockOf("&__summary-metric {");

    expect(summary).not.toContain("text-overflow: ellipsis;");
    expect(summary).not.toContain("flex: 0 1 auto;");
  });
});
