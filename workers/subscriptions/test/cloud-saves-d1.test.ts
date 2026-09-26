import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import worker, { pruneLegacyCloudSaves } from "../src/index";
import { executionContext, sessionToken } from "./helpers/worker";

let runtime: Miniflare;
let db: D1Database;

beforeEach(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-19",
    d1Databases: ["DB"],
  });
  db = await runtime.getD1Database("DB") as unknown as D1Database;
  await db.batch([
    `CREATE TABLE accounts (user_id TEXT PRIMARY KEY, token_version INTEGER)`,
    `CREATE TABLE user_connections (user_id TEXT, provider TEXT, provider_id TEXT)`,
    `CREATE TABLE subscriptions (user_id TEXT PRIMARY KEY, status TEXT, current_period_end TEXT)`,
    `CREATE TABLE cloud_saves (
       id TEXT PRIMARY KEY, steam_id TEXT, user_id TEXT, app_id TEXT, game_title TEXT,
       storage_path TEXT, size_bytes INTEGER, sha256 TEXT, manifest_json TEXT,
       device_name TEXT, pinned INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
     )`,
    `INSERT INTO accounts VALUES ('user_1', 1)`,
    `INSERT INTO accounts VALUES ('user_2', 1)`,
    `INSERT INTO subscriptions VALUES ('user_1', 'active', '2099-01-01T00:00:00.000Z')`,
    `INSERT INTO subscriptions VALUES ('user_2', 'active', '2099-01-01T00:00:00.000Z')`,
  ].map((sql) => db.prepare(sql)));
}, 20_000);

afterEach(async () => {
  vi.unstubAllGlobals();
  await runtime?.dispose();
});

async function seedSave(userId: string, id: string, appId: string, updatedAt: string, pinned = 0) {
  await db.prepare(
    `INSERT INTO cloud_saves (id, user_id, app_id, game_title, storage_path, size_bytes, sha256,
       created_at, updated_at, pinned) VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?, ?)`
  ).bind(id, userId, appId, "Game", `${userId}/${appId}/${id}.zip`, "a".repeat(64), updatedAt, updatedAt, pinned).run();
}

async function call(userId: string, method: string, path: string, headers: Record<string, string> = {}, body?: BodyInit) {
  const token = await sessionToken(userId);
  return worker.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...headers },
      body,
    }),
    {
      SUBSCRIPTION_DB: db,
      CLOUD_SESSION_SECRET: "cloud_session_test_secret",
      ALLOWED_ORIGIN: "*",
      SUPABASE_URL: "https://storage.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
    } as any,
    executionContext,
  );
}

describe("one cloud save per game", () => {
  it("lists only the newest legacy save, regardless of the old pinned flag", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z", 1);
    await seedSave("user_1", "new", "10", "2026-09-01T00:00:00.000Z");
    const response = await call("user_1", "GET", "/cloud-saves");
    expect(response.status).toBe(200);
    expect((await response.json<{ saves: Array<{ id: string }> }>()).saves.map((save) => save.id)).toEqual(["new"]);
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM cloud_saves`).first<{ count: number }>())?.count).toBe(2);
  });

  it("replaces older versions on upload while retaining the new save", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    const storageFetch = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", storageFetch);
    const response = await call("user_1", "POST", "/cloud-saves", {
      "x-ghostbox-app-id": "10",
      "x-ghostbox-game-title": "Game",
      "x-ghostbox-sha256": "b".repeat(64),
      "content-type": "application/zip",
    }, new Uint8Array([1, 2, 3]));
    expect(response.status).toBe(201);
    const { save } = await response.json<{ save: { id: string } }>();
    const remaining = await db.prepare(`SELECT id FROM cloud_saves WHERE user_id = ? AND app_id = ?`).bind("user_1", "10").all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual([save.id]);
    expect(storageFetch.mock.calls.some(([request]) => request.toString().includes("/storage/v1/object/cloud-saves"))).toBe(true);
  });

  it("deletes every legacy save for one game without affecting another account", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    await seedSave("user_1", "new", "10", "2026-09-01T00:00:00.000Z");
    await seedSave("user_2", "other", "10", "2026-09-01T00:00:00.000Z");
    const storageFetch = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", storageFetch);
    const response = await call("user_1", "DELETE", "/cloud-saves/game/10");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, appId: "10", deletedSaves: 2 });
    const remaining = await db.prepare(`SELECT id FROM cloud_saves`).all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual(["other"]);
    expect(storageFetch).toHaveBeenCalledTimes(1);
  });

  it("cleans older backups without pruning on GET or removing another game's newest save", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    await seedSave("user_1", "new", "10", "2026-09-01T00:00:00.000Z");
    await seedSave("user_1", "other", "20", "2026-08-01T00:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async (_url: string) => new Response("{}", { status: 200 })));
    await pruneLegacyCloudSaves({
      SUBSCRIPTION_DB: db,
      SUPABASE_URL: "https://storage.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
    } as any);
    const remaining = await db.prepare(`SELECT id FROM cloud_saves ORDER BY id`).all<{ id: string }>();
    expect(remaining.results.map((row) => row.id)).toEqual(["new", "other"]);
  });

  it("retains records when cloud storage refuses a game deletion", async () => {
    await seedSave("user_1", "saved", "10", "2026-09-01T00:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async (_url: string) => new Response("failed", { status: 503 })));
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await call("user_1", "DELETE", "/cloud-saves/game/10")).status).toBe(500);
    } finally {
      loggedError.mockRestore();
    }
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM cloud_saves`).first<{ count: number }>())?.count).toBe(1);
  });
});
