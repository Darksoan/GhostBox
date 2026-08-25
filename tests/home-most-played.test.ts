import { readFileSync } from "node:fs";
import { compile } from "sass-embedded";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { isMultiplayerGame } from "../src/utils/gameTraits";

describe("Home most played rail", () => {
  it("keeps the rail title localized", () => {
    const source = readFileSync("src/i18n.ts", "utf8");

    expect(source).toContain('mostPlayed: "Mais jogados"');
    expect(source).toContain('mostPlayed: "Most played"');
  });

  it("drives the Top rated shelf from a random slice of the trending ranking", () => {
    const hook = readFileSync("src/hooks/useHomeShelves.ts", "utf8");
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");

    // O rail é alimentado pelo trending (sort "playingNow"), e a lista fixa
    // vira apenas fallback enquanto o trending não respondeu — ou quando não
    // sobra nenhum jogo de um jogador no ranking.
    expect(hook).toContain("trendingSinglePlayer.length > 0");
    expect(hook).toContain("shuffledRotation(trendingSinglePlayer");
    expect(hook).toContain(": fixedTopRatedGames");
    expect(component).toContain('<HomeTopRatedShelf');

    // Só entram jogos sem componente multiplayer no rail.
    expect(hook).toContain("!isMultiplayerGame(game)");
    expect(hook).toContain("isMultiplayerGame");

    // A Home também consome o trending no explore pool — o rail não é uma
    // segunda query nova.
    expect(hook).toContain("useHomeTrendingQuery");
    expect(hook).toContain("trendingGames");
  });

  it("lays out the card with art, summary and a four-pill row — no badge", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeTopRatedCard");
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

    // O badge de popularidade foi removido; o título entra direto no corpo.
    expect(cardSource).not.toContain("home-top-rated-card__players");
    expect(cardSource).not.toContain("SortAsc");
    expect(cardSource).not.toContain("SortDesc");
    expect(component).not.toContain("reicon-react");
    expect(cardSource).toContain("home-top-rated-card__summary");

    // Contagem fixa de pills, decidida no topo do arquivo (constante do rail).
    expect(component).toContain("const homeTopRatedCardPillCount = 4;");
    expect(cardSource).toContain("homeTopRatedCardPillCount");

    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));

    expect(selectors).not.toContain(".home-top-rated-card__header");
    expect(selectors).not.toContain(".home-top-rated-card__players");
    expect(selectors).toContain(".home-top-rated-card__summary");
  });
});

describe("isMultiplayerGame", () => {
  const game = (tags: string[], genres: string[] = ["Action"]) => ({
    id: "steam-0",
    appId: "0",
    title: "Game",
    genres,
    tags,
  });

  it("flags any multiplayer-positive trait", () => {
    const cases: string[][] = [
      ["Multiplayer"],
      ["Online PvP"],
      ["Online Co-Op"],
      ["Co-op"],
      ["Local Multiplayer"],
      ["Local Co-Op"],
      ["Massively Multiplayer"],
      ["MMORPG"],
      ["PvP"],
      ["LAN Co-Op"],
      ["Shared/Split Screen"],
      ["Shared/Split Screen PvP"],
    ];

    for (const tags of cases) {
      expect(isMultiplayerGame(game(tags)), tags.join(", ")).toBe(true);
    }

    // Um título com Singleplayer e Multiplayer ainda é multiplayer.
    expect(
      isMultiplayerGame(game(["Singleplayer", "Multiplayer"]))
    ).toBe(true);
  });

  it("accepts obviously single-player titles", () => {
    expect(isMultiplayerGame(game(["Singleplayer", "Story Rich"]))).toBe(false);
    expect(isMultiplayerGame(game([], ["Adventure"]))).toBe(false);
    expect(isMultiplayerGame(game(["Horror", "Atmospheric"]))).toBe(false);
  });

  it("does not mistake ordinary words for multiplayer markers", () => {
    // "Coop" embutido em outra palavra não é multiplayer ("cooperation" tem o
    // mesmo risco); "Competitive" no Steam é um marcador de PvP online.
    expect(isMultiplayerGame(game(["Cooper", "Story Rich"]))).toBe(false);
    expect(isMultiplayerGame(game(["Cooperação", "Story Rich"]))).toBe(false);
    expect(isMultiplayerGame(game(["Competitive"]))).toBe(true);
  });
});