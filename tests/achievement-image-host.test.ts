import { describe, expect, it } from "vitest";
import {
  achievementIconFallbackSources,
  normalizeAchievementImageSource,
} from "../src/utils/steamAchievementMerge";

describe("achievement image host normalization (Aniimo 4126040)", () => {
  it("rewrites the legacy steamcommunity host to community_assets", () => {
    expect(
      normalizeAchievementImageSource(
        "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
      )
    ).toBe(
      "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
    );
  });

  it("keeps non-Steam URLs untouched", () => {
    expect(normalizeAchievementImageSource("a.png")).toBe("a.png");
    expect(normalizeAchievementImageSource("")).toBe("");
  });

  it("tries the normalized URL before the legacy one", () => {
    const legacy =
      "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg";
    const sources = achievementIconFallbackSources(
      { icon: legacy, iconGray: "" },
      true
    );
    expect(sources[0]).toBe(
      "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
    );
    expect(sources).toContain(legacy);
  });

  it("modal hero prefers the hashed manifest art over screenshots", () => {
    // Regression guard: GameModal must consult the asset manifest for
    // library_hero before falling back to the first screenshot. Migrated games
    // (Aniimo) 404 on the unhashed hero path, so screenshots would win without it.
    const source = require("node:fs").readFileSync(
      "src/components/modals/GameModal.tsx",
      "utf8"
    ) as string;
    expect(source).toContain('getSteamAssetUrl(appId, "library_hero_2x.jpg")');
    expect(source).toContain('getSteamAssetUrl(appId, "library_hero.jpg")');
    expect(source).toContain("manifestHeroSources");
  });
});
