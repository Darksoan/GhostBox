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

function resolveToken(name: string, tokens: Map<string, string>): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`missing token ${name}`);
  const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  return variable ? resolveToken(variable, tokens) : value;
}

describe("Typography tokens", () => {
  it("uses the contrast-equalized surface ramp", () => {
    const tokens = collectTokens();

    expect(tokens.get("--n-0")).toBe("#000000");
    expect(tokens.get("--n-1")).toBe("#0b0b0b");
    expect(tokens.get("--n-2")).toBe("#141414");
    expect(tokens.get("--n-3")).toBe("#1a1a1a");
    expect(tokens.get("--n-4")).toBe("#202020");
    expect(tokens.has("--n-000")).toBe(false);
  });

  it("keeps surface-role tokens inside the surface ramp", () => {
    const tokens = collectTokens();
    const surfaceRole =
      /^--(surface|pill-bg|dropdown-option-hover|sidebar-option|settings-dropdown|profile-dropdown|library-box|toggle-(track|thumb)$|control-hover|skeleton-fill)/;

    for (const name of tokens.keys()) {
      if (!surfaceRole.test(name)) continue;
      const resolved = resolveToken(name, tokens);
      if (!/^#[0-9a-f]{6}$/i.test(resolved)) continue;
      expect(parseInt(resolved.slice(1), 16), `${name} = ${resolved}`).toBeLessThanOrEqual(
        0x202020,
      );
    }
  });

  it("keeps text tokens unchanged", () => {
    const tokens = collectTokens();

    expect(tokens.get("--text-primary")).toBe("var(--n-11)");
    expect(tokens.get("--text-secondary")).toBe("var(--n-9)");
    expect(tokens.get("--text-tertiary")).toBe("var(--n-8)");
    expect(tokens.get("--text-strong")).toBe("var(--text-primary)");
    expect(tokens.get("--text-muted")).toBe("var(--text-secondary)");
    expect(tokens.get("--text-faint")).toBe("var(--text-tertiary)");
    expect(tokens.get("--n-8")).toBe("#8c8c8c");
    expect(tokens.get("--n-9")).toBe("#a3a3a3");
    expect(tokens.get("--n-10")).toBe("#b8b8b8");
    expect(tokens.get("--n-11")).toBe("#e9e9e9");
    expect(tokens.get("--n-12")).toBe("#f2f2f2");
  });

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
