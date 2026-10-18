import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(compile("src/app.scss").css);

function declarationsFor(...selectors: string[]) {
  const declarations = new Map<string, string>();
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selectors.includes(selector))) return;
    rule.walkDecls((declaration) => declarations.set(declaration.prop, declaration.value));
  });
  return declarations;
}

describe("Dialog spacing hierarchy", () => {
  it.each(["collection-modal", "steam-path-modal"])("groups %s titles and descriptions more closely than fields and actions", (prefix) => {
    const heading = declarationsFor(
      `.${prefix}__header > div`,
      `.backdrop--confirm > .${prefix} .${prefix}__header > div`,
      `.collection-create-modal .${prefix}__header > div`,
    );
    const body = declarationsFor(`.${prefix}__content`, `.collection-create-modal .${prefix}__content`);
    const footer = declarationsFor(`.${prefix}__actions`);

    expect(heading.get("gap")).toBe("var(--space-4)");
    expect(body.get("margin-top")).toBe("var(--space-9)");
    expect(body.get("gap")).toBe("var(--space-8)");
    expect(footer.get("padding")).toBe("var(--space-10)");
  });

  it.each(["collection-modal", "steam-path-modal"])("keeps %s content scrollable independently of its footer", (prefix) => {
    const header = declarationsFor(`.${prefix}__header`);
    const body = declarationsFor(`.${prefix}__content`);
    const footer = declarationsFor(`.${prefix}__actions`);

    expect(header.get("padding")).toBe("var(--space-10) var(--space-10) 0");
    expect(body.get("padding")).toBe("0 var(--space-10)");
    expect(body.get("min-height")).toBe("0");
    expect(body.get("overflow-y")).toBe("auto");
    expect(footer.get("flex-shrink")).toBe("0");
    expect(footer.get("flex-wrap")).toBe("wrap");
  });

  it("keeps field labels closer to their controls than to other groups", () => {
    expect(declarationsFor(".collection-modal__field").get("gap")).toBe("var(--space-4)");
    expect(declarationsFor(".feedback-modal__field").get("gap")).toBe("var(--space-4)");
  });

  it("keeps generic confirmation descriptions close to their heading", () => {
    expect(declarationsFor(".confirm-modal__content").get("padding")).toBe("var(--space-4) var(--space-10) 0");
    expect(declarationsFor(".confirm-modal__actions").get("padding")).toBe("var(--space-10)");
  });
});

describe("Dialog structure", () => {
  it.each([
    "src/components/modals/CollectionModal.tsx",
    "src/components/modals/UninstallConfirmModal.tsx",
    "src/components/subscription/BackupConfirmModal.tsx",
    "src/components/modals/FeedbackModal.tsx",
    "src/components/modals/SteamPathModal.tsx",
    "src/components/modals/EditProfileModal.tsx",
    "src/pages/ProfilePage.tsx",
  ])("keeps the title and description together and actions in a separate footer in %s", (path) => {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const footers: ts.JsxElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "footer") {
        const attributes = node.openingElement.attributes.getText(source);
        if (/className="[^"]*(collection-modal|steam-path-modal)__actions/.test(attributes)) footers.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    expect(footers).toHaveLength(1);
    const dialog = footers[0].parent;
    expect(ts.isJsxElement(dialog)).toBe(true);
    if (!ts.isJsxElement(dialog)) return;

    expect(dialog.openingElement.attributes.getText(source)).toMatch(/className=[\s\S]*(collection-modal|steam-path-modal)/);
    const header = dialog.children.find((child) => ts.isJsxElement(child) && child.openingElement.tagName.getText(source) === "header");
    expect(header?.getText(source)).toContain("<h3");
    expect(header?.getText(source)).toContain("<p");
    expect(header!.pos).toBeLessThan(footers[0].pos);
  });
});
