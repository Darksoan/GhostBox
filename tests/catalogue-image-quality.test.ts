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

  it("uses the hashed header from an older cached result before its broken proxy URL", () => {
    const hashed = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3764200/ce5437442768e38eb575f205ab9397d0264017b0/header.jpg?t=1";
    const sources = gameCatalogueHeaderSources({
      ...game,
      appId: "3764200",
      coverUrl: "https://catalogue.example/images/steam/apps/3764200/header.jpg",
      coverFallbacks: ["https://catalogue.example/images/steam/apps/3764200/header.jpg", hashed],
    });
    expect(sources[0]).toBe(hashed);
  });

  it("uses 600x338 with a 1280x720 fallback and never loads the 1920x1080 source", () => {
    const source =
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.1920x1080.jpg?t=1";

    expect(cataloguePreviewScreenshotSourceGroup(source)).toEqual([
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.600x338.jpg?t=1",
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222140/ss_abc.1280x720.jpg?t=1",
    ]);
  });

  it("falls back to the original hashed screenshot when its thumbnail is unavailable", () => {
    const source = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3764200/08af4e9398b8e45152bfbedce3bc24d22e2c0990/ss_08af4e9398b8e45152bfbedce3bc24d22e2c0990.1920x1080.jpg?t=1";
    expect(cataloguePreviewScreenshotSourceGroup(source)).toEqual([
      source.replace(".1920x1080.", ".600x338."), source,
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

  it("renders the raw header in a native image without cover treatments", () => {
    const component = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");
    const page = readFileSync("src/pages/CataloguePage.tsx", "utf8");
    const stylesheet = readFileSync("src/app.scss", "utf8");
    const imageRuleStart = stylesheet.indexOf(".catalogue-card__cover-image {");
    const imageRule = stylesheet.slice(
      imageRuleStart,
      stylesheet.indexOf("}", imageRuleStart) + 1,
    );

    expect(component).toContain('className="catalogue-card__cover-image"');
    expect(component).toContain("src={source}");
    expect(component).toContain("width={460}");
    expect(component).toContain("height={215}");
    expect(component).not.toContain("useCachedImageSources");
    expect(component).not.toContain("useLoadableImageCover");
    expect(component).not.toContain("IntersectionObserver");
    expect(component).not.toContain("home-top-rated-card__");
    expect(component).toContain("withCachedImageSources(rawSources");
    expect(component).toContain("requestManifests: false");
    expect(component).toContain("preserveSourceOrder: true");
    expect(component).toContain("prioritizeCached: true");
    expect(component).toContain("resolveSteamHeaderSource(game.appId)");
    expect(component).toContain("cacheImageSourceAfterLoad(source)");
    expect(component).toContain('loading="lazy"');
    expect(component).toContain('decoding="async"');
    expect(page).not.toContain("preloadGameListAssets");
    expect(page).not.toContain('variant: "catalogueHeader"');
    expect(imageRule).toContain("width: 100%");
    expect(imageRule).toContain("height: auto");
    for (const treatment of [
      "background",
      "filter",
      "image-rendering",
      "object-fit",
      "opacity",
      "transform",
      "will-change",
    ]) {
      expect(imageRule).not.toContain(treatment);
    }
  });

  it("keeps the catalogue header raster at the maximized size in windowed mode", () => {
    const stylesheet = readFileSync("src/app.scss", "utf8");

    expect(stylesheet).toContain(
      "grid-template-columns: 232px minmax(0, 1fr)",
    );
    expect(stylesheet).not.toContain(
      "grid-template-columns: 224px minmax(0, 1fr)",
    );
  });

  it("stores the downloaded header bytes without resizing or recompressing", () => {
    const backend = readFileSync("src-tauri/src/image_cache.rs", "utf8");
    const start = backend.indexOf("async fn fetch_and_cache_image(");
    const implementation = backend.slice(
      start,
      backend.indexOf("async fn request_image_url_available(", start),
    );

    expect(implementation).toContain("let bytes = response.bytes().await.ok()?");
    expect(implementation).toContain("std::fs::write(&temp_path, bytes)");
    expect(implementation).not.toContain(".resize(");
    expect(implementation).not.toContain("encode(");
  });

  it("batches post-load catalogue cache writes without swapping the visible source", () => {
    const cache = readFileSync("src/utils/imageCache.ts", "utf8");
    const component = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(cache).toContain("const postLoadCacheSources = new Set<string>()");
    expect(cache).toContain("cancelPostLoadCacheFlush = runWhenIdle");
    expect(cache).toContain("const sources = [...postLoadCacheSources]");
    expect(cache).toContain("resolveCachedImageSource(candidate, { cachePredictable: true })");
    expect(component).not.toContain("setCachedSources");
  });

  it("does not keep the old catalogue cover pipeline", () => {
    const component = readFileSync("src/components/ui/CatalogueList.tsx", "utf8");

    expect(component).not.toContain("useStableCatalogueCoverSource");
    expect(component).not.toContain("useRobustCatalogueCoverSource");
    expect(component).not.toContain("catalogueCoverMaxRetries");
    expect(component).not.toContain("retryToken");
  });
});
