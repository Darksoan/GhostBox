import { compile } from "sass-embedded";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("LibraryPanel — estrutura", () => {
  const source = readFileSync(
    "src/components/library/LibraryPanel.tsx",
    "utf8"
  );

  it("mostra a contagem de cada grupo", () => {
    expect(source).toContain("library-panel__group-count");
  });

  it("expande e recolhe cada grupo", () => {
    expect(source).toContain("aria-expanded");
    expect(source).toContain("expandedGroupIds");
  });

  it("tem grupo derivado de sem categoria", () => {
    expect(source).toContain("uncategorizedCount");
  });
});

describe("LibraryPanel — estilos", () => {
  const css = postcss.parse(compile("src/app.scss").css);

  const declsFor = (selector: string) => {
    const found = new Map<string, string>();
    css.walkRules((rule) => {
      if (rule.selector !== selector) return;
      rule.walkDecls((declaration) => {
        found.set(declaration.prop, declaration.value);
      });
    });
    return found;
  };

  it("tem largura fixa, como a referência", () => {
    expect(declsFor(".library-panel").get("width")).toBeDefined();
  });

  it("separa visualmente um grupo do outro", () => {
    expect(declsFor(".library-panel__group + .library-panel__group").get(
      "border-top"
    )).toContain("var(--border-subtle)");
  });
});

describe("LibraryPanel — ligação com a página", () => {
  const page = readFileSync("src/pages/LibraryPage.tsx", "utf8");

  it("a página monta o painel", () => {
    expect(page).toContain("<LibraryPanel");
  });

  it("os chips de coleção da toolbar saíram", () => {
    expect(page).not.toContain("library-toolbar__chips");
  });

  it("criar e excluir coleção chegam até o painel", () => {
    expect(page).toContain("onCreateCollection");
    expect(page).toContain("onDeleteCollection");
  });

  it("a contagem de sem categoria é derivada na página", () => {
    expect(page).toContain("uncategorizedCount");
  });

  it("filtra de verdade ao selecionar sem categoria", () => {
    // Sem este ramo o grupo derivado não casa com nenhuma coleção e a lista
    // passa inteira, dando a impressão de que o filtro não fez nada.
    expect(page).toContain("UNCATEGORIZED_GROUP_ID");
    expect(page).toContain("claimedGameKeys");
  });
});

describe("LibraryPanel — menu de contexto por jogo", () => {
  const panelSource = readFileSync(
    "src/components/library/LibraryPanel.tsx",
    "utf8"
  );
  const page = readFileSync("src/pages/LibraryPage.tsx", "utf8");

  it("o painel aceita e liga onGameContextMenu ao botão de jogo", () => {
    expect(panelSource).toContain("onGameContextMenu");
    expect(panelSource).toContain("onContextMenu={(event) => {");
  });

  it("a página repassa o handler existente do grid principal", () => {
    // Reaproveita `handleGameContextMenu`/`collectionContextMenuItems` já
    // usados pelo <ContextMenu> do grid principal, em vez de duplicar a
    // lógica do `useGameContextMenu` da Sidebar.
    expect(page).toContain("onGameContextMenu={handleGameContextMenu}");
  });
});
