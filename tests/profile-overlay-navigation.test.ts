import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("profile sidebar navigation with an open game overlay", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const overlaySource = readFileSync("src/context/OverlayContext.tsx", "utf8");

  it("closes the overlay before changing the selected profile tab", () => {
    expect(appSource).toMatch(
      /const handleProfileTabChange = useCallback\(\s*\(tabId: string\) => \{\s*clearOverlayForward\(\);\s*closeContentOverlay\(\);\s*shell\.setActiveProfileCollectionId\(tabId\);/,
    );
  });

  it("invalidates a pending asynchronous game opening when closing the overlay", () => {
    expect(overlaySource).toMatch(
      /const closeContentOverlay = useCallback\(\(\) => \{\s*openGameRequestRef\.current \+= 1;\s*clearOverlayExitTimeout\(\);/,
    );
  });
});
