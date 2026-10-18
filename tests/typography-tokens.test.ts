import { readFileSync, readdirSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function collectUiStyles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return path === "src/styles" ? [] : collectUiStyles(path);
    }
    return path.endsWith(".scss") ? [path] : [];
  });
}

const UI_STYLES = collectUiStyles("src");

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

    expect(tokens.get("--c-0")).toBe("#0a0a0a");
    expect(tokens.get("--c-1")).toBe("#101010");
    expect(tokens.get("--c-2")).toBe("#121212");
    expect(tokens.get("--c-3")).toBe("#151515");
    expect(tokens.get("--c-4")).toBe("#1a1a1a");
    expect(tokens.has("--n-0")).toBe(false);
    expect(tokens.has("--c-000")).toBe(false);
  });

  it("keeps surface-role tokens inside the surface ramp", () => {
    const tokens = collectTokens();
    const surfaceRole =
      /^--(surface|pill-bg|dropdown-option-hover|sidebar-option|settings-dropdown|profile-dropdown|library-box|control-hover|skeleton-fill)/;

    for (const name of tokens.keys()) {
      if (!surfaceRole.test(name)) continue;
      if (name === "--settings-dropdown-surface-hover") continue;
      if (name === "--settings-dropdown-trigger-hover") continue;
      if (name === "--surface-option-selected") continue;
      const resolved = resolveToken(name, tokens);
      if (!/^#[0-9a-f]{6}$/i.test(resolved)) continue;
      expect(parseInt(resolved.slice(1), 16), `${name} = ${resolved}`).toBeLessThanOrEqual(
        0x1a1a1a,
      );
    }
  });

  it("keeps the toggle outside the surface ramp on purpose", () => {
    const tokens = collectTokens();

    expect(resolveToken("--toggle-track", tokens)).toBe("#303030");
    expect(resolveToken("--toggle-track-on", tokens)).toBe("#ffffff");
    expect(resolveToken("--toggle-thumb", tokens)).toBe("#6e6e6e");
    expect(resolveToken("--toggle-thumb-on", tokens)).toBe("#0a0a0a");
  });

  it("keeps the Settings dropdown on its dedicated surface states", () => {
    const tokens = collectTokens();

    expect(resolveToken("--settings-dropdown-surface", tokens)).toBe("#151515");
    expect(resolveToken("--settings-dropdown-surface-hover", tokens)).toBe("#151515");
    expect(resolveToken("--settings-dropdown-menu", tokens)).toBe("#151515");
    expect(resolveToken("--dropdown-option-hover", tokens)).toBe("#1a1a1a");
  });

  it("maps text roles to the canonical three-level neutral hierarchy", () => {
    const tokens = collectTokens();

    expect(tokens.get("--text-primary")).toBe("var(--n-12)");
    expect(tokens.get("--text-secondary")).toBe("var(--n-9)");
    expect(resolveToken("--text-secondary", tokens)).toBe("#a3a3a3");
    expect(tokens.get("--text-tertiary")).toBe("var(--n-8)");
    expect(tokens.get("--text-placeholder")).toBe("var(--text-tertiary)");
    expect(tokens.get("--text-strong")).toBe("var(--text-primary)");
    expect(tokens.get("--text-muted")).toBe("var(--text-secondary)");
    expect(tokens.get("--text-faint")).toBe("var(--text-tertiary)");
    expect(tokens.get("--n-8")).toBe("#8c8c8c");
    expect(tokens.get("--n-9")).toBe("#a3a3a3");
    expect(tokens.get("--n-10")).toBe("#b8b8b8");
    expect(tokens.get("--n-11")).toBe("#c8c8c8");
    expect(tokens.get("--n-12")).toBe("#e9e9e9");
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

    expect(ramp["100"]).toBe("16px");
    expect(ramp["800"]).toBe("34px");
    expect(ramp["900"]).toBe("40px");
    expect(ramp["1000"]).toBe("48px");
  });

  it("keeps 16px as the floor of shared text sizes in the app", () => {
    const tokens = collectTokens();

    for (const [token, value] of tokens) {
      if (/^--fs-\d+$/.test(token)) {
        expect(parseFloat(value), `${token} = ${value}`).toBeGreaterThanOrEqual(16);
        continue;
      }
      if (!/^--type-size-fluid-/.test(token)) continue;
      const minimum = value.match(/^clamp\(\s*([0-9.]+)px/)?.[1];
      expect(minimum, `${token} = ${value}`).toBeDefined();
      expect(parseFloat(minimum ?? "0"), `${token} = ${value}`).toBeGreaterThanOrEqual(16);
    }
  });

  it("keeps the sidebar collections title at 14px as a dedicated exception", () => {
    const tokens = collectTokens();
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let fontSize: string | undefined;
    stylesheet.walkRules(".sidebar__section-title", (rule) => {
      rule.walkDecls("font-size", (declaration) => {
        fontSize = declaration.value;
      });
    });

    expect(fontSize).toBe("var(--sidebar-collections-title-size)");
    expect(resolveToken("--sidebar-collections-title-size", tokens)).toBe("14px");
  });

  it("keeps Home section titles at 14px as a dedicated exception", () => {
    const tokens = collectTokens();
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    let fontSize: string | undefined;
    stylesheet.walkRules(".home-page .section-header__title", (rule) => {
      rule.walkDecls("font-size", (declaration) => {
        fontSize = declaration.value;
      });
    });

    expect(fontSize).toBe("var(--home-section-title-size)");
    expect(resolveToken("--home-section-title-size", tokens)).toBe("14px");
  });

  it("keeps Top rated review text at 14px as a dedicated exception", () => {
    const tokens = collectTokens();
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    for (const selector of [".home-top-rated-card__developer", ".home-top-rated-card__rating"]) {
      let fontSize: string | undefined;
      stylesheet.walkRules(selector, (rule) => {
        rule.walkDecls("font-size", (declaration) => {
          fontSize = declaration.value;
        });
      });
      expect(fontSize, selector).toBe("var(--home-top-rated-review-size)");
    }
    expect(resolveToken("--home-top-rated-review-size", tokens)).toBe("14px");
  });

  it("keeps the banner subtitle at 14px as a dedicated exception", () => {
    const tokens = collectTokens();
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    for (const selector of [".home-banner__developer", ".home-banner__description"]) {
      let fontSize: string | undefined;
      stylesheet.walkRules(selector, (rule) => {
        rule.walkDecls("font-size", (declaration) => {
          fontSize = declaration.value;
        });
      });
      expect(fontSize, selector).toBe("var(--home-banner-subtitle-size)");
    }
    expect(resolveToken("--home-banner-subtitle-size", tokens)).toBe("14px");
  });

  it("keeps font weights at 450", () => {
    const tokens = collectTokens();

    expect(resolveToken("--weight-regular", tokens)).toBe("450");
    expect(resolveToken("--weight-semibold", tokens)).toBe("450");

    for (const file of UI_STYLES) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} font weight below 450`).not.toMatch(
        /font-weight\s*:\s*(?:[1-3]\d{2}|4[0-4]\d|normal|lighter)\b/,
      );

      for (const match of source.matchAll(/var\((--weight-[^)]+)\)/g)) {
        expect(
          ["--weight-regular", "--weight-semibold"],
          `${file} references unknown weight ${match[1]}`,
        ).toContain(match[1]);
      }
    }
  });

  it("pairs the small steps with a line height that clears descenders", () => {
    const tokens = collectTokens();

    for (const [size, line] of [
      ["--type-size-micro", "--type-line-micro"],
      ["--type-size-caption", "--type-line-caption"],
      ["--type-size-compact", "--type-line-compact"],
    ]) {
      const sizePx = parseFloat(resolveToken(size, tokens));
      const linePx = parseFloat(resolveToken(line, tokens));
      expect(linePx / sizePx, `${line} / ${size}`).toBeGreaterThanOrEqual(1.2);
    }
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
    const allowedLiterals: Record<string, string[]> = {};

    for (const file of UI_STYLES) {
      const source = readFileSync(file, "utf8");
      const literals = [
        ...source.matchAll(/font-size\s*:\s*(?:clamp\(|[0-9])[^;]*/g),
      ].map((match) => match[0].trim());

      expect(literals, `${file} literal font-size`).toEqual(
        allowedLiterals[file] ?? [],
      );
      expect(source, `${file} raw ramp reference`).not.toMatch(/var\(--fs-/);
    }
  });

  it("gives compact metrics enough room for the 16px minimum", () => {
    const source = readFileSync("src/app.scss", "utf8");

    expect(source).toContain("min-width: var(--space-9);");
    expect(source).toContain("height: var(--space-9);");
    expect(source).toContain("padding-inline: var(--space-4);");
    expect(source).toContain("text-overflow: ellipsis;");
  });

  it("keeps wishlist review playtime at 14px without shrinking the author", () => {
    const tokens = collectTokens();
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const sizes = new Map<string, string>();
    stylesheet.walkRules((rule) => {
      rule.walkDecls("font-size", (declaration) => {
        sizes.set(rule.selector, declaration.value);
      });
    });

    expect(sizes.get(".home-wishlist-card__player-review-author small")).toBe(
      "var(--home-wishlist-review-playtime-size)",
    );
    expect(resolveToken("--home-wishlist-review-playtime-size", tokens)).toBe("14px");
    expect(sizes.get(".home-wishlist-card__player-review-author strong")).toBe(
      "var(--type-size-caption)",
    );
    expect(resolveToken("--type-size-caption", tokens)).toBe("16px");
  });
});
