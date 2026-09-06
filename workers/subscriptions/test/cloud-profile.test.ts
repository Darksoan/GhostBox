import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

const FUTURE = "2099-01-01T00:00:00.000Z";

function subscription() {
  return {
    steam_id: null,
    user_id: "user_1",
    plan_id: "monthly",
    status: "active",
    current_period_start: "2025-01-01T00:00:00.000Z",
    current_period_end: FUTURE,
    last_payment_id: null,
    stripe_customer_id: "cus_test_1",
    stripe_subscription_id: "sub_test_1",
    stripe_subscription_status: "active",
    cancel_at_period_end: 0,
    stripe_event_created: 1,
    stripe_payment_method_json: null,
    stripe_payment_method_updated_at: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    updatedAt: "2026-09-01T00:00:00.000Z",
    steamProfile: { displayName: "Ada", avatarUrl: null, bannerUrl: null, bannerPosition: { x: 50, y: 50, scale: 1 } },
    favoriteGameIds: ["10", "20"],
    userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30"] }],
    ...overrides,
  };
}

async function putProfile(db: ReturnType<typeof fakeD1>, payload: unknown) {
  const token = await sessionToken("user_1");
  const response = await worker.fetch(
    new Request("https://worker.test/cloud-profile", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    makeEnv(db),
    executionContext
  );
  return { response, body: await response.json<any>() };
}

function seed() {
  return {
    subscriptions: [subscription()],
    user_profile_cloud: [
      {
        steam_id: null,
        user_id: "user_1",
        display_name: "Ada",
        avatar_url: null,
        banner_url: null,
        banner_position_x: 50,
        banner_position_y: 50,
        banner_position_scale: 100,
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    user_collections_cloud: [
      { id: "col-1", steam_id: null, user_id: "user_1", name: "RPG", sort_order: 0, updated_at: "2026-08-01T00:00:00.000Z" },
    ],
    user_collection_games_cloud: [
      { steam_id: null, user_id: "user_1", collection_id: "col-1", game_id: "10", sort_order: 0 },
      { steam_id: null, user_id: "user_1", collection_id: "col-1", game_id: "30", sort_order: 1 },
    ],
    user_favorite_games_cloud: [
      { steam_id: null, user_id: "user_1", game_id: "10", sort_order: 0 },
      { steam_id: null, user_id: "user_1", game_id: "20", sort_order: 1 },
    ],
  };
}

let stripe: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe("PUT /cloud-profile delta", () => {
  it("writes nothing for an identical snapshot", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(db, body());

    expect(response.status).toBe(200);
    expect(db.batches).toHaveLength(2);
    expect(db.batches.flatMap((batch) => batch.results).every((result) => result.rowsWritten === 0)).toBe(true);
    expect(db.execLog.some((entry) => entry.sql.startsWith("INSERT INTO user_profile_cloud"))).toBe(false);
  });

  it("updates only the profile row when the name changes", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(
      db,
      body({ steamProfile: { displayName: "Grace" } })
    );

    expect(response.status).toBe(200);
    expect(db.batches).toHaveLength(3);
    expect(db.batches[1].sqls).toHaveLength(7);
    expect(db.rows("user_profile_cloud")[0].display_name).toBe("Grace");
    expect(db.rows("user_favorite_games_cloud")).toHaveLength(2);
    expect(db.rows("user_collections_cloud")).toHaveLength(1);
    const [, favDelete, favUpsert, gamesDelete, collectionsDelete, collectionsUpsert, gamesUpsert] =
      db.batches[1].results;
    expect(favDelete.changes).toBe(0);
    expect(favUpsert.changes).toBe(0);
    expect(gamesDelete.changes).toBe(0);
    expect(collectionsDelete.changes).toBe(0);
    expect(collectionsUpsert.changes).toBe(0);
    expect(gamesUpsert.changes).toBe(0);
  });

  it("inserts only the new favorite", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(db, body({ favoriteGameIds: ["10", "20", "30"] }));

    expect(response.status).toBe(200);
    const favorites = db.rows("user_favorite_games_cloud").sort((a, b) => a.sort_order - b.sort_order);
    expect(favorites.map((row) => row.game_id)).toEqual(["10", "20", "30"]);
    const favUpsert = db.batches[1].results[2];
    expect(favUpsert.changes).toBe(1);
    expect(db.batches[1].results[1].changes).toBe(0);
  });

  it("deletes only the removed favorite", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(db, body({ favoriteGameIds: ["10"] }));

    expect(response.status).toBe(200);
    expect(db.rows("user_favorite_games_cloud").map((row) => row.game_id)).toEqual(["10"]);
    expect(db.batches[1].results[1].changes).toBe(1);
  });

  it("touches only order when favorites are reordered", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(db, body({ favoriteGameIds: ["20", "10"] }));

    expect(response.status).toBe(200);
    const favorites = db.rows("user_favorite_games_cloud").sort((a, b) => a.sort_order - b.sort_order);
    expect(favorites.map((row) => row.game_id)).toEqual(["20", "10"]);
    expect(db.batches[1].results[2].changes).toBe(2);
  });

  it("adds and removes collections", async () => {
    const db = fakeD1(seed());
    const added = await putProfile(
      db,
      body({ userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30"] }, { id: "col-2", name: "Rogue", gameIds: [] }] })
    );
    expect(added.response.status).toBe(200);
    expect(db.rows("user_collections_cloud").map((row) => row.id).sort()).toEqual(["col-1", "col-2"]);

    const removed = await putProfile(db, body({ userCollections: [] }));
    expect(removed.response.status).toBe(200);
    expect(db.rows("user_collections_cloud")).toHaveLength(0);
    expect(db.rows("user_collection_games_cloud")).toHaveLength(0);
  });

  it("adds and removes a game inside a kept collection", async () => {
    const db = fakeD1(seed());
    const added = await putProfile(
      db,
      body({ userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30", "40"] }] })
    );
    expect(added.response.status).toBe(200);
    expect(db.rows("user_collection_games_cloud").map((row) => row.game_id).sort()).toEqual(["10", "30", "40"]);

    const removed = await putProfile(
      db,
      body({ userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10"] }] })
    );
    expect(removed.response.status).toBe(200);
    expect(db.rows("user_collection_games_cloud").map((row) => row.game_id)).toEqual(["10"]);
  });

  it("clears everything for an empty snapshot", async () => {
    const db = fakeD1(seed());
    const { response } = await putProfile(
      db,
      body({ steamProfile: null, favoriteGameIds: [], userCollections: [] })
    );

    expect(response.status).toBe(200);
    expect(db.rows("user_favorite_games_cloud")).toHaveLength(0);
    expect(db.rows("user_collections_cloud")).toHaveLength(0);
    expect(db.rows("user_collection_games_cloud")).toHaveLength(0);
  });

  it("repeating the same PUT stays idempotent", async () => {
    const db = fakeD1(seed());
    const changed = body({ favoriteGameIds: ["10", "20", "30"] });
    const first = await putProfile(db, changed);
    expect(first.response.status).toBe(200);
    expect(db.batches).toHaveLength(3);

    const second = await putProfile(db, changed);
    expect(second.response.status).toBe(200);
    expect(db.batches).toHaveLength(5);
  });

  it("rolls back the whole snapshot when the batch fails", async () => {
    const db = fakeD1(seed());
    db.failNext(/^INSERT INTO user_collection_games_cloud/, "boom in games upsert");
    const { response } = await putProfile(db, body({ favoriteGameIds: ["10", "20", "30"] }));

    expect(response.status).toBe(500);
    expect(db.rows("user_favorite_games_cloud").map((row) => row.game_id).sort()).toEqual(["10", "20"]);
    expect(db.rows("user_profile_cloud")[0].display_name).toBe("Ada");
  });
});
