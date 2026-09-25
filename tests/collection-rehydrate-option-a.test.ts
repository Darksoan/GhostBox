import { describe, expect, it } from "vitest";
import { rehydrateUserCollectionGames, resolveCloudCollectionGames } from "../src/lib/collectionGames";

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

  it("replaces a Steam fallback title with the resolved name", () => {
    const fallback = { id: "steam-367520", appId: "367520", title: "Steam App 367520" } as never;
    const resolved = { id: "steam-367520", appId: "367520", title: "Hollow Knight" } as never;
    const collections = [
      { id: "c1", name: "C", gameIds: ["steam-367520"], games: [fallback] },
    ] as never;
    const result = rehydrateUserCollectionGames(collections, [resolved]) as Array<{ games: Array<{ title: string }> }>;
    expect(result[0].games[0].title).toBe("Hollow Knight");
  });

  it("resolves steam- prefixed variants", () => {
    const known = { id: "steam-123", appId: "123", title: "Steam Game" } as never;
    const collections = [{ id: "c1", name: "C", gameIds: ["123"], games: [] }] as never;
    const result = rehydrateUserCollectionGames(collections, [known]) as Array<{ games: unknown[] }>;
    expect(result[0].games).toHaveLength(1);
  });
});

describe("loading cloud collections on sign-in", () => {
  it("keeps games in the sidebar when the catalogue cannot resolve them", async () => {
    const { gamesById, games } = await resolveCloudCollectionGames(
      ["steam-367520"],
      [],
      async () => null,
    );
    const collections = rehydrateUserCollectionGames(
      [{ id: "c1", name: "Jogos", gameIds: ["steam-367520"], games: [] }],
      games,
    );

    expect(gamesById.get("steam-367520")?.appId).toBe("367520");
    expect(collections[0].games?.map((game) => game.title)).toEqual(["Steam App 367520"]);
  });

  it("resolves appId and steam-prefixed IDs against installed games before fetching", async () => {
    const loaded = { id: "steam-123", appId: "123", title: "Installed game" } as never;
    let requests = 0;
    const result = await resolveCloudCollectionGames(["123"], [loaded], async () => {
      requests += 1;
      return null;
    });

    expect(requests).toBe(0);
    expect(result.gamesById.get("123")).toBe(loaded);
    expect(rehydrateUserCollectionGames(
      [{ id: "c1", name: "C", gameIds: ["123"], games: [] }], result.games,
    )[0].games).toEqual([loaded]);
  });

  it("keeps requested IDs when a detail response uses a different ID or rejects", async () => {
    const result = await resolveCloudCollectionGames(["123", "steam-456"], [], async (gameId) => {
      if (gameId === "steam-456") throw new Error("catalogue offline");
      return { id: "steam-123", appId: "123", title: "Real title" } as never;
    });

    expect(result.gamesById.get("123")?.title).toBe("Real title");
    expect(result.gamesById.get("steam-456")?.title).toBe("Steam App 456");
  });
});
