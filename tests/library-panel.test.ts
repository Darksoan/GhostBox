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
