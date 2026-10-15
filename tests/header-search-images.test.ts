import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "sass-embedded";

describe("miniaturas da busca global", () => {
  it("mostra thumb small capsule + nome por resultado", () => {
    const component = readFileSync("src/components/layout/Header.tsx", "utf8");

    expect(component).toContain("HighlightedSearchText text={game.title}");
    expect(component).toContain("header__search-dropdown-thumbnail");
    expect(component).toContain("gameSmallCapsuleSources");
    expect(component).not.toContain("<Heart");
  });

  it("usa small capsule (capsule_231x87), sem header pesado no dropdown", () => {
    const images = readFileSync("src/utils/image.ts", "utf8");

    expect(images).toContain("gameSmallCapsuleSources");
    expect(images).toContain("capsule_231x87.jpg");
  });

  it("mescla catálogo + loja em paralelo com limite 8", () => {
    const shell = readFileSync("src/hooks/useAppShellState.ts", "utf8");
    const expanded = readFileSync("src/hooks/useExpandedGameSearch.ts", "utf8");

    expect(expanded).toContain("steamSupplement");
    expect(shell).toContain("steamSupplement: true");
    expect(shell).toContain("8");
    expect(shell).not.toMatch(/limit: 6/);
  });

  it("expande suavemente no foco, independente dos efeitos do SO", () => {
    const css = compile("src/app.scss").css;
    const component = readFileSync("src/components/layout/Header.tsx", "utf8");

    // Compacta em repouso, expandida no foco, com transição de `width`.
    expect(css).toMatch(/\.header \{[\s\S]*?--header-search-width: 280px;/);
    expect(css).toMatch(/\.header \{[\s\S]*?--header-search-compact-width: 180px;/);
    expect(css).toMatch(/\.header__search \{[^}]*width: var\(--header-search-compact-width\);/);
    expect(css).toContain(".header__search-shell:focus-within .header__search");
    expect(css).toMatch(/\.t-resize \{[^}]*transition:[^}]*width var\(--resize-dur\)/);
    expect(component).toContain("header__search t-resize");
    // Sem gate do SO: efeitos do Windows desligados não teleportam a caixa.
    // O único `transition: none` do `.t-resize` vive sob `html.no-animations`.
    expect(css).not.toContain(".t-resize { transition: none");
    expect(css).toContain("html.no-animations .t-resize");
    expect(css).toContain("--header-search-width: 300px;");
    expect(css).toContain(".header__search-dropdown-thumbnail");
  });
});
