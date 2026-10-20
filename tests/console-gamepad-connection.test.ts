import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (subscribe: typeof state.subscribe, snapshot: () => boolean) => {
    state.subscribe = subscribe;
    return snapshot();
  },
}));

import { useConsoleGamepadConnected } from "../src/features/console/useConsoleInput";

let pads: ({ connected: boolean } | null)[];
beforeEach(() => {
  pads = [];
  vi.stubGlobal("navigator", { getGamepads: () => pads });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

describe("console gamepad connection", () => {
  it("requires a connected gamepad, independently of keyboard or pointer input", () => {
    expect(useConsoleGamepadConnected()).toBe(false);
    pads = [null, { connected: false }];
    expect(useConsoleGamepadConnected()).toBe(false);
    pads.push({ connected: true });
    expect(useConsoleGamepadConnected()).toBe(true);
  });

  it("updates when a gamepad connects or disconnects and removes event listeners on cleanup", () => {
    useConsoleGamepadConnected();
    const changed = vi.fn();
    const unsubscribe = state.subscribe!(changed);

    pads = [{ connected: true }];
    window.dispatchEvent(new Event("gamepadconnected"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(useConsoleGamepadConnected()).toBe(true);

    pads = [];
    window.dispatchEvent(new Event("gamepaddisconnected"));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(useConsoleGamepadConnected()).toBe(false);

    unsubscribe();
    window.dispatchEvent(new Event("gamepadconnected"));
    window.dispatchEvent(new Event("gamepaddisconnected"));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("stays hidden when the Gamepad API is unavailable or blocked", () => {
    vi.stubGlobal("navigator", {});
    expect(useConsoleGamepadConnected()).toBe(false);
    vi.stubGlobal("navigator", { getGamepads: () => { throw new Error("Blocked"); } });
    expect(useConsoleGamepadConnected()).toBe(false);
  });
});
