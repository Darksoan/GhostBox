import { describe, expect, it } from "vitest";
import {
  diffCloudProfileSnapshots,
  normalizeIncomingSnapshot,
  type NormalizedCloudProfileSnapshot,
} from "../src/cloudProfile";

function snapshot(overrides: Partial<NormalizedCloudProfileSnapshot> = {}): NormalizedCloudProfileSnapshot {
  return normalizeIncomingSnapshot({
    displayName: "Ada",
    avatarUrl: null,
    bannerUrl: null,
    bannerPosition: { x: 50, y: 50, scale: 100 },
    favoriteGameIds: ["10", "20"],
    collections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30"] }],
    ...overrides,
  });
}

describe("diffCloudProfileSnapshots", () => {
  it("persists a first empty snapshot", () => {
    const empty = snapshot({ displayName: null, favoriteGameIds: [], collections: [] });
    expect(diffCloudProfileSnapshots(null, empty)?.profileChanged).toBe(true);
  });

  it("returns null for an identical snapshot, ignoring timestamps", () => {
    expect(diffCloudProfileSnapshots(snapshot(), snapshot())).toBeNull();
  });

  it("detects a display-name-only change", () => {
    const diff = diffCloudProfileSnapshots(snapshot(), snapshot({ displayName: "Grace" }));
    expect(diff?.profileChanged).toBe(true);
    expect(diff?.favoritesAdded).toEqual([]);
    expect(diff?.collectionsAdded).toEqual([]);
    expect(diff?.gamesAdded).toEqual([]);
  });

  it("detects a single added favorite", () => {
    const diff = diffCloudProfileSnapshots(snapshot(), snapshot({ favoriteGameIds: ["10", "20", "30"] }));
    expect(diff?.favoritesAdded).toEqual(["30"]);
    expect(diff?.favoritesRemoved).toEqual([]);
    expect(diff?.favoritesOrderChanged).toBe(false);
  });

  it("detects a single removed favorite", () => {
    const diff = diffCloudProfileSnapshots(snapshot(), snapshot({ favoriteGameIds: ["10"] }));
    expect(diff?.favoritesRemoved).toEqual(["20"]);
  });

  it("detects reorder without additions", () => {
    const diff = diffCloudProfileSnapshots(snapshot(), snapshot({ favoriteGameIds: ["20", "10"] }));
    expect(diff?.favoritesOrderChanged).toBe(true);
    expect(diff?.favoritesAdded).toEqual([]);
  });

  it("detects collection add and remove", () => {
    const base = snapshot();
    const next = snapshot({ collections: [{ id: "col-2", name: "Rogue", gameIds: [] }] });
    const diff = diffCloudProfileSnapshots(base, next);
    expect(diff?.collectionsAdded).toEqual(["col-2"]);
    expect(diff?.collectionsRemoved).toEqual(["col-1"]);
  });

  it("detects a game added to a kept collection", () => {
    const diff = diffCloudProfileSnapshots(
      snapshot(),
      snapshot({ collections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30", "40"] }] })
    );
    expect(diff?.gamesAdded).toEqual([{ collectionId: "col-1", gameId: "40" }]);
    expect(diff?.gamesRemoved).toEqual([]);
  });

  it("treats an empty incoming snapshot as full removal", () => {
    const diff = diffCloudProfileSnapshots(
      snapshot(),
      snapshot({ displayName: null, favoriteGameIds: [], collections: [] })
    );
    expect(diff).not.toBeNull();
    expect(diff?.favoritesRemoved).toEqual(["10", "20"]);
    expect(diff?.collectionsRemoved).toEqual(["col-1"]);
  });
});
