import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { getSteamLevelColorTier } from "../src/utils/steamLevel";

describe("Steam level badge", () => {
  it.each([
    [0, 0], [9, 0], [10, 10], [19, 10], [20, 20], [29, 20],
    [30, 30], [39, 30], [40, 40], [49, 40], [50, 50], [59, 50],
    [60, 60], [69, 60], [70, 70], [79, 70], [80, 80], [89, 80],
    [90, 90], [99, 90], [100, 0], [110, 10], [999, 90], [1000, 0],
  ])("uses the Steam color tier for level %s", (level, tier) => {
    expect(getSteamLevelColorTier(level)).toBe(tier);
  });

  it.each([null, -1, NaN, Infinity, -Infinity])("uses a neutral ring for unavailable level %s", (level) => {
    expect(getSteamLevelColorTier(level)).toBe(0);
  });

  it("connects the sidebar badge to the fetched Steam level", () => {
    const source = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
    expect(source).toContain("data-steam-level-tier={getSteamLevelColorTier(steamLevel)}");
    expect(source).toContain('{steamLevel ?? ""}');
  });

  it("matches the Steam palette without changing size or centering", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const rules = new Map<string, Map<string, string>>();
    stylesheet.walkRules((rule) => {
      const declarations = rules.get(rule.selector) ?? new Map<string, string>();
      rule.walkDecls((decl) => { declarations.set(decl.prop, decl.value); });
      rules.set(rule.selector, declarations);
    });

    const tokens = rules.get(":root")!;
    const palette = [
      "#9b9b9b", "#c02942", "#d95b43", "#fecc23", "#467a3c",
      "#4e8ddb", "#7652c9", "#c252c9", "#542437", "#997c52",
    ];
    palette.forEach((color, index) => {
      const tier = index * 10;
      expect(tokens.get(`--steam-level-ring-${tier}`)).toBe(color);
      const selector = `.sidebar-profile__level[data-steam-level-tier="${tier}"]`;
      expect(rules.get(selector)?.get("--steam-level-ring")).toBe(`var(--steam-level-ring-${tier})`);
    });

    const badge = rules.get(".sidebar-profile__level")!;
    expect(badge.get("color")).toBe("var(--steam-level-text)");
    expect(tokens.get("--steam-level-text")).toBe("var(--white)");
    expect(tokens.get("--white")).toBe("#ffffff");
    expect(badge.get("border")).toBe("2px solid var(--steam-level-ring)");
    expect(badge.get("font-size")).toBe("var(--sidebar-level-size)");
    expect(tokens.get("--sidebar-level-size")).toBe("14px");
    expect(badge.get("width")).toBe("var(--sidebar-level-badge-size)");
    expect(badge.get("height")).toBe("var(--sidebar-level-badge-size)");
    expect(tokens.get("--sidebar-level-badge-size")).toBe("26px");
    expect(badge.get("display")).toBe("grid");
    expect(badge.get("place-items")).toBe("center");
    expect(badge.get("line-height")).toBe("1");
    expect(badge.has("transform")).toBe(false);
    expect(rules.get(".sidebar-profile__level-value")?.has("transform")).toBe(false);
  });
});
