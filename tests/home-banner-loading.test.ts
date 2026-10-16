import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { gameHeroSources } from "../src/utils/image";
import { withCachedImageSources } from "../src/utils/imageCache";

describe("Home banner loading", () => {
  it("tries all high-density heroes before standard-quality fallbacks", () => {
    const sources = withCachedImageSources(gameHeroSources({
      id: "steam-413150", appId: "413150", screenshots: [],
    } as unknown as GhostBoxGame), { requestManifests: false });
    const firstStandard = sources.findIndex((source) => source.endsWith("/library_hero.jpg"));
    expect(firstStandard).toBeGreaterThan(0);
    expect(sources.slice(0, firstStandard).every((source) => source.endsWith("/library_hero_2x.jpg"))).toBe(true);
  });

  it("waits for the manifest and decoding, then retains the revealed art", () => {
    const page = readFileSync("src/pages/HomePage.tsx", "utf8");
    const banner = page.slice(page.indexOf("function HomeBannerArt("), page.indexOf("function HomeRecommendedHero("));
    expect(banner).toContain("waitForManifest: true");
    expect(banner).toContain("preferOrder: true");
    expect(banner).toContain("decodeBeforeCommit: true");
    expect(banner).toContain("loaded && source && !displayedSource.current");
    expect(banner).toContain("src={displayedSource.current}");
  });

  it("keeps the active loading slide dark even when a neighbor is ready", () => {
    const css = readFileSync("src/app.scss", "utf8");
    expect(css).toContain(".home-banner__frame:has(.home-banner__art--active:not(.home-banner__art--loaded))");
    expect(css).not.toContain(".home-banner__frame:has(.home-banner__art):not(:has(.home-banner__art--loaded))");
  });

  it("keeps zoom on the compositor with an oversized image that only scales down", () => {
    const css = readFileSync("src/app.scss", "utf8");
    const art = css.slice(css.indexOf(".home-banner__art {"), css.indexOf(".home-banner__scrim {"));
    expect(art).toContain("width: 200%");
    expect(art).toContain("height: 200%");
    expect(art).toContain("transform: scale(0.53)");
    expect(art).toContain("transform: scale(0.5)");
    expect(art).toContain("will-change: transform");
    expect(art).toContain("transition: transform 0.9s var(--ease-out)");
    expect(art).not.toMatch(/transition:\s*(width|height|left|top)/);
    expect(art).not.toContain("background-size");
    const page = readFileSync("src/pages/HomePage.tsx", "utf8");
    expect(page).toContain('className="home-banner__image"');
  });
});
