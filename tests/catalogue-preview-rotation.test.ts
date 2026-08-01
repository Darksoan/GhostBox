import { describe, expect, it } from "vitest";
import { getNextReadyScreenshotSource } from "../src/utils/cataloguePreview";

describe("catalogue preview screenshot rotation", () => {
  it("skips screenshots that have not finished decoding", () => {
    const sources = ["screenshot-a", "screenshot-b", "screenshot-c"];
    const readySources = new Set(["screenshot-a", "screenshot-c"]);

    expect(
      getNextReadyScreenshotSource(sources, readySources, "screenshot-a")
    ).toBe("screenshot-c");
  });

  it("keeps the current screenshot when no other decoded source exists", () => {
    const sources = ["screenshot-a", "screenshot-b"];
    const readySources = new Set(["screenshot-a"]);

    expect(
      getNextReadyScreenshotSource(sources, readySources, "screenshot-a")
    ).toBe("screenshot-a");
  });

  it("selects the first decoded screenshot when nothing is visible", () => {
    const sources = ["screenshot-a", "screenshot-b"];
    const readySources = new Set(["screenshot-b"]);

    expect(getNextReadyScreenshotSource(sources, readySources, null)).toBe(
      "screenshot-b"
    );
  });
});
