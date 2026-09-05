import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as data from "../src/data";
import { SettingsProvider, useSettings } from "../src/context/settings";
import {
  cataloguePreviewScreenshotSourceGroup,
  gameCatalogueHeaderSources,
} from "../src/utils/image";
import {
  cssImageUrl,
  imageSourceCache,
  isPredictableSteamAssetSource,
  withCachedImageSources,
} from "../src/utils/imageCache";

const game = {
  id: "steam-413150",
  appId: "413150",
  coverUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg",
  screenshots: [],
} as data.GhostBoxGame;

afterEach(() => {
  imageSourceCache.clear();
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

  it("uses the reliable standard catalogue cover first", () => {
    const sources = gameCatalogueHeaderSources(game);
    expect(sources[0]).toBe(game.coverUrl);
  });

  it("uses 600x338 with a 1280x720 fallback and never loads the 1920x1080 source", () => {
    const source =
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.1920x1080.jpg?t=1";

    expect(cataloguePreviewScreenshotSourceGroup(source)).toEqual([
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.600x338.jpg?t=1",
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.1280x720.jpg?t=1",
    ]);
  });

  it("keeps non-Steam screenshots unchanged", () => {
    const source = "https://example.com/preview.1920x1080.jpg?token=1";
    expect(cataloguePreviewScreenshotSourceGroup(source)).toEqual([source]);
  });

  it("uses only standard headers and the configured fallback hosts", () => {
    const sources = gameCatalogueHeaderSources(game);
    expect(sources.some((source) => source.endsWith("/header.jpg"))).toBe(true);
    expect(sources.some((source) => source.includes("header_2x"))).toBe(false);
    expect(sources).toEqual(expect.arrayContaining([
      "https://steamcdn-a.akamaihd.net/steam/apps/413150/header.jpg",
      "https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg",
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg",
      "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg",
    ]));
    expect(sources.some((source) => source.includes("capsule_616x353"))).toBe(false);
    expect(sources.some((source) => source.includes("library_hero"))).toBe(false);
  });

  it("keeps encoded Tauri cache paths valid in CSS backgrounds", () => {
    const source = "http://asset.localhost/C%3A/cache/header.jpg";
    expect(cssImageUrl(source)).toBe(`url("${source}")`);
    expect(cssImageUrl(source)).not.toContain("%253A");
  });

  it("recognizes the legacy Akamai fallback as a Steam asset", () => {
    expect(isPredictableSteamAssetSource(
      "https://steamcdn-a.akamaihd.net/steam/apps/413150/header.jpg",
    )).toBe(true);
  });

  it("preserves the reliable standard source while manifests resolve", () => {
    const sources = withCachedImageSources(gameCatalogueHeaderSources(game), {
      requestManifests: false,
      preserveSourceOrder: true,
    });
    expect(sources[0]).toBe(game.coverUrl);
  });

  it("uses the persisted standard header before network fallbacks", () => {
    imageSourceCache.set(game.coverUrl, "asset://localhost/cached-header.jpg");

    const sources = withCachedImageSources(gameCatalogueHeaderSources(game), {
      requestManifests: false,
      preserveSourceOrder: true,
      prioritizeCached: true,
    });

    expect(sources[0]).toBe("asset://localhost/cached-header.jpg");
  });

  it("keeps the first loaded catalogue cover stable", () => {
    const component = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(component).not.toContain("useLockedCoverSource");
    expect(component).not.toContain("progressive:");
    expect(component).toContain("useStableCatalogueCoverSource");
    expect(component).toContain("setStableSource((current) => current || source)");
    expect(component).toContain("catalogueCoverMaxRetries = 2");
    expect(component).toContain("retryToken,");
  });
});
