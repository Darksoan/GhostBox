import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GhostBoxGame, SteamAchievement } from "../src/data";
import { mergeAchievementDetailsIntoGame } from "../src/utils/steamAchievementMerge";

function makeAchievement(
  name: string,
  overrides: Partial<SteamAchievement> = {},
): SteamAchievement {
  return {
    name,
    title: name,
    description: `${name} desc`,
    icon: `${name}.png`,
    iconGray: `${name}-gray.png`,
    unlocked: false,
    ...overrides,
  } as SteamAchievement;
}

function makeGame(overrides: Partial<GhostBoxGame> = {}): GhostBoxGame {
  return {
    appId: "570",
    id: "steam-570",
    title: "Dota 2",
    subtitle: "Steam",
    status: "discover",
    hours: 0,
    rating: 0,
    size: "Steam",
    release: "Steam",
    progress: 0,
    accent: "#f0f1f7",
    cover: "header.jpg",
    hero: "hero.jpg",
    coverUrl: "header.jpg",
    heroUrl: "hero.jpg",
    coverFallbacks: ["header.jpg"],
    heroFallbacks: ["hero.jpg"],
    logo: "",
    tags: [],
    genres: [],
    screenshots: [],
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    pcRequirements: { minimum: [], recommended: [] },
    ...overrides,
  } as unknown as GhostBoxGame;
}

describe("aba de conquistas aberta pelo modal (prop churn)", () => {
  it("união com o prop novo não apaga a lista de schema já carregada", () => {
    // Estado local da página: schema completo vindo do fetch.
    const current = makeGame({
      achievementList: [
        makeAchievement("first-blood"),
        makeAchievement("rampage", { unlocked: true }),
      ],
    });
    // Prop recriado por tick de playtime/refresh da conta: mesma identidade
    // de jogo, mas a cópia das listas ainda não tem a lista de schema.
    const freshProp = makeGame({
      playTimeInMilliseconds: 3_600_000,
      achievements: { unlocked: 0, total: 0, progress: 0 },
      achievementList: [],
    });

    const merged = mergeAchievementDetailsIntoGame(freshProp, current);

    expect(merged.achievementList.map((a) => a.name).sort()).toEqual([
      "first-blood",
      "rampage",
    ]);
    expect(merged.playTimeInMilliseconds).toBe(3_600_000);
  });

  it("união propaga flags pessoais novas sem perder entradas do schema", () => {
    const current = makeGame({
      achievementList: [
        makeAchievement("first-blood"),
        makeAchievement("rampage"),
      ],
    });
    const freshProp = makeGame({
      achievementList: [makeAchievement("first-blood", { unlocked: true })],
    });

    const merged = mergeAchievementDetailsIntoGame(freshProp, current);

    expect(merged.achievementList).toHaveLength(2);
    expect(
      merged.achievementList.find((a) => a.name === "first-blood")?.unlocked,
    ).toBe(true);
  });

  it("página sincroniza sem substituir: guarda sameGame e une em vez de trocar", () => {
    const source = readFileSync(
      "src/pages/GameAchievementsPage.tsx",
      "utf8",
    );
    // Troca de jogo continua substituindo; churn de identidade do mesmo jogo une.
    expect(source).toMatch(/current\.id === game\.id/);
    expect(source).toContain(
      "mergeAchievementDetailsIntoGame(game, current)",
    );
    expect(source).not.toMatch(
      /useEffect\(\(\) => \{\s*setDetailGame\(game\);\s*highlightScrolledRef\.current = false;\s*\}, \[game\]\);/,
    );
  });

  it("página busca detalhes pelo mesmo identificador do modal (appId primeiro)", () => {
    const source = readFileSync(
      "src/pages/GameAchievementsPage.tsx",
      "utf8",
    );
    expect(source).toContain("const detailsGameId = game.appId || game.id;");
    expect(source).toContain(
      "loadGameAchievementDetailsCached(detailsGameId)",
    );
    expect(source).not.toContain("loadGameAchievementDetailsCached(game.id)");
  });

  it("loading não apaga a lista já conhecida: skeleton só sem conquistas", () => {
    const source = readFileSync(
      "src/pages/GameAchievementsPage.tsx",
      "utf8",
    );
    expect(source).toContain("isLoading && achievements.length === 0");
  });
});
