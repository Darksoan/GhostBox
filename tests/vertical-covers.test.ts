import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Capas verticais — um único estilo de badge no hover", () => {
  it("usa cantos arredondados e colunas fluidas no estilo do Hydra", () => {
    const styles = readFileSync("src/app.scss", "utf8");

    expect(styles).toContain(
      "grid-template-columns: repeat(auto-fill, minmax(var(--game-grid-track), 1fr));",
    );
    expect(styles).toMatch(
      /&--portrait \{[\s\S]*?--game-grid-track: 180px;/,
    );
    expect(styles).toMatch(
      /\.game-grid--portrait & \{[\s\S]*?aspect-ratio: 2 \/ 3;/,
    );
    expect(styles).toMatch(
      /\.game-grid--portrait \.game-card,[\s\S]*?border-radius: var\(--radius-sm\);/,
    );
  });

  it("mantém o badge oculto em repouso e revela somente na interação", () => {
    const styles = readFileSync("src/app.scss", "utf8");

    expect(styles).toMatch(
      /&__achievement-badges \{[\s\S]*?opacity: 0;[\s\S]*?\}/,
    );
    expect(styles).toMatch(
      /&:hover &__achievement-badges,[\s\S]*?opacity: 1;/,
    );
    expect(styles).not.toContain("__playtime-badge");
  });

  it("abandona o badge de progresso só-dos-favoritos em favor do compartilhado", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const favorites = readFileSync("src/pages/FavoritesPage.tsx", "utf8");
    const loading = readFileSync("src/components/ui/LoadingStates.tsx", "utf8");

    expect(favorites).not.toContain("favorites-grid__achievement-progress");
    expect(loading).not.toContain("favorites-grid__achievement-progress");

    // A aba de coleção reusa o `GameCard` da biblioteca, que já desenha
    // `game-card__achievement-badges` quando `showAchievements` está ligado.
    const card = readFileSync("src/components/ui/GameCard.tsx", "utf8");
    expect(card).toContain("game-card__achievement-badges");
    expect(card).toContain("game-card__achievement-progress");
    expect(favorites).toContain("showAchievements");
  });
});
