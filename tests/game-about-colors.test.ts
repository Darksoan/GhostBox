import { compile } from "sass-embedded";
import postcss from "postcss";
import { expect, it } from "vitest";

it("matches About the game text colors to the right sidebar hierarchy", () => {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const color = (selector: string) => {
    let value: string | undefined;
    stylesheet.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls("color", (declaration) => {
        value = declaration.value;
      });
    });
    return value;
  };

  expect(color(".modal__about-content")).toBe("var(--text-tertiary)");
  stylesheet.walkRules(".modal__about-content", (rule) => {
    rule.walkDecls("font-size", (declaration) => {
      expect(declaration.value).toBe("var(--game-about-text-size)");
    });
  });
  stylesheet.walkRules(":root", (rule) => {
    rule.walkDecls("--game-about-text-size", (declaration) => {
      expect(declaration.value).toBe("15px");
    });
  });
  for (const tag of ["p", "div", "span", "li", "td", "th"]) {
    expect(color(`.modal__about-content ${tag}`)).toBe(
      color(".modal__requirements-content li"),
    );
  }
  for (const tag of ["strong", "b", "h1", "h2", "h3", "h4", "h5", "a"]) {
    expect(color(`.modal__about-content ${tag}`)).toBe(
      color(".modal__requirements-content strong"),
    );
  }
});
