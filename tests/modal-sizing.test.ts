import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(compile("src/app.scss").css);
const canonicalWidth = "min(480px, 100vw - var(--space-10) * 2)";

function declarationsFor(...selectors: string[]) {
  const declarations = new Map<string, string>();

  stylesheet.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selectors.includes(selector))) return;
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value);
    });
  });

  return declarations;
}

describe("Consistent dialog sizing", () => {
  it.each([
    ["sign-out", ".collection-modal", ".profile-page__signout-confirm"],
    ["library removal", ".collection-modal", ".uninstall-confirm-modal"],
    ["cloud backup", ".collection-modal", ".cloud-backup-confirm-modal"],
    ["collection creation", ".collection-modal", ".collection-create-modal"],
    ["feedback", ".collection-modal", ".feedback-modal"],
    ["Steam path", ".steam-path-modal"],
    ["generic confirmation", ".confirm-modal"],
  ])("gives %s the same width regardless of its message", (_name, ...selectors) => {
    const declarations = declarationsFor(...selectors);

    expect(declarations.get("width")).toBe(canonicalWidth);
    expect(declarations.get("min-width")).toBe("0");
    expect(declarations.get("max-width")).toBe("100%");
    expect(declarations.get("height")).toBeUndefined();
    expect(declarations.get("overflow-wrap")).toBe("anywhere");
  });

  it("lets collection descriptions wrap instead of forcing one line", () => {
    const description = declarationsFor(
      ".collection-modal__header p",
      ".collection-create-modal .collection-modal__header p",
    );

    expect(description.get("white-space")).not.toBe("nowrap");
    expect(description.get("text-overflow")).not.toBe("ellipsis");
  });

  it("keeps larger profile editors at their dedicated sizes", () => {
    const profile = declarationsFor(".collection-modal", ".edit-profile-modal");
    const cover = declarationsFor(".collection-modal", ".edit-profile-modal", ".edit-profile-cover-modal");

    expect(profile.get("width")).toBe("min(520px, 100vw - 48px)");
    expect(cover.get("width")).toBe("min(860px, 100vw - 48px)");
  });

  it("keeps close buttons from shrinking when titles wrap", () => {
    expect(declarationsFor(".collection-modal__header .collection-modal__close").get("flex-shrink")).toBe("0");
    expect(declarationsFor(".confirm-modal__close").get("flex-shrink")).toBe("0");
  });
});
