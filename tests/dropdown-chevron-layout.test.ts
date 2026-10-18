import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("keeps shared dropdown chevrons at the right edge with space from the label", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const declarations = (selector: string) => {
    const values = new Map<string, string>();
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls((declaration) => {
        values.set(declaration.prop, declaration.value);
      });
    });
    return values;
  };

  const trigger = declarations(".settings-dropdown__trigger");
  expect(trigger.get("justify-content")).toBe("space-between");
  expect(trigger.get("gap")).toBe("var(--space-6)");
  expect(declarations(".settings-dropdown__trigger span").get("flex")).toBe("1 1 auto");
  expect(declarations(".settings-dropdown__trigger span").get("text-align")).toBe("center");
  expect(declarations(".settings-dropdown__trigger svg").get("position")).toBe("absolute");
  expect(declarations(".settings-dropdown__trigger svg").get("right")).toBe("var(--space-5)");
});
