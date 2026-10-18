import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  settingsTabDescriptionKeys,
  settingsTabLabelKeys,
} from "../src/features/settings/settingsTabsShared";
import { translate } from "../src/i18n";

describe("connections settings header", () => {
  it("uses the shared page header like every other settings tab", () => {
    const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
    expect(settings).toContain('<div className="settings-page__header">');
    expect(settings).toContain(
      'activeTab.id !== "subscription" && !showingHiddenGames',
    );
    expect(settings).not.toContain('activeTab.id !== "connections"');
    expect(settings).toContain('{activeTab.id === "connections" && <ConnectionsPanel />}');
  });

  it("drops the panel's own header so size and offsets come from the page", () => {
    const panel = readFileSync(
      "src/features/settings/ConnectionsPanel.tsx",
      "utf8",
    );
    expect(panel).not.toContain("connections-panel__header");
    expect(panel).not.toContain("<h2");

    const styles = readFileSync(
      "src/features/settings/ConnectionsPanel.scss",
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(styles).not.toContain("connections-panel__header");
    const panelRule = styles.match(/\.connections-panel \{[\s\S]*?\}/)?.[0] ?? "";
    expect(panelRule).toContain("display: flex");
    expect(panelRule).not.toContain("padding");
  });

  it("keeps the shared header copy driven by the tab label and description", () => {
    expect(settingsTabLabelKeys.connections).toBe("settings.tabs.connections.label");
    expect(settingsTabDescriptionKeys.connections).toBe(
      "settings.tabs.connections.description",
    );
    expect(translate("pt", settingsTabLabelKeys.connections)).toBe("Conexões");
    expect(translate("pt", settingsTabDescriptionKeys.connections)).toBe(
      "Contas, perfis e vínculos externos.",
    );
  });
});
