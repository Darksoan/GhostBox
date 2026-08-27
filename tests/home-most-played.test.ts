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

  it("drives the Top rated shelf from the fixed app id list", () => {
    const hook = readFileSync("src/hooks/useHomeShelves.ts", "utf8");
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");

    // O rail é a lista fixa de app ids, não o ranking ao vivo do trending: a
    // seleção é curada e não muda de semana para semana.
    expect(hook).toContain("const topRated = fixedTopRatedGames;");
    expect(hook).toContain("const fixedTopRatedAppIds = [");
    expect(hook).not.toContain("trendingSinglePlayer");
    expect(hook).not.toContain('salt: "top-rated"');
    expect(component).toContain('<HomeTopRatedShelf');

    // Os app ids fixos entram no ledger do picker para não reaparecerem nos
    // rails de cima.
    expect(hook).toContain("...(fixedTopRatedAppIds as readonly string[])");
  });

  it("lays out the card with header art, title and a fire rating on the right — no pills, no badge, no description", () => {
    const component = readFileSync("src/pages/HomePage.tsx", "utf8");
    const cardStart = component.indexOf("function HomeTopRatedCard");
    const cardEnd = component.indexOf("\nfunction ", cardStart);
    const cardSource = component.slice(cardStart, cardEnd);

    // Header.jpg como arte, nome do jogo e nota média (fire à direita) — sem
    // badge de popularidade, sem descrição curta e sem linha de pills.
    expect(cardSource).toContain("gameHeaderOnlySources(game)");
    expect(cardSource).toContain("home-top-rated-card__title");
    expect(cardSource).toContain("home-top-rated-card__rating");
    expect(cardSource).not.toContain("home-top-rated-card__players");
    expect(cardSource).not.toContain("home-top-rated-card__summary");
    expect(cardSource).not.toContain("home-top-rated-card__tags");
    expect(cardSource).not.toContain("home-top-rated-card__tag");
    expect(component).not.toContain("reicon-react");

    const stylesheet = postcss.parse(compile("src/app.scss").css);
    const selectors: string[] = [];
    stylesheet.walkRules((rule) => selectors.push(...(rule.selectors ?? [])));

    expect(selectors).not.toContain(".home-top-rated-card__header");
    expect(selectors).not.toContain(".home-top-rated-card__players");
    expect(selectors).not.toContain(".home-top-rated-card__summary");
    expect(selectors).not.toContain(".home-top-rated-card__tags");
    expect(selectors).not.toContain(".home-top-rated-card__tag");
    expect(selectors).toContain(".home-top-rated-card__rating");

    // Arte larga (header.jpg), aspecto 920×377 — não a hero capsule em
    // retrato usada em iterações anteriores deste rail.
    let artRuleText = "";
    stylesheet.walkRules(".home-top-rated-card__art", (rule) => {
      artRuleText += rule.toString();
    });
    expect(artRuleText).toContain("background-size: cover");
    // O Sass normaliza `920 / 377` para `920/377` na saída.
    expect(artRuleText).toContain("aspect-ratio: 920/377");
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