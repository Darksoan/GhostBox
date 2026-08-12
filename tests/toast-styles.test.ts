import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/app.scss", import.meta.url),
  "utf8",
);

/** The `.toast` rule and every nested rule inside it. */
function toastBlock() {
  const start = source.indexOf("\n.toast {");
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error("Unterminated .toast block in app.scss");
}

describe("toast styles", () => {
  const block = toastBlock();

  it("carries no decorative border", () => {
    // design.md: borders are reserved for focus, controls that need
    // delimitation and status indicators. Surfaces separate by ramp step.
    const borderDeclarations = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^border(-color|-top|-bottom|-left|-right)?\s*:/.test(line))
      .filter((line) => !/^border-radius\s*:/.test(line));

    expect(borderDeclarations).toEqual([]);
  });

  it("separates from the canvas with its own surface step", () => {
    // Without a border, a toast painted on the canvas colour would be invisible
    // over the page background.
    expect(block).toMatch(/background:\s*var\(--surface-toast\)/);
    expect(source).not.toMatch(/\.toast[\s\S]{0,400}background:\s*var\(--background-dark\)/);
  });

  it("keeps the status colour on the icon and the progress bar", () => {
    expect(block).toMatch(/--error[\s\S]{0,200}color:\s*var\(--danger\)/);
    expect(block).toMatch(/--success[\s\S]{0,200}color:\s*var\(--success\)/);
  });
});

describe("toast surface token", () => {
  it("is declared with the other semantic surfaces", () => {
    const semantic = readFileSync(
      new URL("../src/styles/_semantic.scss", import.meta.url),
      "utf8",
    );

    expect(semantic).toMatch(/--surface-toast:\s*var\(--c-\d\);/);
  });
});
