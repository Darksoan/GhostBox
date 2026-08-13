import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWindow {
  addEventListener: (type: string, listener: () => void, options?: unknown) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  emit: (type: string) => void;
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
  };
}

describe("scrollIdle — aviso de rolagem parada", () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fakeWindow = createFakeWindow();
    vi.stubGlobal("window", fakeWindow);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("chama o inscrito uma vez quando a rolagem assenta, não por evento", async () => {
    const { subscribeScrollIdle, isScrolling } = await import(
      "../src/utils/scrollIdle"
    );
    const settled = vi.fn();
    const unsubscribe = subscribeScrollIdle(settled);

    fakeWindow.emit("scroll");
    fakeWindow.emit("scroll");
    expect(isScrolling()).toBe(true);
    expect(settled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(isScrolling()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);

    unsubscribe();
    fakeWindow.emit("scroll");
    vi.advanceTimersByTime(500);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("continua resolvendo quem espera pela promise de ociosidade", async () => {
    const { pendingScrollIdle } = await import("../src/utils/scrollIdle");

    expect(pendingScrollIdle()).toBeNull();

    fakeWindow.emit("scroll");
    const pending = pendingScrollIdle();
    expect(pending).not.toBeNull();

    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toBeUndefined();
  });
});
