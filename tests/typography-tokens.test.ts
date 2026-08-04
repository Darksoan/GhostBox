import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const UI_STYLES = [
  "src/app.scss",
  "src/pages/ProfilePage.scss",
  "src/pages/GameAchievementsPage.scss",
];

function collectTokens(): Map<string, string> {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const customProperties = new Map<string, string>();

  stylesheet.walkRules((rule) => {
    if (rule.selector !== ":root") return;
    rule.walkDecls(/^--/, (declaration) => {
      customProperties.set(declaration.prop, declaration.value);
    });
  });

  return customProperties;
}

describe("Typography tokens", () => {
  it("maps every semantic size to the canonical ramp", () => {
    const tokens = collectTokens();
    const expected: Record<string, string> = {
      "--type-size-micro": "var(--fs-100)",
      "--type-size-caption": "var(--fs-200)",
      "--type-size-compact": "var(--fs-300)",
      "--type-size-body": "var(--fs-400)",
      "--type-size-body-emphasis": "var(--fs-500)",
      "--type-size-section": "var(--fs-600)",
      "--type-size-page": "var(--fs-700)",
      "--type-size-display": "var(--fs-800)",
      "--type-size-hero": "var(--fs-900)",
      "--type-size-showcase": "var(--fs-1000)",
    };

    for (const [token, ramp] of Object.entries(expected)) {
      expect(tokens.get(token), token).toBe(ramp);
    }

    const ramp: Record<string, string> = {};
    for (const [token, value] of tokens) {
      const match = token.match(/^--fs-(\d+)$/);
      if (match) ramp[match[1]] = value;
    }

    expect(ramp["100"]).toBe("12px");
    expect(ramp["800"]).toBe("34px");
    expect(ramp["900"]).toBe("40px");
    expect(ramp["1000"]).toBe("48px");
  });

  it("defines paired line heights for every semantic size", () => {
    const tokens = collectTokens();

    for (const [size, line] of [
      ["--type-size-micro", "--type-line-micro"],
      ["--type-size-caption", "--type-line-caption"],
      ["--type-size-compact", "--type-line-compact"],
      ["--type-size-body", "--type-line-body"],
      ["--type-size-body-emphasis", "--type-line-body-emphasis"],
      ["--type-size-section", "--type-line-section"],
      ["--type-size-page", "--type-line-page"],
      ["--type-size-display", "--type-line-display"],
      ["--type-size-hero", "--type-line-hero"],
      ["--type-size-showcase", "--type-line-showcase"],
    ]) {
      expect(tokens.has(size), size).toBe(true);
      expect(tokens.has(line), line).toBe(true);
    }
  });

  it("keeps every fluid size as a named token", () => {
    const tokens = collectTokens();

    for (const fluid of [
      "--type-size-fluid-caption",
      "--type-size-fluid-meta",
      "--type-size-fluid-body",
      "--type-size-fluid-title",
      "--type-size-fluid-section",
      "--type-size-fluid-page",
      "--type-size-fluid-display",
      "--type-size-fluid-hero",
      "--type-size-fluid-showcase",
    ]) {
      expect(tokens.get(fluid)?.startsWith("clamp("), fluid).toBe(true);
    }
  });

  it("forbids literal font-size and stray ramp references in UI styles", () => {
    for (const file of UI_STYLES) {
      const source = readFileSync(file, "utf8");

      expect(source, `${file} literal font-size`).not.toMatch(
        /font-size\s*:\s*(?:clamp\(|[0-9])/
      );
      expect(source, `${file} raw ramp reference`).not.toMatch(/var\(--fs-/);
    }
  });

  it("gives compact metrics enough room for the 12px minimum", () => {
    const source = readFileSync("src/app.scss", "utf8");

    expect(source).toContain("min-width: var(--space-8);");
    expect(source).toContain("height: var(--space-8);");
    expect(source).toContain("padding-inline: var(--space-4);");
    expect(source).toContain("text-overflow: ellipsis;");
  });

  it("keeps Home secondary copy above micro text size", () => {
    const source = readFileSync("src/app.scss", "utf8");

    expect(source).toContain(".home-page .section-header__subtitle");
    expect(source).toContain(".home-wishlist-card__reason");
    expect(source).toContain("font-size: var(--type-size-compact);");
    expect(source).toContain("font-size: var(--type-size-caption);");
    expect(source).toContain("line-height: var(--type-line-compact);");
    expect(source).toContain("line-height: var(--type-line-caption);");
  });
});
