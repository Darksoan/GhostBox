import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/index";
import { executionContext, sessionToken } from "./helpers/worker";

let runtime: Miniflare;
let db: D1Database;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-19",
    d1Databases: ["DB"],
  });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  const schema = [
    `CREATE TABLE accounts (user_id TEXT PRIMARY KEY, token_version INTEGER)`,
    `CREATE TABLE user_connections (user_id TEXT, provider TEXT, provider_id TEXT)`,
    `CREATE TABLE subscriptions (
      steam_id TEXT PRIMARY KEY, user_id TEXT, plan_id TEXT, status TEXT,
      current_period_start TEXT, current_period_end TEXT, last_payment_id TEXT,
      stripe_customer_id TEXT, stripe_subscription_id TEXT, stripe_subscription_status TEXT,
      cancel_at_period_end INTEGER, stripe_event_created INTEGER,
      stripe_payment_method_json TEXT, stripe_payment_method_updated_at TEXT,
      access_type TEXT NOT NULL DEFAULT 'stripe',
      created_at TEXT, updated_at TEXT
    )`,
    `CREATE UNIQUE INDEX idx_subscriptions_user_id ON subscriptions(user_id)`,
    `CREATE TABLE user_profile_cloud (
      steam_id TEXT PRIMARY KEY, user_id TEXT, display_name TEXT, avatar_url TEXT,
      banner_url TEXT, banner_position_x INTEGER, banner_position_y INTEGER,
      banner_position_scale INTEGER, hidden_game_ids TEXT NOT NULL DEFAULT '[]', updated_at TEXT
    )`,
    `CREATE UNIQUE INDEX idx_user_profile_cloud_user_id ON user_profile_cloud(user_id)`,
    `CREATE TABLE user_collections_cloud (
      id TEXT, steam_id TEXT, user_id TEXT, name TEXT, sort_order INTEGER, updated_at TEXT,
      PRIMARY KEY (steam_id, id)
    )`,
    `CREATE UNIQUE INDEX idx_user_collections_cloud_user_id ON user_collections_cloud(user_id, id)`,
    `CREATE TABLE user_collection_games_cloud (
      steam_id TEXT, user_id TEXT, collection_id TEXT, game_id TEXT, sort_order INTEGER,
      PRIMARY KEY (steam_id, collection_id, game_id)
    )`,
    `CREATE UNIQUE INDEX idx_user_collection_games_cloud_user_id
      ON user_collection_games_cloud(user_id, collection_id, game_id)`,
    `CREATE TABLE user_favorite_games_cloud (
      steam_id TEXT, user_id TEXT, game_id TEXT, sort_order INTEGER,
      PRIMARY KEY (steam_id, game_id)
    )`,
    `CREATE UNIQUE INDEX idx_user_favorite_games_cloud_user_id
      ON user_favorite_games_cloud(user_id, game_id)`,
  ];
  await db.batch(schema.map((sql) => db.prepare(sql)));
  await db.prepare(`INSERT INTO accounts (user_id, token_version) VALUES (?, 1)`).bind("user_1").run();
  await db.prepare(
    `INSERT INTO subscriptions (
       steam_id, user_id, plan_id, status, current_period_start, current_period_end,
       last_payment_id, created_at, updated_at
     ) VALUES (NULL, ?, 'monthly', 'active', ?, ?, NULL, ?, ?)`
  ).bind(
    "user_1",
    "2026-01-01T00:00:00.000Z",
    "2099-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  ).run();
}, 20_000);

afterAll(async () => {
  await runtime?.dispose();
});

async function put(payload: unknown) {
  const token = await sessionToken("user_1");
  return worker.fetch(
    new Request("https://worker.test/cloud-profile", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    {
      SUBSCRIPTION_DB: db,
      CLOUD_SESSION_SECRET: "cloud_session_test_secret",
      ALLOWED_ORIGIN: "*",
    } as any,
    executionContext
  );
}

describe("cloud profile SQL in local D1", () => {
  it("executes JSON delta UPSERTs and remains idempotent", async () => {
    const payload = {
      updatedAt: "2026-09-01T00:00:00.000Z",
      steamProfile: {
        displayName: "Ada",
        avatarUrl: null,
        bannerUrl: null,
        bannerPosition: { x: 50, y: 50, scale: 1 },
      },
      favoriteGameIds: ["10", "20"],
      hiddenProfileGameIds: ["30"],
      userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30"] }],
    };

    const first = await put(payload);
    expect(first.status).toBe(200);
    expect(await first.json<any>()).toMatchObject({
      profile: {
        steamProfile: { displayName: "Ada" },
        favoriteGameIds: ["10", "20"],
        hiddenProfileGameIds: ["30"],
        userCollections: [{ id: "col-1", name: "RPG", gameIds: ["10", "30"] }],
      },
    });

    const second = await put(payload);
    expect(second.status).toBe(200);
    const favorites = await db.prepare(
      `SELECT game_id, sort_order FROM user_favorite_games_cloud WHERE user_id = ? ORDER BY sort_order`
    ).bind("user_1").all();
    expect(favorites.results).toEqual([
      { game_id: "10", sort_order: 0 },
      { game_id: "20", sort_order: 1 },
    ]);
  });

  it("persists a first empty snapshot instead of returning null forever", async () => {
    await db.prepare(`DELETE FROM user_profile_cloud WHERE user_id = ?`).bind("user_1").run();
    await db.prepare(`DELETE FROM user_collection_games_cloud WHERE user_id = ?`).bind("user_1").run();
    await db.prepare(`DELETE FROM user_collections_cloud WHERE user_id = ?`).bind("user_1").run();
    await db.prepare(`DELETE FROM user_favorite_games_cloud WHERE user_id = ?`).bind("user_1").run();

    const response = await put({
      updatedAt: "2026-09-02T00:00:00.000Z",
      steamProfile: null,
      favoriteGameIds: [],
      hiddenProfileGameIds: [],
      userCollections: [],
    });

    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ profile: { favoriteGameIds: [], userCollections: [] } });
    expect(await db.prepare(`SELECT COUNT(*) AS count FROM user_profile_cloud WHERE user_id = ?`)
      .bind("user_1").first<{ count: number }>()).toEqual({ count: 1 });
  });
});
