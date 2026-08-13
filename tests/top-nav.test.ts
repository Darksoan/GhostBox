import { readFileSync } from "node:fs";
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
