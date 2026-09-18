import { afterEach, describe, expect, it, vi } from "vitest";
import { sidebarExpandedCollectionsStorageKey } from "../src/constants/catalogue";
import {
  readSidebarExpandedCollections,
  writeSidebarExpandedCollections,
} from "../src/utils/storage";

function memoryStorage(values = new Map<string, string>()) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("sidebar expanded collections", () => {
  it("opens favorites by default when nothing was saved", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    expect(readSidebarExpandedCollections()).toEqual(new Set(["__favorites__"]));
  });

  it("persists a closed favorites section across restarts", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: memoryStorage(values) });
    writeSidebarExpandedCollections(new Set());
    expect(values.get(sidebarExpandedCollectionsStorageKey)).toBe("[]");
    // Simula o reload: nova leitura com o mesmo storage.
    expect(readSidebarExpandedCollections()).toEqual(new Set());
  });

  it("persists expanded collections across restarts", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: memoryStorage(values) });
    writeSidebarExpandedCollections(new Set(["__favorites__", "abc"]));
    expect(readSidebarExpandedCollections()).toEqual(new Set(["__favorites__", "abc"]));
  });
});
