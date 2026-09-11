import { describe, expect, it } from "vitest";
import { createSeedGame } from "../src/utils/gameSeed";
import { searchCollectionGames } from "../src/utils/collectionSearch";

function game(id: string, title: string) {
  return createSeedGame({ appId: id, title }, Number(id) || 0, "");
}

describe("collection game search", () => {
  const collections = [
    { id: "favorites", name: "Favorites", games: [game("1", "Don't Starve Together")] },
    { id: "rpg", name: "RPG", games: [game("2", "Baldur's Gate 3")] },
    { id: "classic", name: "Classics", games: [game("3", "Pokémon Red")] },
  ];

  it("returns matching games instead of their collection groups", () => {
    expect(searchCollectionGames(collections, "BALDUR")).toEqual([collections[1].games[0]]);
  });

  it("ignores apostrophes, punctuation, accents, and spacing differences", () => {
    expect(searchCollectionGames(collections, "Dont")).toEqual([collections[0].games[0]]);
    expect(searchCollectionGames(collections, "baldursgate3")).toEqual([collections[1].games[0]]);
    expect(searchCollectionGames(collections, "pokemon")).toEqual([collections[2].games[0]]);
  });

  it("ranks stronger title matches first and removes duplicates between collections", () => {
    const exact = game("4", "Starve");
    const prefix = game("5", "Starve Together");
    const wordMatch = collections[0].games[0];
    const rankedCollections = [
      { games: [wordMatch, prefix] },
      { games: [exact, wordMatch] },
    ];

    expect(searchCollectionGames(rankedCollections, "starve")).toEqual([
      exact,
      prefix,
      wordMatch,
    ]);
  });

  it("returns no search results for an empty query or a miss", () => {
    expect(searchCollectionGames(collections, "  ")).toEqual([]);
    expect(searchCollectionGames(collections, "Celeste")).toEqual([]);
  });
});
