import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/app.scss", import.meta.url),
  "utf8",
);

/** A CSS/SCSS rule and every nested rule inside it. */
function cssBlock(selector: string) {
  const start = source.indexOf(`\n${selector} {`);
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

  throw new Error(`Unterminated ${selector} block in app.scss`);
}

function directDeclarations(block: string) {
  const declarations: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of block) {
    if (char === "{") {
      depth += 1;
      if (depth > 1) current = "";
      continue;
    }
    if (char === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 1) continue;

    current += char;
    if (char === ";") {
      declarations.push(current.trim());
      current = "";
    }
  }

  return declarations.join("\n");
}

function toastBlock() {
  return cssBlock(".toast");
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
    expect(block).toMatch(/--error[\s\S]{0,200}color:\s*var\(--toast-error-icon\)/);
    expect(block).toMatch(/--success[\s\S]{0,200}color:\s*var\(--success\)/);
  });

  it("keeps toast text and icons free from decorative motion", () => {
    expect(block).toMatch(/animation:\s*none/);
    expect(block).not.toMatch(/animation:\s*toast-(?:in|out|icon-in)/);
    expect(cssBlock(".achievement-toast")).not.toMatch(
      /animation:\s*toast-(?:in|out|icon-in)/,
    );
  });

  it("keeps each toast surface opaque", () => {
    const roots = [block, cssBlock(".achievement-toast")].map(directDeclarations);

    for (const root of roots) {
      expect(root).not.toMatch(/\bopacity\s*:/);
      expect(root).not.toMatch(/will-change:[^;]*\bopacity\b/);
    }
  });

  it("keeps achievement toasts at the common toast height", () => {
    const achievement = cssBlock(".achievement-toast");

    // Both variants use a 40px content row, 32px of vertical padding and a
    // 4px progress bar, so a title plus description has the same 76px height.
    expect(achievement).toMatch(
      /&__content\s*\{[\s\S]*?padding:\s*var\(--space-8\);/,
    );
    expect(achievement).toMatch(
      /&__media\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/,
    );
  });
});

describe("toast surface token", () => {
  it("is declared with the other semantic surfaces", () => {
    const semantic = readFileSync(
      new URL("../src/styles/_semantic.scss", import.meta.url),
      "utf8",
    );

    expect(semantic).toMatch(/--surface-toast:\s*var\(--c-1\);/);
  });
});

describe("toast error icon token", () => {
  it("uses the dedicated #cc2727 semantic color", () => {
    const semantic = readFileSync(
      new URL("../src/styles/_semantic.scss", import.meta.url),
      "utf8",
    );

    expect(semantic).toMatch(/--toast-error-icon:\s*#cc2727;/);
  });
});

describe("common toast lifecycle", () => {
  const toastSource = readFileSync(
    new URL("../src/components/ui/Toast.tsx", import.meta.url),
    "utf8",
  );
  const overlaySource = readFileSync(
    new URL("../src/context/OverlayContext.tsx", import.meta.url),
    "utf8",
  );

  it("lets the provider remove the rendered toast after its cooldown", () => {
    expect(overlaySource).toMatch(
      /window\.setTimeout\(\(\) => setToast\(null\), notifications\.toastDurationSeconds \* 1000\)/,
    );
    expect(toastSource).toContain("if (!toast) return null");
    expect(toastSource).not.toContain("setDisplayed");
    expect(toastSource).not.toContain("TOAST_EXIT_MS");
  });
});

describe("achievement toast lifecycle", () => {
  const achievementSource = readFileSync(
    new URL("../src/components/ui/AchievementToast.tsx", import.meta.url),
    "utf8",
  );

  it("dismisses immediately when its cooldown ends", () => {
    expect(achievementSource).toMatch(
      /window\.setTimeout\(\s*handleClose,\s*notifications\.toastDurationSeconds \* 1000,?\s*\)/,
    );
    expect(achievementSource).toContain("onClose(toast.id)");
    expect(achievementSource).not.toContain("ACHIEVEMENT_TOAST_EXIT_MS");
  });
});
