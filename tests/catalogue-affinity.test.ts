import { describe, expect, it } from "vitest";
import {
  buildAffinityProfile,
  scoreAffinity,
  topAffinityTraits,
  type AffinityGameLike,
} from "../src/utils/affinity";

function game(overrides: Partial<AffinityGameLike> = {}): AffinityGameLike {
  return { genres: [], tags: [], developers: [], ...overrides };
}

describe("buildAffinityProfile", () => {
  it("is empty when every source is empty", () => {
    const profile = buildAffinityProfile({});
    expect(profile.isEmpty).toBe(true);
    expect(profile.genres.size).toBe(0);
  });

  it("weighs a highly-played library game above a briefly-played one", () => {
    const profile = buildAffinityProfile({
      libraryGames: [
        game({ genres: ["RPG"], playTimeInMilliseconds: 50 * 3_600_000 }),
        game({ genres: ["Puzzle"], playTimeInMilliseconds: 10 * 60 * 1000 }),
      ],
    });
    expect(profile.genres.get("rpg")).toBeGreaterThan(profile.genres.get("puzzle")!);
  });

  it("caps the playtime bonus so a single mega-played game does not dwarf everything else", () => {
    const profile = buildAffinityProfile({
      libraryGames: [
        game({ genres: ["Mega"], playTimeInMilliseconds: 5000 * 3_600_000 }),
        game({ genres: ["Small"], playTimeInMilliseconds: 5 * 3_600_000 }),
      ],
    });
    // Uncapped, 5000h vs 5h would put Mega's weight ~1000x Small's. Capped at
    // 20h, the gap is a modest 2x: (2 + 20*0.2) / (2 + 5*0.2) = 6 / 3.
    const ratio = profile.genres.get("mega")! / profile.genres.get("small")!;
    expect(ratio).toBeCloseTo(2, 5);
  });

  it("treats favorites and library as comparably strong signals", () => {
    // Both traits share one profile so normalization can't trivially collapse
    // a single entry to 1 regardless of its underlying weight.
    const profile = buildAffinityProfile({
      libraryGames: [game({ genres: ["FromLibrary"] })],
      favoriteGames: [game({ genres: ["FromFavorite"] })],
    });
    expect(profile.genres.get("fromlibrary")).toBe(profile.genres.get("fromfavorite"));
  });

  it("weighs collections below favorites and library", () => {
    const profile = buildAffinityProfile({
      favoriteGames: [game({ genres: ["RPG"] })],
      collectionGames: [game({ genres: ["Puzzle"] })],
    });
    expect(profile.genres.get("puzzle")).toBeLessThan(profile.genres.get("rpg")!);
  });

  it("normalizes trait casing and whitespace", () => {
    const profile = buildAffinityProfile({ favoriteGames: [game({ genres: ["  RPG  ", "rpg"] })] });
    expect(profile.genres.size).toBe(1);
    expect(profile.genres.get("rpg")).toBeGreaterThan(0);
  });

  it("normalizes the top trait to exactly 1", () => {
    const profile = buildAffinityProfile({
      favoriteGames: [game({ genres: ["RPG"] }), game({ genres: ["RPG", "Indie"] })],
    });
    expect(profile.genres.get("rpg")).toBe(1);
    expect(profile.genres.get("indie")).toBeLessThan(1);
  });
});

describe("scoreAffinity", () => {
  it("scores a game with no overlap at zero", () => {
    const profile = buildAffinityProfile({ favoriteGames: [game({ genres: ["RPG"] })] });
    expect(scoreAffinity(profile, game({ genres: ["Racing"] }))).toBe(0);
  });

  it("weighs a genre match above a tag match of equal profile strength", () => {
    const profile = buildAffinityProfile({
      favoriteGames: [game({ genres: ["RPG"] }), game({ tags: ["Roguelike"] })],
    });
    expect(scoreAffinity(profile, game({ genres: ["RPG"] }))).toBeGreaterThan(
      scoreAffinity(profile, game({ tags: ["Roguelike"] }))
    );
  });

  it("accumulates across multiple matching traits", () => {
    const profile = buildAffinityProfile({
      favoriteGames: [game({ genres: ["RPG"], tags: ["Roguelike"], developers: ["Dev A"] })],
    });
    const partial = scoreAffinity(profile, game({ genres: ["RPG"] }));
    const full = scoreAffinity(profile, game({ genres: ["RPG"], tags: ["Roguelike"], developers: ["Dev A"] }));
    expect(full).toBeGreaterThan(partial);
  });
});

describe("topAffinityTraits", () => {
  it("returns the highest-weighted traits first, capped at the limit", () => {
    const profile = buildAffinityProfile({
      favoriteGames: [
        game({ genres: ["RPG"] }),
        game({ genres: ["RPG"] }),
        game({ genres: ["Indie"] }),
        game({ genres: ["Racing"] }),
      ],
    });
    expect(topAffinityTraits(profile.genres, 2)).toEqual(["rpg", "indie"]);
  });

  it("returns an empty list for an empty profile", () => {
    const profile = buildAffinityProfile({});
    expect(topAffinityTraits(profile.genres, 4)).toEqual([]);
  });
});
