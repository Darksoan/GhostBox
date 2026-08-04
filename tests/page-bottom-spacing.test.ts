import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function paddingBlockEnd(value: string): string {
  const parts = value.trim().split(/\s+/);

  if (parts.length < 3) return parts[0];
  return parts[2];
}

describe("Page bottom spacing", () => {
  it("uses the canonical bottom spacing across every app tab", () => {
    const stylesheet = postcss.parse(
      `${compile("src/app.scss").css}\n${compile("src/pages/ProfilePage.scss").css}`,
    );
    const selectors = [
      ".home-page",
      ".catalogue-page__results",
      ".content-section--library",
      ".favorites-page",
      ".settings-page--tabs",
      ".profile-page__content-section",
      ".notifications-page",
    ];

    selectors.forEach((selector) => {
      const values: string[] = [];

      stylesheet.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;

        rule.walkDecls(/^padding(?:-bottom)?$/, (declaration) => {
          values.push(
            declaration.prop === "padding-bottom"
              ? declaration.value
              : paddingBlockEnd(declaration.value),
          );
        });
      });

      expect(values, `${selector} needs explicit bottom spacing`).not.toHaveLength(0);
      expect(values, `${selector} must use --page-bottom-space`).toEqual(
        values.map(() => "var(--page-bottom-space)"),
      );
    });
  });
});
