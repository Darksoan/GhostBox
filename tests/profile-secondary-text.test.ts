import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("Profile activity simplification", () => {
  it("aligns achievement progress and last-played text using the same line height", () => {
    const stylesheet = postcss.parse(compile("src/pages/ProfilePage.scss").css);
    const values: Record<string, string> = {};
    stylesheet.walkRules((rule) => {
      if (rule.selector === ".profile-page__activity-status") {
        rule.walkDecls("line-height", (declaration) => {
          values.status = declaration.value;
        });
      }
      if (rule.selector === ".profile-page__activity-progress") {
        rule.walkDecls("min-height", (declaration) => {
          values.progress = declaration.value;
        });
      }
    });
    expect(values.status).toBe("var(--type-line-caption)");
    expect(values.progress).toBe(values.status);
  });

  it("keeps the sort chevron in flow and separate from the label", () => {
    const stylesheet = postcss.parse(compile("src/pages/ProfilePage.scss").css);
    const positions: string[] = [];
    stylesheet.walkRules((rule) => {
      if (rule.selector === ".profile-page__activity-sort .settings-dropdown__trigger svg") {
        rule.walkDecls("position", (declaration) => {
          positions.push(declaration.value);
        });
      }
    });
    expect(positions).toEqual(["static"]);
  });

  it("removes achievement artwork while retaining the counter and progress", () => {
    const source = readFileSync("src/pages/ProfilePage.tsx", "utf8");
    const card = source.slice(
      source.indexOf("const ProfileActivityCard ="),
      source.indexOf("function LoadedProfileAchievementGameIcon"),
    );

    expect(card).not.toContain("profile-page__activity-icons");
    expect(card).not.toContain("latestAchievements");
    expect(card).toContain("profile-page__activity-progress-count");
    expect(card).toContain("profile-page__progress-track");
  });

  it("uses the local 14px token for the highlighted secondary texts", () => {
    const tokens = readFileSync("src/styles/_semantic.scss", "utf8");
    expect(tokens).toContain("--profile-secondary-text-size: 14px;");

    const stylesheet = postcss.parse(compile("src/pages/ProfilePage.scss").css);
    for (const selector of [
      ".profile-page__activity-metric",
      ".profile-page__activity-sort .settings-dropdown__trigger",
      ".profile-page__activity-status",
    ]) {
      const sizes: string[] = [];
      stylesheet.walkRules((rule) => {
        if (rule.selector === selector) {
          rule.walkDecls("font-size", (declaration) => {
            sizes.push(declaration.value);
          });
        }
      });
      expect(sizes.at(-1)).toBe("var(--profile-secondary-text-size)");
    }
  });
});
