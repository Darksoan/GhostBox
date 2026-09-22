import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

function declarationsFor(selector: string) {
  const stylesheet = postcss.parse(compile("src/app.scss").css);
  const declarations = new Map<string, string>();

  stylesheet.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value);
    });
  });

  return declarations;
}

describe("Confirmation modal buttons", () => {
  it("uses tertiary text at rest and secondary text on neutral interaction", () => {
    const neutral = declarationsFor(
      ".uninstall-confirm-modal .collection-modal__actions .button:not(.button--danger)",
    );
    const hover = declarationsFor(
      ".uninstall-confirm-modal .collection-modal__actions .button:not(.button--danger):hover:not(:disabled)",
    );

    expect(neutral.get("background")).toBe("var(--surface-option)");
    expect(neutral.get("color")).toBe("var(--text-tertiary)");
    expect(hover.get("background")).toBe("var(--surface-option-hover)");
    expect(hover.get("color")).toBe("var(--text-secondary)");
  });

  it("preserves the danger treatment", () => {
    const danger = declarationsFor(
      ".uninstall-confirm-modal .collection-modal__actions .button--danger:hover:not(:disabled)",
    );

    expect(danger.get("background")).toBe("var(--danger)");
    expect(danger.get("color")).toBe("var(--text-primary)");
  });

  it("uses the same neutral hierarchy for collection creation cancellation", () => {
    const neutral = declarationsFor(
      ".collection-modal__actions .button:not(.button--primary)",
    );
    const hover = declarationsFor(
      ".collection-modal__actions .button:not(.button--primary):hover:not(:disabled)",
    );

    expect(neutral.get("background")).toBe("var(--surface-option)");
    expect(neutral.get("color")).toBe("var(--text-tertiary)");
    expect(hover.get("background")).toBe("var(--surface-option-hover)");
    expect(hover.get("color")).toBe("var(--text-secondary)");
  });

  it("keeps the disabled collection creation action tertiary", () => {
    const disabled = declarationsFor(
      ".collection-modal__actions .button--primary:disabled",
    );

    expect(disabled.get("background")).toBe("var(--surface-option)");
    expect(disabled.get("color")).toBe("var(--text-tertiary)");
    expect(disabled.get("opacity")).toBe("0.6");
  });
});
