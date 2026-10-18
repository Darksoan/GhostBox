import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("overrides shared icon sizing for backup actions and achievement counts", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const values = (selector: string) => {
    const result = new Map<string, string>();
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls((decl) => { result.set(decl.prop, decl.value); });
    });
    return result;
  };
  expect(values(".subscription-account__backup-row-actions").get("--ui-icon-size")).toBe("22px");
  const count = values(".subscription-account__backup-title .subscription-account__achievement-count");
  expect(count.get("--ui-icon-size")).toBe("18px");
  expect(values(".subscription-account__backup-title .subscription-account__achievement-count svg").get("color")).toBe("var(--text-primary)");
  expect(count.get("font-size")).toBe("var(--subscription-account-subtext-size)");
  expect(values(":root").get("--subscription-account-subtext-size")).toBe("14px");
  expect(values(".subscription-account__backup-title .subscription-account__achievement-count span").get("font-size")).toBe("inherit");
});
