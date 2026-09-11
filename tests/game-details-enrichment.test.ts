import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GhostBoxGame } from "../src/data";
import { mergeGameDetailsPreservingAchievements } from "../src/lib/profileHistoryGames";
import { mergeGameCardData } from "../src/utils/gameCardData";
import { hasUsefulStoreDetails } from "../src/utils/gameCache";

function makeGame(overrides: Partial<GhostBoxGame> = {}): GhostBoxGame {
  return {
    appId: "2943650",
    id: "steam-2943650",
    title: "FragPunk",
    subtitle: "Steam",
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: "Steam",
    progress: 0,
    accent: "#f0f1f7",
    cover: "header.jpg",
    hero: "hero.jpg",
    coverUrl: "header.jpg",
    heroUrl: "hero.jpg",
    coverFallbacks: ["header.jpg"],
    heroFallbacks: ["hero.jpg"],
    logo: "logo.png",
    tags: ["FPS"],
    genres: ["Action"],
    developers: ["Bad Guitar"],
    publishers: ["NetEase"],
    screenshots: ["ss1.jpg", "ss2.jpg"],
    movies: [
      {
        id: 1,
        name: "Trailer",
        thumbnail: "thumb.jpg",
        highlight: true,
        mp4: { max: "movie.mp4", "480": "movie480.mp4" },
      },
    ],
    shortDescription: "Short desc",
    aboutTheGame: "<p>About FragPunk</p>",
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    pcRequirements: { minimum: ["OS: Windows"], recommended: [] },
    controllerSupport: "full",
    supportedLanguages: "Inglês<strong>*</strong>, Português (Brasil)",
    ...overrides,
  } as unknown as GhostBoxGame;
}

describe("enriquecimento sem conquistas", () => {
  it("preserva galeria/sobre/idiomas quando store chega vazio (sem conquistas)", () => {
    const base = makeGame();
    const emptyStore = makeGame({
      title: "FragPunk",
      screenshots: [],
      movies: [],
      aboutTheGame: "",
      shortDescription: "",
      pcRequirements: { minimum: [], recommended: [] },
      controllerSupport: undefined,
      supportedLanguages: "",
      genres: [],
      developers: [],
      publishers: [],
      achievements: { unlocked: 0, total: 0, progress: 0 },
      achievementList: [],
    });

    const merged = mergeGameDetailsPreservingAchievements(base, emptyStore);

    expect(merged.screenshots).toEqual(["ss1.jpg", "ss2.jpg"]);
    expect(merged.movies).toHaveLength(1);
    expect(merged.aboutTheGame).toContain("FragPunk");
    expect(merged.supportedLanguages).toContain("Inglês");
    expect(merged.controllerSupport).toBe("full");
    expect(merged.genres).toEqual(["Action"]);
    expect(merged.pcRequirements?.minimum).toEqual(["OS: Windows"]);
    expect(merged.achievements.total).toBe(0);
  });

  it("merge de cards não apaga about/movies/idiomas com payload vazio", () => {
    const base = makeGame();
    const empty = makeGame({
      screenshots: [],
      movies: [],
      aboutTheGame: "",
      shortDescription: "",
      supportedLanguages: "",
      controllerSupport: undefined,
      genres: [],
    });

    const merged = mergeGameCardData(base, empty);

    expect(merged.screenshots).toEqual(["ss1.jpg", "ss2.jpg"]);
    expect(merged.movies).toHaveLength(1);
    expect(merged.aboutTheGame).toContain("FragPunk");
    expect(merged.supportedLanguages).toContain("Inglês");
    expect(merged.controllerSupport).toBe("full");
  });

  it("detecta payload útil de loja para não fixar vazio no cache", () => {
    expect(hasUsefulStoreDetails(null)).toBe(false);
    expect(
      hasUsefulStoreDetails(
        makeGame({
          screenshots: [],
          movies: [],
          aboutTheGame: "",
          shortDescription: "",
          supportedLanguages: "",
          controllerSupport: undefined,
          genres: [],
          developers: [],
          publishers: [],
          pcRequirements: { minimum: [], recommended: [] },
        }),
      ),
    ).toBe(false);
    expect(hasUsefulStoreDetails(makeGame())).toBe(true);
    expect(
      hasUsefulStoreDetails(
        makeGame({
          screenshots: [],
          movies: [],
          aboutTheGame: "",
          shortDescription: "só short",
          supportedLanguages: "",
          controllerSupport: undefined,
          genres: [],
          developers: [],
          publishers: [],
          pcRequirements: { minimum: [], recommended: [] },
        }),
      ),
    ).toBe(true);
  });

  it("GameModal tem fallback de galeria e sobre independente de conquistas", () => {
    const modal = readFileSync("src/components/modals/GameModal.tsx", "utf8");
    // Galeria usa fallback (cover/hero) quando screenshots está vazio.
    expect(modal).toContain("galleryScreenshots");
    expect(modal).toContain("displayGame.coverUrl");
    // Sobre cai para shortDescription quando aboutTheGame está vazio.
    expect(modal).toContain("aboutSourceText");
    expect(modal).toContain("displayGame?.shortDescription");
    // Store e conquistas continuam em loads paralelos/independentes.
    expect(modal).toContain("loadGameStoreDetailsCached(detailsGameId)");
    expect(modal).toContain("loadGameAchievementDetailsCached(detailsGameId)");
  });
});
