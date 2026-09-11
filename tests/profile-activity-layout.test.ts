import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Profile recent activity card layout", () => {
  it("keeps the header cover geometry independent from achievement availability", () => {
    const source = readFileSync("src/pages/ProfilePage.tsx", "utf8");
    const css = compile("src/pages/ProfilePage.scss").css;
    const stylesheet = postcss.parse(css);
    const cardRows: string[] = [];
    const coverRows: string[] = [];

    stylesheet.walkRules((rule) => {
      if (rule.selector === ".profile-page__activity-card") {
        rule.walkDecls("grid-template-rows", (declaration) => {
          cardRows.push(declaration.value);
        });
      }

      if (rule.selector === ".profile-page__activity-cover-button") {
        rule.walkDecls("grid-row", (declaration) => {
          coverRows.push(declaration.value);
        });
      }
    });

    expect(cardRows).toEqual(["auto auto"]);
    expect(coverRows).toContain("1/-1");
    expect(source).toContain('0 {t("profile.of")} 0');
    expect(source).not.toContain("activity-card--with-achievements");
    expect(css).not.toContain("activity-card--with-achievements");
  });
});
