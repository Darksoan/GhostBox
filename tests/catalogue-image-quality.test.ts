import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as data from "../src/data";
import { SettingsProvider, useSettings } from "../src/context/settings";
import { gameCatalogueHeaderSources } from "../src/utils/image";
import { withCachedImageSources } from "../src/utils/imageCache";

const game = {
  id: "steam-413150",
  appId: "413150",
  coverUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg",
  screenshots: [],
} as data.GhostBoxGame;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function StoredQuality() {
  return String(useSettings().appearance.coverQuality);
}

describe("Catalogue image quality", () => {
  it.each([
    [{}, "100"],
    [{ coverQuality: 50 }, "50"],
    [{ coverQuality: 80 }, "80"],
    [{ coverQuality: 100 }, "100"],
    [{ coverQuality: -1 }, "100"],
  ])("restores saved quality with full quality as default: %j", (stored, expected) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "ghostbox-appearance" ? JSON.stringify(stored) : null,
    });
    expect(renderToStaticMarkup(
      createElement(SettingsProvider, null, createElement(StoredQuality)),
    )).toBe(expected);
  });

  it("uses the high-density catalogue cover first", () => {
    const sources = gameCatalogueHeaderSources(game);
    expect(sources[0]).toContain("/header_2x.jpg");
  });

  it("keeps standard headers as fallbacks for games without high-density art", () => {
    const sources = gameCatalogueHeaderSources(game);
    expect(sources.some((source) => source.endsWith("/header.jpg"))).toBe(true);
    expect(sources.some((source) => source.includes("header_2x"))).toBe(true);
    expect(sources.some((source) => source.includes("capsule_616x353"))).toBe(false);
    expect(sources.some((source) => source.includes("library_hero"))).toBe(false);
  });

  it("preserves the high-density source order while manifests resolve", () => {
    const sources = withCachedImageSources(gameCatalogueHeaderSources(game), {
      requestManifests: false,
      preserveSourceOrder: true,
    });
    expect(sources[0]).toContain("/header_2x.jpg");
  });

  it("allows a late high-density manifest source to replace the fallback", () => {
    const component = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(component).not.toContain("useLockedCoverSource");
    expect(component).toContain("useLoadableImageCover(headerSources, { preferOrder: true })");
  });
});
