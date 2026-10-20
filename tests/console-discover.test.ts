import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GhostBoxGame } from "../src/data";
import { ConsoleDiscover } from "../src/features/console/ConsoleViews";
import { ConsoleCard } from "../src/features/console/ConsoleParts";

const { game } = vi.hoisted(() => ({
  game: {
    id: "10", appId: "10", title: "Crimson Moon", genres: ["RPG"], tags: [],
    shortDescription: "Explore the world.", logo: "https://example.com/library_logo.png",
    coverUrl: "https://example.com/portrait.jpg", heroUrl: "https://example.com/hero.jpg",
  } as GhostBoxGame,
}));

vi.mock("../src/context/AppDataContext", () => ({
  useAppData: () => ({
    availableLibraryGameAppIds: new Set(), playableGameAppIds: new Set(), favoriteGameIds: new Set(),
    addedLibraryGames: [], favoriteGames: [], profileHistoryGames: [], toggleFavoriteGame: vi.fn(),
  }),
}));
vi.mock("../src/context/settings", () => ({
  useSettings: () => ({ appearance: { language: "pt" }, t: (key: string) => key }),
}));
vi.mock("../src/hooks/useHomeShelves", () => ({
  useHomeShelves: () => ({ shelves: {
    recommended: { games: [game] }, topSellers: { games: [] }, newReleases: { games: [] }, topRated: { games: [] },
  } }),
}));
vi.mock("../src/queries/games", () => ({
  useGameStoreDetailsQuery: () => ({ data: game }),
}));
vi.mock("../src/hooks/useCachedImageSources", () => ({
  useCachedImageSources: (sources: string[]) => sources,
  useLoadableImageCover: (sources: string[]) => ({ source: sources[0], loaded: true }),
}));

describe("console discovery banner", () => {
  it("shows only genre and title below game covers, without platform or score", () => {
    const markup = renderToStaticMarkup(createElement(ConsoleCard, {
      game: { ...game, size: "Steam", metacriticScore: 93 }, onOpen: vi.fn(),
    }));
    expect(markup).toContain('class="console-card__genre">RPG</span>');
    expect(markup).toContain('class="console-card__title">Crimson Moon</span>');
    expect(markup).not.toContain("console-card__facts");
    expect(markup).not.toContain("console-card__score");
    expect(markup).not.toContain(">Steam<");
  });

  it("uses the game name instead of an additional image while preserving the background and actions", () => {
    const markup = renderToStaticMarkup(createElement(ConsoleDiscover, { onOpen: vi.fn(), onSeeAll: vi.fn() }));
    const banner = markup.split('class="console-spotlight__stage"')[1].split('class="console-spotlight__list"')[0];
    expect(banner).toContain('<h1 class="console-logo console-logo--text console-spotlight__title">Crimson Moon</h1>');
    expect(banner).not.toContain("console-logo--image");
    expect(banner).not.toContain("portrait.jpg");
    expect(banner).toContain("console-spotlight__art");
    expect(banner).toContain("Explore the world.");
    expect(banner).toContain("console.viewGame");
    expect(banner).toContain("console.addToFavourites");
    expect(markup).toContain('class="console-spotlight__item is-active"');
    expect(markup).not.toContain("console-spotlight__progress");
  });
});
