import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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

  it("does not trap the hover background on mouse focus", () => {
    const styles = readFileSync("src/app.scss", "utf8");
    const collectionBlock = styles.match(
      /&\.sidebar__collection-item\s*\{[\s\S]*?&\:\:?has\([^)]*\)[\s\S]*?\n      \}/,
    )?.[0];

    expect(collectionBlock).toBeTruthy();
    expect(collectionBlock).toContain("&:hover:not(.sidebar__menu-item--active)");
    expect(collectionBlock).toContain("&:has(:focus-visible):not(.sidebar__menu-item--active)");
    expect(collectionBlock).not.toContain("&:focus-within");
  });
});
