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

  it("mantém a largura expandida por padrão, sem expansão ao foco", () => {
    const css = compile("src/app.scss").css;
    const component = readFileSync("src/components/layout/Header.tsx", "utf8");

    expect(css).toMatch(/\.header \{[\s\S]*?--header-search-width: 280px;/);
    expect(css).toMatch(/\.header__search \{[^}]*width: var\(--header-search-width\);/);
    expect(css).not.toContain("header__search--focused");
    expect(css).not.toContain("--header-search-rest-width");
    expect(css).toMatch(/\.header__search-dropdown \{[\s\S]*?width: var\(--header-search-width\);/);
    expect(css).toContain("--header-search-width: 300px;");
    expect(component).not.toContain("header__search--focused");
  });
});
