import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "sass-embedded";

describe("miniaturas da busca global", () => {
  it("mostra somente o nome, sem carregar arte ou ícones por resultado", () => {
    const component = readFileSync("src/components/layout/Header.tsx", "utf8");

    expect(component).toContain("HighlightedSearchText text={game.title}");
    expect(component).not.toContain("useCachedImageSources");
    expect(component).not.toContain("useLoadableImageCover");
    expect(component).not.toContain("header__search-dropdown-thumbnail");
    expect(component).not.toContain("<Heart");
  });

  it("expande ao foco até a largura dos resultados e mantém o tamanho antigo em repouso", () => {
    const css = compile("src/app.scss").css;

    expect(css).toMatch(/\.header \{[\s\S]*?--header-search-width: 280px;/);
    expect(css).toMatch(/\.header__search \{[^}]*width: var\(--header-search-rest-width\);/);
    expect(css).toMatch(/\.header__search--focused \{[^}]*width: var\(--header-search-width\);/);
    expect(css).toMatch(/\.header__search-dropdown \{[\s\S]*?width: var\(--header-search-width\);/);
    expect(css).toContain("--header-search-width: 300px;");
    expect(css).toContain("--header-search-rest-width: 200px;");
    expect(css).toContain("--header-search-rest-width: 220px;");
    expect(css).toContain("--header-search-rest-width: 190px;");
  });
});
