import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveConsoleFocus } from "../src/features/console/useConsoleInput";
import { ConsoleHints } from "../src/features/console/ConsoleParts";

// Ambiente sem DOM: elementos falsos só com o que a navegação espacial usa.
class FakeElement {
  focused = false;
  constructor(public name: string, private rect: { left: number; top: number; width: number; height: number }) {}
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  closest(selector: string) { return selector.includes("aria-hidden") ? null : this; }
  focus() { this.focused = true; (globalThis as { document: { activeElement: unknown } }).document.activeElement = this; }
  scrollIntoView() {}
}

function grid() {
  // Duas linhas de três cards 100×100 com vão de 20, mais um botão largo acima.
  const button = new FakeElement("hero", { left: 0, top: 0, width: 240, height: 50 });
  const cards = [0, 1].flatMap((row) => [0, 1, 2].map((col) =>
    new FakeElement(`r${row}c${col}`, { left: col * 120, top: 100 + row * 120, width: 100, height: 100 })));
  const elements = [button, ...cards];
  const scope = {
    querySelectorAll: () => elements,
    contains: (element: unknown) => elements.includes(element as FakeElement),
  } as unknown as HTMLElement;
  return { scope, button, cards };
}

const active = () => (globalThis as unknown as { document: { activeElement: FakeElement | null } }).document.activeElement;

beforeEach(() => {
  Object.assign(globalThis, { HTMLElement: FakeElement, document: { activeElement: null } });
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).HTMLElement;
  delete (globalThis as Record<string, unknown>).document;
});

describe("console spatial navigation", () => {
  it("focuses the first focusable when nothing is focused yet", () => {
    const { scope, button } = grid();
    expect(moveConsoleFocus(scope, "down")).toBe(true);
    expect(active()).toBe(button);
  });

  it("moves along the row before jumping diagonally", () => {
    const { scope, cards } = grid();
    cards[0].focus();
    moveConsoleFocus(scope, "right");
    expect(active()?.name).toBe("r0c1");
    moveConsoleFocus(scope, "down");
    expect(active()?.name).toBe("r1c1");
    moveConsoleFocus(scope, "left");
    expect(active()?.name).toBe("r1c0");
  });

  it("goes up from the cards to the hero button and stops at the edges", () => {
    const { scope, cards } = grid();
    cards[2].focus();
    expect(moveConsoleFocus(scope, "right")).toBe(false);
    expect(active()?.name).toBe("r0c2");
    moveConsoleFocus(scope, "up");
    expect(active()?.name).toBe("hero");
    expect(moveConsoleFocus(scope, "up")).toBe(false);
  });
});

describe("console chrome", () => {
  it("keeps the loading spinner rotating even when decorative animations are disabled", () => {
    const stylesheet = postcss.parse(compile("src/features/console/console.scss").css);
    let spinnerAnimation = "";
    const rotation: Record<string, string> = {};
    const disabledSelectors: string[] = [];
    stylesheet.walkRules((rule) => {
      if (rule.selector === ".console-spin") {
        rule.walkDecls("animation", (declaration) => { spinnerAnimation = declaration.value; });
      }
      rule.walkDecls("animation", (declaration) => {
        if (declaration.value === "none" && declaration.important) disabledSelectors.push(...rule.selectors);
      });
    });
    stylesheet.walkAtRules("keyframes", (rule) => {
      if (rule.params !== "console-spin") return;
      rule.walkRules((frame) => {
        frame.walkDecls("transform", (declaration) => { rotation[frame.selector] = declaration.value; });
      });
    });
    expect(spinnerAnimation).toBe("console-spin 0.8s linear infinite");
    expect(rotation).toEqual({ from: "rotate(0deg)", to: "rotate(360deg)" });
    expect(disabledSelectors).toContain("html.no-animations .console-shell *:not(.console-spin)");
    expect(disabledSelectors).toContain(".console-shell *:not(.console-spin)");
    expect(disabledSelectors).not.toContain("html.no-animations .console-shell *");
    expect(disabledSelectors).not.toContain(".console-shell *");
  });

  it("renders controller hints with filled face glyphs and shoulder caps", () => {
    const markup = renderToStaticMarkup(createElement(ConsoleHints, { hints: [
      { glyphs: ["cross"], label: "Selecionar" },
      { glyphs: ["l1", "r1"], label: "Seções" },
    ] }));
    expect(markup).toContain('<footer class="console-hints" aria-hidden="true">');
    expect(markup).toContain("Selecionar");
    expect(markup).toContain('<circle class="console-glyph__face" cx="12" cy="12" r="11"></circle>');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('<span class="console-cap" aria-hidden="true">L1</span><span class="console-cap" aria-hidden="true">R1</span>');
  });

  it("keeps resets at zero specificity, lifts focused covers and lays out six columns", () => {
    const stylesheet = postcss.parse(compile("src/features/console/console.scss").css);
    const selectors: string[] = [];
    const declarations: Record<string, Record<string, string>> = {};
    stylesheet.walkRules((rule) => {
      selectors.push(...rule.selectors);
      for (const selector of rule.selectors) {
        declarations[selector] ??= {};
        rule.walkDecls((declaration) => { declarations[selector][declaration.prop] = declaration.value; });
      }
    });
    expect(selectors).toContain(".console-shell :where(button)");
    expect(selectors).not.toContain(".console-shell button");
    expect(declarations[".console-card:focus > .console-card__cover"].transform).toContain("translateY(calc(-1 *");
    expect(declarations[".console-card:focus > .console-card__cover::after"]).toMatchObject({ opacity: "1" });
    expect(declarations[".console-grid"]).toMatchObject({ "grid-template-columns": "repeat(6, minmax(0, 1fr))" });
    // Medidas da referência de 1920 escalam pela janela, com piso de 60% e teto no valor original.
    expect(declarations[".console-header"]).toMatchObject({ height: "clamp(58px, 5vw, 96px)" });
    expect(declarations[".console-button::after"].border).toBe("1px solid var(--console-ring-base)");
    expect(declarations[".console-spotlight__title"]["font-size"]).toContain("52px");
    expect(declarations[".console-shell"]).toMatchObject({ "--ui-icon-size": "24px", "--ui-icon-stroke-width": "1.5" });
    expect(declarations[".console-glyph"]).toMatchObject({ width: "24px", height: "24px", flex: "0 0 24px" });
    expect(declarations[".console-glyph path"]).toMatchObject({ "vector-effect": "non-scaling-stroke" });
    expect(declarations[".console-brand img"]).toBeUndefined();
    expect(declarations[".console-header"]["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");
    expect(declarations[".console-game__hero"]["border-bottom"]).toBe("1px solid var(--console-line)");
    expect(declarations[".console-facts"]["border-bottom"]).toBe("1px solid var(--console-line)");
    expect(declarations[".console-fact"]["border-top"]).toBe("1px solid var(--console-line)");
    expect(declarations[".console-toolbar .console-pill::after"]).toMatchObject({ content: "none" });
    expect(declarations[".console-toolbar .console-pill:focus-visible"]).toMatchObject({ outline: "none" });
    expect(declarations[".console-search input:focus-visible"]).toMatchObject({ outline: "none", "box-shadow": "none" });
    expect(declarations[".console-search::after"]).toBeUndefined();
    expect(declarations[".console-search:focus-within::after"]).toBeUndefined();
  });
});

describe("console mouse support", () => {
  it("starts in pointer mode without a controller and parks automatic focus instead of applying it", async () => {
    const { getConsoleInputMode, requestConsoleFocus } = await import("../src/features/console/useConsoleInput");
    expect(getConsoleInputMode()).toBe("pointer");
    let focused = false;
    requestConsoleFocus({ focus: () => { focused = true; }, scrollIntoView: () => {} } as unknown as HTMLElement);
    expect(focused).toBe(false);
  });

  it("hides the cursor for controller input and mirrors focus effects on hover for the mouse", () => {
    const stylesheet = postcss.parse(compile("src/features/console/console.scss").css);
    const rules = new Map<string, Record<string, string>>();
    stylesheet.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const declarations = rules.get(selector) ?? {};
        rule.walkDecls((declaration) => { declarations[declaration.prop] = declaration.value; });
        rules.set(selector, declarations);
      }
    });
    expect(rules.get('.console-shell[data-input=controller] *')).toMatchObject({ cursor: "none" });
    expect(rules.get('.console-shell[data-input=pointer] .console-card:hover > .console-card__cover')?.transform).toContain("translateY");
    expect(rules.get('.console-shell[data-input=pointer] .console-card:hover > .console-card__cover::after')).toMatchObject({ opacity: "1" });
    expect(rules.get('.console-shell[data-input=pointer] .console-button:hover:not(:disabled)::after')).toMatchObject({ opacity: "1" });
    expect(rules.get('.console-shell[data-input=pointer] .console-header button::after')).toMatchObject({ content: "none" });
    expect(rules.get('.console-shell[data-input=pointer] .console-button--no-hover-border::after')).toMatchObject({ content: "none" });
  });
});

describe("console button borders", () => {
  it("uses a static one-pixel decorative border instead of glowing or pulsing rings", () => {
    const stylesheet = postcss.parse(compile("src/features/console/console.scss").css);
    const rules = new Map<string, Record<string, string>>();
    stylesheet.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const declarations = rules.get(selector) ?? {};
        rule.walkDecls((declaration) => { declarations[declaration.prop] = declaration.value; });
        rules.set(selector, declarations);
      }
    });
    const border = rules.get(".console-button::after")!;
    expect(border.border).toBe("1px solid var(--console-ring-base)");
    expect(border["pointer-events"]).toBe("none");
    expect(border["box-shadow"]).toBeUndefined();
    expect(border.animation).toBeUndefined();
    expect(border.background).toBeUndefined();
    expect(rules.get(".console-button:focus::after")).toMatchObject({ opacity: "1" });
    expect(rules.get(".console-button--outline")?.border).toMatch(/^1px solid /);
    expect(rules.has(".console-button--primary:focus::before")).toBe(false);
    expect(stylesheet.toString()).not.toContain("--console-halo");
    expect(stylesheet.toString()).not.toContain("console-breathe");
    for (const [selector, declarations] of rules) {
      if (selector.endsWith("::after") && declarations.border?.includes("--console-ring-base")) {
        expect(declarations.border, selector).toBe("1px solid var(--console-ring-base)");
        expect(declarations.animation, selector).toBeUndefined();
      }
    }
  });
});

describe("console game page and search helpers", () => {
  it("turns store HTML into paragraphs and keeps short upper-case lines as headings", async () => {
    const { storeTextParagraphs } = await import("../src/features/console/consoleText");
    expect(storeTextParagraphs("<h2>ABOUT THIS GAME</h2><p>First line.<br>Second &amp; last.</p><ul><li>One</li><li>Two</li></ul>"))
      .toEqual(["ABOUT THIS GAME", "First line.", "Second & last.", "One", "Two"]);
    expect(storeTextParagraphs(undefined)).toEqual([]);
  });

  it("edits the on-screen keyboard query without leading or doubled spaces", async () => {
    const { editConsoleQuery } = await import("../src/features/console/ConsoleSearch");
    expect(editConsoleQuery("", " ")).toBe("");
    expect(editConsoleQuery("hol", "l")).toBe("holl");
    expect(editConsoleQuery("hollow ", " ")).toBe("hollow ");
    expect(editConsoleQuery("hollow", "delete")).toBe("hollo");
    expect(editConsoleQuery("hollow", "clear")).toBe("");
    expect(editConsoleQuery("x".repeat(40), "y")).toHaveLength(40);
  });
});
