import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("detalhes públicos de jogos para visitantes", () => {
  const modal = readFileSync("src/components/modals/GameModal.tsx", "utf8");
  const achievementsPage = readFileSync("src/pages/GameAchievementsPage.tsx", "utf8");

  it("não bloqueia conquistas no modal nem na página completa por login", () => {
    for (const source of [modal, achievementsPage]) {
      expect(source).not.toContain("useMetricsUnlocked");
      expect(source).not.toContain("metrics.lockedAchievements");
    }
    expect(modal).not.toContain("modal__achievements-grid--locked");
    expect(modal).not.toContain("modal__achievements-locked-overlay");
    expect(modal).toContain("{hasMoreAchievements && onViewAchievements && (");
  });

  it("usa a capa como fallback quando hero e screenshot não carregam", () => {
    expect(modal).toContain("modalHeroSources[0] || heroScreenshotFallback || displayGame.coverUrl || displayGame.cover");
    expect(modal).toContain("uniqueSources([...heroCandidates, ...screenshotFallback, displayGame?.coverUrl, displayGame?.cover, ...(displayGame?.coverFallbacks ?? [])])");
  });
});
