import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "sass-embedded";
import postcss from "postcss";

describe("settings option subtext", () => {
  it("defines a shared 15px token without changing the global type scale", () => {
    expect(readFileSync("src/styles/_semantic.scss", "utf8"))
      .toContain("--settings-option-description-size: 15px;");
    expect(readFileSync("src/app.scss", "utf8"))
      .toMatch(/\/\/ Descriptions wrap:[\s\S]*?font-size: var\(--settings-option-description-size\)/);
  });

  it.each([
    ["ConnectionsPanel", ".connection-card__body p"],
    ["ConnectionsPanel", ".connection-card__connected"],
    ["ConnectionsPanel", ".connection-card__steam-option-copy span"],
    ["ConnectionsPanel", ".hidden-profile-games__copy span"],
    ["TempFilesSection", ".temp-files-section__heading p"],
    ["DownloadSettingsSection", ".download-library-settings__heading p"],
    ["DownloadSettingsSection", ".download-library-settings__name > span"],
  ])("uses the shared token in %s: %s", (file, selector) => {
    const root = postcss.parse(compile(`src/features/settings/${file}.scss`).css);
    let size = "";
    root.walkRules(selector, (rule) => {
      rule.walkDecls("font-size", (decl) => { size = decl.value; });
    });
    expect(size).toBe("var(--settings-option-description-size)");
  });
});
