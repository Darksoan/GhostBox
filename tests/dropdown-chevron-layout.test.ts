import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(
  compile("src/app.scss").css + compile("src/pages/ProfilePage.scss").css,
);

function declarationsFor(...selectors: string[]) {
  const values = new Map<string, string>();
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selectors.includes(selector))) return;
    rule.walkDecls((declaration) => {
      values.set(declaration.prop, declaration.value);
    });
  });
  return values;
}

describe("Global dropdown trigger spacing", () => {
  it.each([
    ["shared", ""],
    ["settings", ".settings-page-dropdown"],
    ["catalogue sorting", ".catalogue-page__sort"],
    ["catalogue view", ".catalogue-page__view"],
    ["library", ".library-toolbar"],
    ["profile", ".profile-page__activity-sort"],
  ])("centers text in the whole %s trigger while keeping equal side padding", (_name, context) => {
    const base = ".settings-dropdown__trigger";
    const variant = context ? `${context} ${base}` : base;
    const trigger = declarationsFor(base, variant);
    const label = declarationsFor(`${base} span`, `${variant} span`);
    const chevron = declarationsFor(`${base} svg`, `${variant} svg`);

    expect(trigger.get("padding")).toBe("0 var(--space-6)");
    expect(trigger.get("gap")).toBe("var(--space-4)");
    expect(trigger.get("display")).toBe("inline-grid");
    expect(trigger.get("grid-template-columns")).toBe("var(--ui-icon-size) minmax(0, 1fr) var(--ui-icon-size)");
    expect(label.get("grid-column")).toBe("2");
    expect(label.get("grid-row")).toBe("1");
    expect(label.get("text-align")).toBe("center");
    expect(label.has("padding-left")).toBe(false);
    expect(label.has("padding-right")).toBe(false);
    expect(chevron.get("position")).toBe("static");
    expect(chevron.get("grid-column")).toBe("3");
    expect(chevron.get("grid-row")).toBe("1");
    expect(chevron.get("justify-self")).toBe("end");
    expect(chevron.get("flex-shrink")).toBe("0");
    expect(chevron.has("right")).toBe(false);
  });

  it("truncates long labels without shrinking or overlapping the chevron", () => {
    const label = declarationsFor(".settings-dropdown__trigger span");

    expect(label.get("min-width")).toBe("0");
    expect(label.get("overflow")).toBe("hidden");
    expect(label.get("text-overflow")).toBe("ellipsis");
    expect(label.get("white-space")).toBe("nowrap");
  });

  it("does not reintroduce absolute chevrons or compensating label gutters in any variant", () => {
    const overrides: string[] = [];
    stylesheet.walkRules((rule) => {
      if (!rule.selector.includes(".settings-dropdown__trigger")) return;
      rule.walkDecls((declaration) => {
        if (
          /^(padding-left|padding-right|padding-inline-start|padding-inline-end|left|right)$/.test(declaration.prop)
          || (declaration.prop === "position" && declaration.value === "absolute")
        ) overrides.push(`${rule.selector}: ${declaration.toString()}`);
      });
    });

    expect(overrides).toEqual([]);
  });

  it("uses the same side padding and icon gap for catalogue filter triggers", () => {
    const trigger = declarationsFor(".catalogue-filter-section__header");

    expect(trigger.get("padding")).toBe("0 var(--space-6)");
    expect(trigger.get("gap")).toBe("var(--space-4)");
  });

  it("retains the chevron rotation when the menu opens", () => {
    expect(declarationsFor(".settings-dropdown--open .settings-dropdown__trigger svg").get("transform")).toBe("rotate(180deg)");
  });
});
