import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

function listTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("native browser tooltips", () => {
  it("does not use title attributes on intrinsic HTML elements", () => {
    const violations: string[] = [];

    for (const path of listTsxFiles("src")) {
      const source = readFileSync(path, "utf8");
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.text === "title") {
          const owner = node.parent.parent;
          if (
            (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) &&
            /^[a-z][a-z0-9-]*$/.test(owner.tagName.getText(sourceFile))
          ) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            violations.push(`${relative(".", path)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
