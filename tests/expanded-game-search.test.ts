import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDatabaseRequest, GhostBoxGame } from "../src/data";
import { useExpandedGameSearch } from "../src/hooks/useExpandedGameSearch";

const mocks = vi.hoisted(() => ({
  games: vi.fn(),
  steam: vi.fn(),
}));

vi.mock("../src/queries/games", () => ({
  useGamesQuery: mocks.games,
  useSteamStoreSearchQuery: mocks.steam,
}));

function game(appId: string, title: string, complete = false) {
  return {
    appId,
    id: `steam-${appId}`,
    title,
    screenshots: complete ? ["https://example.com/screenshot.jpg"] : [],
    tags: complete ? ["RPG"] : [],
  } as GhostBoxGame;
}

function queryResult(games: GhostBoxGame[], overrides = {}) {
  return {
    data: { games, total: games.length, matched: games.length, limited: false, source: "catalogue" },
    isFetched: true,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    ...overrides,
  };
}

function search(request: GameDatabaseRequest) {
  let result: ReturnType<typeof useExpandedGameSearch> | undefined;
  function Probe() {
    result = useExpandedGameSearch(request, true, 20, "en");
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return result!;
}

describe("expanded catalogue search", () => {
  beforeEach(() => {
    mocks.games.mockReset();
    mocks.steam.mockReset();
  });

  it("keeps the first catalogue result when the spaced query already works", () => {
    const full = game("374320", "DARK SOULS III", true);
    mocks.games.mockImplementation(() => queryResult([full]));
    mocks.steam.mockReturnValue({ data: [], isFetching: false });

    const result = search({ query: "dark souls" });
    expect(result.shouldSearchSteam).toBe(false);
    expect(result.expandedData).toBeUndefined();
    expect(mocks.steam.mock.calls[0][3]).toEqual({ enabled: false });
  });

  it("fetches the full catalogue record with the original filters, sort and page", () => {
    const full = game("374320", "DARK SOULS III", true);
    const steam = game("374320", "DARK SOULS™ III");
    mocks.games.mockImplementation((request: GameDatabaseRequest) =>
      queryResult(request.query === "dark souls" ? [full] : []),
    );
    mocks.steam.mockReturnValue({
      data: [steam],
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    const request: GameDatabaseRequest = {
      query: "darksouls",
      filters: { genres: ["RPG"] },
      sort: "recentlyAdded",
      offset: 60,
      limit: 60,
      seed: 123,
    };

    const result = search(request);
    expect(mocks.games.mock.calls[0][0]).toEqual(request);
    expect(mocks.games.mock.calls[1][0]).toEqual({
      ...request,
      query: "dark souls",
    });
    expect(mocks.games.mock.calls[1][1]).toEqual({ enabled: true });
    expect(result.expandedData?.games[0]).toBe(full);
    expect(result.expandedData?.games[0].screenshots).toHaveLength(1);
  });

  it("ignores a previous query's placeholder response", () => {
    mocks.games.mockImplementation((request: GameDatabaseRequest) =>
      queryResult(request.query === "darksouls" ? [game("1", "Old result")] : [], {
        isFetching: true,
        isPlaceholderData: true,
      }),
    );
    mocks.steam.mockReturnValue({ data: [game("2", "Dark Souls III")] });

    const result = search({ query: "darksouls" });
    expect(result.shouldSearchSteam).toBe(false);
    expect(result.expandedData).toBeUndefined();
  });

  it("leaves the first result available when Steam fails", () => {
    mocks.games.mockImplementation(() => queryResult([]));
    mocks.steam.mockReturnValue({
      data: undefined,
      isFetched: false,
      isFetching: false,
      isError: true,
    });

    const result = search({ query: "darksouls" });
    expect(result.expandedQuery).toBeNull();
    expect(result.isExpansionPending).toBe(false);
    expect(result.catalogueQuery.data?.games).toEqual([]);
  });
});
