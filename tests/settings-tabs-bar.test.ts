import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Barra de abas de ajustes", () => {
  it("não depende mais do layout de navegação", () => {
    const router = readFileSync(
      "src/components/routing/PageRouter.tsx",
      "utf8"
    );
    const app = readFileSync("src/App.tsx", "utf8");

    expect(router).not.toContain("showSettingsTabsBar");
    expect(app).not.toContain("showSettingsTabsBar");
  });

  it("a página de ajustes segue renderizando a própria barra", () => {
    const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
    expect(settings).toContain("settings-page__tabs-bar");
  });
});
