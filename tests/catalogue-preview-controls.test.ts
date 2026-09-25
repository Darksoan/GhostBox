import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdjacentReadyScreenshotSource,
  pickDistinctScreenshotSources,
} from "../src/utils/cataloguePreview";
import {
  getLoadedImageSource,
  imageSourceCache,
  loadedImageSources,
} from "../src/utils/imageCache";
import * as steamAssetManifest from "../src/utils/steamAssetManifest";

describe("catalogue preview loaded image lookup", () => {
  const source = "https://cdn.cloudflare.steamstatic.com/steam/apps/123/ss_preview_test.jpg";
  const cachedSource = "asset://preview-test.jpg";

  afterEach(() => {
    imageSourceCache.delete(source);
    loadedImageSources.delete(source);
    loadedImageSources.delete(cachedSource);
    vi.restoreAllMocks();
  });

  it("checks cold and loaded sources without requesting manifests", () => {
    const request = vi.spyOn(steamAssetManifest, "requestSteamAssetManifests")
      .mockImplementation(() => {});

    expect(getLoadedImageSource([source])).toBeUndefined();
    loadedImageSources.add(source);
    expect(getLoadedImageSource([source])).toBe(source);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses a cached alternative only after it has loaded", () => {
    imageSourceCache.set(source, cachedSource);
    expect(getLoadedImageSource([source])).toBeUndefined();

    loadedImageSources.add(cachedSource);
    expect(getLoadedImageSource([source])).toBe(cachedSource);
  });
});

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

  it("prefers a loaded alternative but excludes failed sources", () => {
    const groups = [["shot", "shot-cached", "shot-cdn"]];
    const ready = new Set(["shot-cached", "shot-cdn"]);

    expect(pickDistinctScreenshotSources(groups, new Set(), ready))
      .toEqual(["shot-cached"]);
    expect(pickDistinctScreenshotSources(groups, new Set(["shot-cached"]), ready))
      .toEqual(["shot-cdn"]);
  });

  it("keeps the preview accessible with hover/focus retention wired to the parent", () => {
    const component = readFileSync(
      "src/components/ui/CatalogueHoverPreview.tsx",
      "utf8"
    );

    // Sem controles manuais desde o redesign: o painel é só leitura. A
    // acessibilidade vive no rótulo da seção e no espelhamento hover↔foco; as
    // shots chegam individualmente enquanto o título já está visível.
    expect(component).toContain("aria-label={");
    expect(component).toContain("onFocusCapture={handlePreviewFocus}");
    expect(component).toContain("onBlurCapture={handlePreviewBlur}");
    expect(component).toContain("onPointerEnter={onPointerEnter}");
    expect(component).toContain("onPointerLeave={onPointerLeave}");
    expect(component).toContain("aria-busy={Boolean(pendingPreview)}");
    expect(component).toContain("pendingPreview.shots.every(isSettled)");
    expect(component).toContain("catalogue-hover-preview__shot--empty");
  });
});
