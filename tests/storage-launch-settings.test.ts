import { afterEach, describe, expect, it, vi } from "vitest";
import type { GhostBoxGame } from "../src/data";
import {
  readStoredFavoriteGames,
  readStoredProfileHistoryGames,
  writeStoredFavoriteGames,
  writeStoredProfileHistoryGames,
} from "../src/utils/storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function game(): GhostBoxGame {
  return { appId: "620", id: "steam-620", title: "Portal 2", subtitle: "", status: "discover", hours: 0, rating: 0 };
}

afterEach(() => vi.unstubAllGlobals());

describe("stored games", () => {
  it("preserves favorites", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeStoredFavoriteGames([game()]);
    expect(readStoredFavoriteGames()[0]?.id).toBe("steam-620");
  });

  it("preserves profile history", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeStoredProfileHistoryGames([game()]);
    expect(readStoredProfileHistoryGames()[0]?.id).toBe("steam-620");
  });
});
