import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function resolvePixels(value: string, customProperties: Map<string, string>): number | null {
  const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  if (variable) {
    const resolved = customProperties.get(variable);
    return resolved ? resolvePixels(resolved, customProperties) : null;
  }

  const pixels = value.match(/^(\d+(?:\.\d+)?)px$/)?.[1];
  return pixels ? Number(pixels) : null;
}

describe("Home layout", () => {
  it("keeps the terminal wishlist chevron clear of the window edge", () => {
    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const customProperties = new Map<string, string>();
    let terminalMargin: string | undefined;

    stylesheet.walkRules((rule) => {
      if (rule.selector === ":root") {
        rule.walkDecls(/^--/, (declaration) => {
          customProperties.set(declaration.prop, declaration.value);
        });
      }

      if (rule.selector === ".home-wishlist__more") {
        rule.walkDecls("margin-block-end", (declaration) => {
          terminalMargin = declaration.value;
        });
      }
    });

    expect(terminalMargin, "the terminal chevron needs its own bottom clearance").toBeDefined();
    expect(resolvePixels(terminalMargin ?? "", customProperties)).toBeGreaterThanOrEqual(16);
  });
});
