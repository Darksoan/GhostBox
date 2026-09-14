import { describe, expect, it } from "vitest";
import { rehydrateUserCollectionGames } from "../src/lib/collectionGames";

const catalogOnlyGame = {
  id: "460790",
  appId: "460790",
  title: "Catalog Only Game",
} as never;

describe("option A: collections keep non-library games", () => {
  it("preserves stored games with no match in knownGames", () => {
    const collections = [
      { id: "c1", name: "Minha coleção", gameIds: ["460790"], games: [catalogOnlyGame] },
    ] as never;
    const result = rehydrateUserCollectionGames(collections, []) as Array<{ games: unknown[] }>;
    expect(result[0].games).toHaveLength(1);
  });

  it("prefers the enriched known game when available", () => {
    const enriched = { id: "460790", appId: "460790", title: "Real Title", coverUrl: "x" } as never;
    const collections = [
      { id: "c1", name: "Minha coleção", gameIds: ["460790"], games: [catalogOnlyGame] },
    ] as never;
    const result = rehydrateUserCollectionGames(collections, [enriched]) as Array<{ games: Array<{ title: string }> }>;
    expect(result[0].games[0].title).toBe("Real Title");
  });

  it("resolves steam- prefixed variants", () => {
    const known = { id: "steam-123", appId: "123", title: "Steam Game" } as never;
    const collections = [{ id: "c1", name: "C", gameIds: ["123"], games: [] }] as never;
    const result = rehydrateUserCollectionGames(collections, [known]) as Array<{ games: unknown[] }>;
    expect(result[0].games).toHaveLength(1);
  });
});
