import { describe, expect, it } from "vitest";
import { cacheControl, canonicalSearchKey, cloudflareCacheControl, searchTtl } from "../src/cache";
import { GAME_COLUMNS, searchConditions, toGame } from "../src/catalogue";
import { RANKING_ORDER } from "../src/ranking";
import { normalizeSearchText, parseSearch } from "../src/index";

describe("catalogue request canonicalization", () => {
  it("ignores query and repeated-filter order", () => {
    const first = parseSearch(new URL("https://example.com/catalogue/search?tags=RPG&genres=Indie&tags=Action&limit=200"));
    const second = parseSearch(new URL("https://example.com/catalogue/search?limit=200&tags=Action&tags=RPG&genres=Indie"));
    expect(canonicalSearchKey(first, "2026-01-01")).toBe(canonicalSearchKey(second, "2026-01-01"));
  });

  it("caps limit and normalizes route defaults", () => {
    const request = parseSearch(new URL("https://example.com/catalogue/search?limit=999&offset=-3&sort=other&q=%20Portal%20"));
    expect(request).toMatchObject({ limit: 200, offset: 0, sort: "popular", q: "portal" });
  });

  it("normalizes accents and punctuation like the indexed search text", () => {
    expect(normalizeSearchText("  Ação: Épica!  ")).toBe("acao epica");
  });
});

describe("cache TTL", () => {
  it.each([
    ["?facetsOnly=1", 86400],
    ["?sort=recentlyAdded", 300],
    ["?q=portal", 600],
    ["?tags=RPG", 600],
    ["?sort=popular", 3600],
  ])("uses the expected TTL for %s", (query, ttl) => {
    expect(searchTtl(parseSearch(new URL(`https://example.com/catalogue/search${query}`)))).toBe(ttl);
  });

  it("separates browser and Cloudflare cache directives", () => {
    expect(cacheControl(86400)).toBe("public, max-age=300");
    expect(cloudflareCacheControl(86400)).toBe("public, max-age=86400, stale-while-revalidate=86400");
    expect(cacheControl(300)).not.toContain("s-maxage");
  });
});

describe("production schema", () => {
  it("maps a D1 row to the application game shape", () => {
    const game = toGame({
      app_id: "413150",
      name: "Stardew Valley",
      release_date: "Feb 26, 2016",
      release_year: "2016",
      header_image: "https://store/header.jpg",
      developers_json: '["ConcernedApe"]',
      publishers_json: '["ConcernedApe"]',
      categories_json: '["Single-player","Co-op"]',
      genres_json: '["Indie","RPG","Simulation","Extra 1","Extra 2","Extra 3","Ignored"]',
      screenshots_json: JSON.stringify(Array.from({ length: 10 }, (_, index) => `https://store/${index}.jpg`)),
      tags_json: "[]",
      updated_at: 1778860368375,
      popularity_score: 163.4545,
      popularity_rank: 1,
      steam_review_count: 886195,
      steam_positive_ratio: 0.9844,
      metacritic_score: 89,
      recommendations: 821472,
      ranking_score: 0.974,
      ranking_tier: 48,
    }, "https://catalogue.example");

    expect(game).toMatchObject({
      appId: "413150",
      id: "steam-413150",
      title: "Stardew Valley",
      subtitle: "Indie / RPG - ConcernedApe",
      status: "discover",
      release: "Feb 26, 2016",
      tags: ["Single-player", "Co-op"],
      achievements: { unlocked: 0, total: 0, progress: 0 },
      popularityScore: 163.4545,
      databaseAddedAt: 1778860368375,
    });
    expect(game.genres).toHaveLength(6);
    expect(game.screenshots).toHaveLength(8);
    expect(game.coverUrl).toBe("https://catalogue.example/images/steam/apps/413150/header.jpg");
  });

  it("builds token search and filters from real columns", () => {
    const request = parseSearch(new URL("https://example.com/catalogue/search?q=Portal%202&tags=Puzzle&years=2011"));
    const query = searchConditions(request);
    expect(query.sql).toContain("search_text LIKE ?");
    expect(query.sql).toContain("json_array_length(tags_json)");
    expect(query.sql).toContain("categories_json");
    expect(query.sql).toContain("f.key < 12");
    expect(query.sql).toContain("release_year IN (?)");
    expect(query.bindings).toEqual(["%portal%", "%2%", "Puzzle", "2011"]);
  });

  it("requires every selected value from the same filter category by default", () => {
    const request = parseSearch(new URL(
      "https://example.com/catalogue/search?tags=Puzzle&tags=Horror&genres=Action&genres=Adventure"
    ));
    expect(request.match).toBe("all");
    const query = searchConditions(request);
    expect(query.sql).toContain(") AND EXISTS");
    expect(query.sql).not.toContain(" OR EXISTS");
    expect(query.bindings).toEqual(["Action", "Adventure", "Puzzle", "Horror"]);
  });

  it("matches any selected value within a category when match=any", () => {
    const request = parseSearch(new URL(
      "https://example.com/catalogue/search?genres=Action&genres=Adventure&match=any"
    ));
    expect(request.match).toBe("any");
    const query = searchConditions(request);
    expect(query.sql).toContain(") OR EXISTS");
    expect(query.sql).not.toContain(") AND EXISTS");
  });

  it("selects only real schema columns and orders by the ranking tier", () => {
    expect(GAME_COLUMNS).not.toContain("game_json");
    expect(GAME_COLUMNS).toContain("ranking_score");
    expect(GAME_COLUMNS).toContain("ranking_tier");
    expect(RANKING_ORDER).toContain("ranking_tier DESC");
    expect(RANKING_ORDER).toContain("CAST(app_id AS INTEGER) ASC");
  });
});

describe("routes", () => {
  it("does not interpret nested or nonnumeric game paths as a game route", () => {
    expect(/^\/games\/(\d+)$/.test("/games/413150/details")).toBe(false);
    expect(/^\/games\/(\d+)$/.test("/games/steam-413150")).toBe(false);
    expect(/^\/games\/(\d+)$/.test("/games/413150")).toBe(true);
  });
});
