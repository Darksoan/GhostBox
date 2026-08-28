import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCatalogueHoverPreviewIntent,
  getAdjacentReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../src/utils/cataloguePreview";

describe("catalogue preview manual navigation", () => {
  it("advances to the next ready screenshot and wraps", () => {
    const ready = new Set(["a", "b", "c"]);

    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "b", "next")
    ).toBe("c");
    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "c", "next")
    ).toBe("a");
  });

  it("skips unready screenshots in both directions", () => {
    const ready = new Set(["a", "c"]);

    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "a", "next")
    ).toBe("c");
    expect(
      getAdjacentReadyScreenshotSource(
        ["a", "b", "c"],
        ready,
        "c",
        "previous"
      )
    ).toBe("a");
  });

  it("advances from the first ready screenshot when no active source has committed yet", () => {
    const ready = new Set(["a", "b", "c"]);

    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, null, "next")
    ).toBe("b");
    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, null, "previous")
    ).toBe("c");
  });

  it("still steps when no screenshot has decoded yet", () => {
    const ready = new Set<string>();

    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "a", "next")
    ).toBe("b");
    expect(
      getAdjacentReadyScreenshotSource(["a", "b", "c"], ready, "a", "previous")
    ).toBe("c");
  });

  it("keeps one source per screenshot so a single click changes the picture", () => {
    const groups = [
      ["shot-1-cached", "shot-1", "shot-1-cdn"],
      ["shot-2", "shot-2-cdn"],
      ["shot-3", "shot-3-cdn"],
    ];

    expect(pickDistinctScreenshotSources(groups, new Set())).toEqual([
      "shot-1-cached",
      "shot-2",
      "shot-3",
    ]);
  });

  it("falls back to the next candidate of a screenshot that failed", () => {
    const groups = [
      ["shot-1", "shot-1-cdn"],
      ["shot-2", "shot-2-cdn"],
    ];

    expect(
      pickDistinctScreenshotSources(groups, new Set(["shot-1"]))
    ).toEqual(["shot-1-cdn", "shot-2"]);
  });

  it("never repeats the same source across screenshots", () => {
    const groups = [
      ["shared", "shot-1-cdn"],
      ["shared", "shot-2-cdn"],
    ];

    expect(pickDistinctScreenshotSources(groups, new Set())).toEqual([
      "shared",
      "shot-2-cdn",
    ]);
  });

  it("keeps the preview accessible with hover/focus retention wired to the parent", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    // Sem controles manuais desde o redesign: o painel é só leitura. A
    // acessibilidade vive no rótulo da seção, no espelhamento hover↔foco e na
    // visibilidade atrelada ao hover; as shots só revelam quando 100% decodificadas
    // (skeleton até lá, sem progressivo).
    expect(component).toContain("aria-label={");
    expect(component).toContain("onFocusCapture={handlePreviewFocus}");
    expect(component).toContain("onBlurCapture={handlePreviewBlur}");
    expect(component).toContain("onPointerEnter={handlePreviewPointerEnter}");
    expect(component).toContain("onPointerLeave={handlePreviewPointerLeave}");
    expect(component).toContain("aria-hidden={!isPanelVisible}");
    expect(component).toContain("isPanelVisible = isVisible");
    expect(component).toContain("isShotsReady");
    expect(component).toContain("catalogue-hover-preview__shot--skeleton");
  });
});

describe("catalogue preview hover intent debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the target after the delay elapses", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    expect(onShow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);
    expect(onShow).toHaveBeenCalledWith("game-a");
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("replaces a pending target when scheduled again before it fires", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    vi.advanceTimersByTime(60);
    intent.scheduleShow("game-b");
    vi.advanceTimersByTime(120);

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("game-b");
  });

  it("cancel prevents a pending target from firing", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.cancel();
    vi.advanceTimersByTime(200);

    expect(onShow).not.toHaveBeenCalled();
  });

  it("showImmediately bypasses the delay and cancels any pending target", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.showImmediately("game-b");

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("game-b");

    vi.advanceTimersByTime(200);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels any pending target", () => {
    const onShow = vi.fn();
    const intent = createCatalogueHoverPreviewIntent<string>(onShow, 120);

    intent.scheduleShow("game-a");
    intent.dispose();
    vi.advanceTimersByTime(200);

    expect(onShow).not.toHaveBeenCalled();
  });
});
