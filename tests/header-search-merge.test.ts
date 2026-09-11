import { describe, expect, it } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  mergeHeaderSearchSuggestions,
  normalizeHeaderSearchText,
} from "../src/hooks/useAppShellState";

function makeGame(overrides: Partial<GhostBoxGame> = {}): GhostBoxGame {
  return {
    appId: overrides.appId ?? "2943650",
    id: overrides.id ?? `steam-${overrides.appId ?? "2943650"}`,
    title: overrides.title ?? "FragPunk",
    achievements: { unlocked: 0, total: 0, progress: 0 },
    achievementList: [],
    ...overrides,
  } as unknown as GhostBoxGame;
}

describe("header search local + remote", () => {
  it("normaliza caixa e acentos", () => {
    expect(normalizeHeaderSearchText("  FRAGPunk ")).toBe("fragpunk");
    expect(normalizeHeaderSearchText("Ação")).toBe("acao");
  });

  it("acha jogo local mesmo com remoto vazio (caso FragPunk)", () => {
    const local = [makeGame({ title: "FragPunk" })];
    const merged = mergeHeaderSearchSuggestions(local, [], "fragpunk");
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("FragPunk");
  });

  it("é case-insensitive", () => {
    const local = [makeGame({ title: "FragPunk" })];
    expect(
      mergeHeaderSearchSuggestions(local, [], "FRAGPUNK"),
    ).toHaveLength(1);
    expect(
      mergeHeaderSearchSuggestions(local, [], "frag"),
    ).toHaveLength(1);
  });

  it("dedupe local + remoto por appId, local primeiro", () => {
    const local = [makeGame({ appId: "10", title: "Local" })];
    const remote = [
      makeGame({ appId: "10", title: "Remoto" }),
      makeGame({ appId: "20", title: "Outro" }),
    ];
    const merged = mergeHeaderSearchSuggestions(local, remote, "o");
    expect(merged.map((g) => g.appId)).toEqual(["10", "20"]);
    expect(merged[0].title).toBe("Local");
  });

  it("acha por appId numérico", () => {
    const local = [makeGame({ appId: "2943650", title: "FragPunk" })];
    expect(
      mergeHeaderSearchSuggestions(local, [], "2943650"),
    ).toHaveLength(1);
  });

  it("retorna vazio sem query", () => {
    expect(mergeHeaderSearchSuggestions([makeGame()], [], "")).toEqual([]);
  });
});
