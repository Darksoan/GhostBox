import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("keeps toast subtitles secondary, 14px and weight 450 independently of titles", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const values = (selector: string) => {
    const result = new Map<string, string>();
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls((declaration) => {
        result.set(declaration.prop, declaration.value);
      });
    });
    return result;
  };

  const subtitle = values(".toast__subtitle");
  expect(subtitle.get("color")).toBe("var(--text-secondary)");
  expect(subtitle.get("font-size")).toBe("var(--toast-subtitle-size)");
  expect(subtitle.get("font-weight")).toBe("var(--weight-regular)");
  expect(values(":root").get("--toast-subtitle-size")).toBe("14px");
  expect(values(":root").get("--weight-regular")).toBe("450");
});
