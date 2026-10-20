import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  native: true,
  effect: undefined as undefined | (() => void | (() => void)),
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
}));
vi.mock("react", () => ({ useEffect: (effect: typeof state.effect) => { state.effect = effect; } }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.native }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: state.isFullscreen, setFullscreen: state.setFullscreen }),
}));

let fullscreen = false;
let useConsoleFullscreen: typeof import("../src/features/console/useConsoleFullscreen").useConsoleFullscreen;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function mount() {
  useConsoleFullscreen();
  return state.effect!();
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  fullscreen = false;
  state.native = true;
  state.isFullscreen.mockImplementation(async () => fullscreen);
  state.setFullscreen.mockImplementation(async (value: boolean) => { fullscreen = value; });
  ({ useConsoleFullscreen } = await import("../src/features/console/useConsoleFullscreen"));
});
afterEach(() => vi.restoreAllMocks());

describe("console native fullscreen", () => {
  it("enters fullscreen when mounted and restores the window on exit", async () => {
    const unmount = mount();
    await flush();
    expect(state.setFullscreen).toHaveBeenCalledExactlyOnceWith(true);
    expect(fullscreen).toBe(true);
    unmount?.();
    await flush();
    expect(state.setFullscreen.mock.calls).toEqual([[true], [false]]);
    expect(fullscreen).toBe(false);
  });

  it("preserves a window that was already fullscreen", async () => {
    fullscreen = true;
    const unmount = mount();
    await flush();
    unmount?.();
    await flush();
    expect(fullscreen).toBe(true);
    expect(state.setFullscreen).not.toHaveBeenCalled();
  });

  it("serializes exit and reentry while entering fullscreen is still pending", async () => {
    let finishEntering!: () => void;
    state.setFullscreen.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishEntering = () => { fullscreen = true; resolve(); };
    }));
    const firstUnmount = mount();
    await flush();
    firstUnmount?.();
    const secondUnmount = mount();
    expect(state.setFullscreen.mock.calls).toEqual([[true]]);
    finishEntering();
    await flush();
    expect(state.setFullscreen.mock.calls).toEqual([[true], [false], [true]]);
    expect(fullscreen).toBe(true);
    secondUnmount?.();
    await flush();
    expect(fullscreen).toBe(false);
  });

  it("handles StrictMode's immediate cleanup and remount", async () => {
    const firstUnmount = mount();
    firstUnmount?.();
    const secondUnmount = mount();
    await flush();
    expect(state.setFullscreen).toHaveBeenCalledExactlyOnceWith(true);
    secondUnmount?.();
    await flush();
    expect(fullscreen).toBe(false);
  });

  it("does not call native window APIs in the browser preview", async () => {
    state.native = false;
    expect(mount()).toBeUndefined();
    await flush();
    expect(state.isFullscreen).not.toHaveBeenCalled();
    expect(state.setFullscreen).not.toHaveBeenCalled();
  });

  it("grants the native fullscreen permissions", () => {
    const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
    expect(capability.permissions).toContain("core:window:allow-is-fullscreen");
    expect(capability.permissions).toContain("core:window:allow-set-fullscreen");
  });
});
