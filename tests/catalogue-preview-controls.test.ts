import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAdjacentReadyScreenshotSource } from "../src/utils/cataloguePreview";

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

  it("renders accessible controls and pauses autoplay on preview hover", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    expect(component).toContain("catalogue-hover-preview__control");
    expect(component).toContain("previousScreenshot");
    expect(component).toContain("nextScreenshot");
    expect(component).toContain("getAdjacentReadyScreenshotSource");
    expect(component).toContain("isAutoplayPaused");
    expect(component).toContain("onFocusCapture");
    expect(component).toContain("onBlurCapture");
  });
});
