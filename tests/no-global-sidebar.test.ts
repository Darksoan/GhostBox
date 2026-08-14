import { existsSync, readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Sidebar global removida", () => {
  it("os arquivos não existem mais", () => {
    expect(existsSync("src/components/layout/Sidebar.tsx")).toBe(false);
    expect(existsSync("src/hooks/useWideViewport.ts")).toBe(false);
  });

  it("o App não troca mais de layout de navegação", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toContain("Sidebar");
    expect(app).not.toContain("useWideViewport");
    expect(app).not.toContain("isFloatingNavLayout");
  });

  it("a página ganha respiro simétrico, já sem a sidebar à esquerda", () => {
    const css = postcss.parse(compile("src/app.scss").css);
    let padding: string | undefined;
    css.walkRules((rule) => {
      if (rule.selector !== ".page") return;
      rule.walkDecls("padding", (declaration) => {
        padding = declaration.value;
      });
    });
    expect(padding).toBe("0 var(--space-6)");
  });
});
