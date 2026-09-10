import { describe, expect, it } from "vitest";
import { createSeedGame } from "../src/utils/gameSeed";
import { filterCollectionsByGameTitle } from "../src/utils/collectionSearch";

function game(id: string, title: string) {
  return createSeedGame({ appId: id, title }, Number(id) || 0, "");
}

describe("collection game search", () => {
  const collections = [
    { id: "favorites", name: "Favorites", games: [game("1", "Hades")] },
    { id: "rpg", name: "RPG", games: [game("2", "Baldur's Gate 3")] },
  ];

  it("filters collections by game title without changing their order", () => {
    expect(filterCollectionsByGameTitle(collections, "BALDUR")).toEqual([collections[1]]);
  });

  it("returns every collection for an empty query and none for a miss", () => {
    expect(filterCollectionsByGameTitle(collections, "  ")).toBe(collections);
    expect(filterCollectionsByGameTitle(collections, "Celeste")).toEqual([]);
  });
});
