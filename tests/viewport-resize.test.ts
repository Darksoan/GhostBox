import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWindow {
  addEventListener: (type: string, listener: () => void, options?: unknown) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  emit: (type: string) => void;
  listenerCount: (type: string) => number;
}

function createFakeWindow(): FakeWindow {
  const registry = new Map<string, Set<() => void>>();

  return {
    addEventListener(type, listener) {
      const listeners = registry.get(type) ?? new Set();
      listeners.add(listener);
      registry.set(type, listeners);
    },
    removeEventListener(type, listener) {
      registry.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of [...(registry.get(type) ?? [])]) listener();
    },
    listenerCount(type) {
      return registry.get(type)?.size ?? 0;
    },
  };
}

describe("viewportResize — sinal de arrasto da janela", () => {
  let fakeWindow: FakeWindow;
  let classList: Set<string>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    fakeWindow = createFakeWindow();
    classList = new Set<string>();

    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          toggle: (name: string, force: boolean) => {
            if (force) classList.add(name);
            else classList.delete(name);
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function loadModule() {
    return import("../src/utils/viewportResize");
  }

  it("marca is-resizing no primeiro evento e limpa quando a largura assenta", async () => {
    const { startViewportResizeTracking, isViewportResizing } = await loadModule();
    const release = startViewportResizeTracking();

    fakeWindow.emit("resize");
    expect(isViewportResizing()).toBe(true);
    expect(classList.has("is-resizing")).toBe(true);

    // Arrasto contínuo: cada evento adia o assentamento.
    vi.advanceTimersByTime(100);
    fakeWindow.emit("resize");
    vi.advanceTimersByTime(100);
    expect(isViewportResizing()).toBe(true);

    vi.advanceTimersByTime(200);
    expect(isViewportResizing()).toBe(false);
    expect(classList.has("is-resizing")).toBe(false);

    release();
  });

  it("notifica os inscritos uma vez por transição, não por evento", async () => {
    const { startViewportResizeTracking, subscribeViewportResize } = await loadModule();
    const release = startViewportResizeTracking();
    const states: boolean[] = [];
    const unsubscribe = subscribeViewportResize((resizing) => states.push(resizing));

    fakeWindow.emit("resize");
    fakeWindow.emit("resize");
    fakeWindow.emit("resize");
    vi.advanceTimersByTime(500);

    expect(states).toEqual([true, false]);

    unsubscribe();
    release();
  });

  it("mantém um único listener mesmo com vários consumidores", async () => {
    const { startViewportResizeTracking } = await loadModule();

    const releaseFirst = startViewportResizeTracking();
    const releaseSecond = startViewportResizeTracking();
    expect(fakeWindow.listenerCount("resize")).toBe(1);

    releaseFirst();
    expect(fakeWindow.listenerCount("resize")).toBe(1);

    releaseSecond();
    expect(fakeWindow.listenerCount("resize")).toBe(0);
  });
});

describe("viewportResize — estilos durante o arrasto", () => {
  it("suspende transições sob html.is-resizing sem congelar animações", () => {
    const css = postcss.parse(compile("src/app.scss").css);
    let hasTransitionReset = false;
    let freezesAnimations = false;

    css.walkRules((rule) => {
      if (!rule.selector.includes("html.is-resizing")) return;
      rule.walkDecls("transition", (declaration) => {
        if (declaration.value.startsWith("none")) hasTransitionReset = true;
      });
      rule.walkDecls("animation", () => {
        freezesAnimations = true;
      });
    });

    expect(hasTransitionReset).toBe(true);
    expect(freezesAnimations).toBe(false);
  });
});

describe("useWideViewport — histerese na troca de navegação", () => {
  it("usa dois limites para não alternar em cima da fronteira", () => {
    const source = readFileSync("src/hooks/useWideViewport.ts", "utf8");
    expect(source).toContain("hysteresisPx");
    expect(source).toContain("minWidth - hysteresisPx");
  });
});
