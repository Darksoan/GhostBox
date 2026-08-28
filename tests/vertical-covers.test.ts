import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Capas verticais — um único estilo de badge no hover", () => {
  it("abandona o badge de progresso só-dos-favoritos em favor do compartilhado", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const favorites = readFileSync("src/pages/FavoritesPage.tsx", "utf8");
    const loading = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");

    for (const source of [styles, favorites, loading]) {
      expect(source).not.toContain("achievement-progress");
    }

    // A aba de coleção reusa o `GameCard` da biblioteca, que já desenha
    // `game-card__achievement-badges` quando `showAchievements` está ligado.
    const card = readFileSync("src/components/ui/GameCard.tsx", "utf8");
    expect(card).toContain("game-card__achievement-badges");
    expect(favorites).toContain("showAchievements");
  });
});
