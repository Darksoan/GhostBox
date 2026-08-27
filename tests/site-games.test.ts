import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bannerGame, games } from "../GhostBoxSite/src/content/games.generated";

const PUBLIC_DIR = join(process.cwd(), "GhostBoxSite", "public");

/** `/games/x.webp` → caminho no disco. */
function assetPath(url: string) {
  return join(PUBLIC_DIR, url.replace(/^\//, ""));
}

describe("vitrine de jogos do site", () => {
  it("tem jogos suficientes para todas as visões do mockup", () => {
    // A visão da Biblioteca desenha 12 capas; abaixo disso a grade fica furada.
    expect(games.length).toBeGreaterThanOrEqual(12);
  });

  it("não repete appId", () => {
    const appIds = games.map((game) => game.appId);
    expect(new Set(appIds).size).toBe(appIds.length);
  });

  it("aponta só para imagens que existem em public/games", () => {
    for (const game of games) {
      const urls = [game.header, game.portrait, game.hero, ...(game.screenshots ?? [])].filter(
        Boolean,
      ) as string[];
      for (const url of urls) {
        expect(url, game.title).toMatch(/^\/games\/\d+-(header|portrait|hero|shot\d)\.webp$/);
        expect(existsSync(assetPath(url)), `${game.title}: ${url}`).toBe(true);
      }
    }
  });

  it("traz nota da Steam nos jogos que a vitrine mostra em destaque", () => {
    // As prateleiras da Home e a prévia do Catálogo exibem a nota; sem ela o
    // card fica com um buraco no lugar do número.
    for (const game of games.slice(0, 8)) {
      expect(game.rating, game.title).toMatch(/^[0-5]\.\d$/);
    }
  });

  it("descreve cada jogo com título, estúdio e gêneros", () => {
    for (const game of games) {
      expect(game.title.trim(), game.appId).not.toBe("");
      expect(game.developer.trim(), game.title).not.toBe("");
      expect(game.genres.length, game.title).toBeGreaterThan(0);
    }
  });

  it("tem um jogo de banner com library_hero", () => {
    expect(bannerGame.hero).toBeTruthy();
    expect(existsSync(assetPath(bannerGame.hero!))).toBe(true);
  });
});
