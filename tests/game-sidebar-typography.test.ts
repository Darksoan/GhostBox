import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("uses 14px sidebar subtext without shrinking requirement labels", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const value = (selector: string, property: string) => {
    let result: string | undefined;
    stylesheet.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(property, (declaration) => {
        result = declaration.value;
      });
    });
    return result;
  };

  expect(value(":root", "--game-sidebar-subtext-size")).toBe("14px");
  for (const selector of [
    ".modal__requirements-content li",
    ".modal__requirements-content p",
    ".modal__controller-support-description",
    ".modal__achievements-state",
    ".modal__languages-row",
  ]) {
    expect(value(`.modal__sidebar ${selector}`, "font-size")).toBe(
      "var(--game-sidebar-subtext-size)",
    );
  }
  expect(value(".modal__sidebar .modal__requirements-content strong", "font-size")).toBe(
    "var(--type-size-compact)",
  );
});
