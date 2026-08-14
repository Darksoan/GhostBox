import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  allNavigation,
  primaryNavigation,
  secondaryNavigation,
} from "../src/components/layout/navigationItems";

describe("TopNav — itens de navegação", () => {
  it("mantém as cinco páginas, na ordem", () => {
    expect(allNavigation.map((item) => item.id)).toEqual([
      "home",
      "catalogue",
      "library",
      "downloads",
      "settings",
    ]);
  });

  it("dá a todo item uma chave de tradução e um ícone", () => {
    for (const item of [...primaryNavigation, ...secondaryNavigation]) {
      expect(item.labelKey).toMatch(/^nav\./);
      expect(item.icon).toBeTruthy();
    }
  });
});

describe("TopNav — componente", () => {
  const source = readFileSync("src/components/layout/TopNav.tsx", "utf8");

  it("reaproveita a lista compartilhada em vez de repetir as páginas", () => {
    expect(source).toContain('from "./navigationItems"');
    expect(source).not.toMatch(/id:\s*"home"/);
  });

  it("mostra o badge de downloads a partir do gerenciador, não de prop", () => {
    expect(source).toContain("getActiveDownloadCount");
    expect(source).toContain("downloadTasksChangedEvent");
  });

  it("marca a aba ativa para leitores de tela", () => {
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
  });
});

describe("TopNav — montagem no header", () => {
  const header = readFileSync("src/components/layout/Header.tsx", "utf8");

  it("fica entre o bloco da esquerda e o de ações", () => {
    const left = header.indexOf("header__section--left");
    const nav = header.indexOf("<TopNav");
    const actions = header.indexOf("header__section--actions");

    expect(nav).toBeGreaterThan(left);
    expect(nav).toBeLessThan(actions);
  });

  it("leva o perfil para o bloco de ações", () => {
    expect(header).toContain("<NavProfile");
  });
});

describe("TopNav — estilos", () => {
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

  it("usa o texto terciário no inativo e o primário no ativo", () => {
    expect(declsFor(".top-nav__tab").get("color")).toBe("var(--text-tertiary)");
    expect(declsFor(".top-nav__tab--active").get("color")).toBe(
      "var(--text-primary)"
    );
  });

  it("carrega o estado ativo no sublinhado, já que o sistema não tem cor de destaque", () => {
    expect(declsFor(".top-nav__tab--active").get("box-shadow")).toContain(
      "var(--text-primary)"
    );
  });

  it("colapsa para só ícone antes de o header apertar", () => {
    // 1100px vinha de antes do `NavProfile` entrar em `.header__section--actions`
    // (Task 9) — 1550px é o recalculado depois disso e da remoção da sidebar
    // global (Task 10), ver o comentário acima de `@media (max-width: 1550px)`
    // em `src/app.scss`.
    const source = readFileSync("src/app.scss", "utf8");
    expect(source).toContain("@media (max-width: 1550px)");
    let labelHidden = false;
    css.walkAtRules("media", (atRule) => {
      if (!atRule.params.includes("1550px")) return;
      atRule.walkRules((rule) => {
        if (rule.selector.includes(".top-nav__label")) labelHidden = true;
      });
    });
    expect(labelHidden).toBe(true);
  });
});
