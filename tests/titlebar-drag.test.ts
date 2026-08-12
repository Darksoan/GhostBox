import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/layout/Header.tsx", "utf8");

describe("Titlebar drag lifecycle", () => {
  it("captures the pointer before awaiting any window query", () => {
    const capture = source.indexOf("setPointerCapture");
    const firstAwait = source.indexOf("await win.isMaximized()");

    expect(capture).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstAwait);
  });

  it("invalidates a gesture that was released while the window queries resolved", () => {
    expect(source).toContain("titlebarGestureRef");
    // The drag state may only be armed if the gesture claimed at pointerdown is
    // still the active one after every await.
    const armDrag = source.indexOf("titlebarDragRef.current = {");
    const guard = source.indexOf("titlebarGestureRef.current !== gestureId");

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(armDrag);
    // Releasing (up/cancel/lost capture) must bump the token, not just clear state.
    expect(source).toContain("titlebarGestureRef.current += 1");
  });

  it("drops a stale drag when a move arrives with no button held", () => {
    expect(source).toContain("event.buttons === 0");
  });

  it("ends the drag when the window loses focus", () => {
    expect(source).toMatch(/addEventListener\("blur"/);
  });
});
