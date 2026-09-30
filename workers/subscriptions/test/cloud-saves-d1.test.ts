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
    `CREATE TABLE cloud_save_write_locks (
       user_id TEXT, app_id TEXT, token TEXT, expires_at TEXT, PRIMARY KEY (user_id, app_id)
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

  it("orders a new upload after an existing save with the same timestamp", async () => {
    const timestamp = new Date(Date.now() + 1000).toISOString();
    await seedSave("user_1", "old", "10", timestamp);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const response = await call("user_1", "POST", "/cloud-saves", {
      "x-ghostbox-app-id": "10",
      "x-ghostbox-game-title": "Game",
      "x-ghostbox-sha256": "b".repeat(64),
      "content-type": "application/zip",
    }, new Uint8Array([1]));
    expect(response.status).toBe(201);
    const { save } = await response.json<{ save: { id: string; updatedAt: string } }>();
    expect(save.updatedAt > timestamp).toBe(true);
    const list = await call("user_1", "GET", "/cloud-saves?appId=10");
    expect((await list.json<{ saves: Array<{ id: string }> }>()).saves.map((row) => row.id)).toEqual([save.id]);
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM cloud_saves WHERE user_id = 'user_1'`).first<{ count: number }>())?.count).toBe(1);
  });

  it("keeps the existing save if D1 refuses the new upload after storage accepts it", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    await db.prepare(`CREATE TRIGGER reject_cloud_insert BEFORE INSERT ON cloud_saves BEGIN SELECT RAISE(FAIL, 'insert failed'); END`).run();
    const storageFetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", storageFetch);
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await call("user_1", "POST", "/cloud-saves", {
        "x-ghostbox-app-id": "10", "x-ghostbox-game-title": "Game",
        "x-ghostbox-sha256": "b".repeat(64), "content-type": "application/zip",
      }, new Uint8Array([1]));
      expect(response.status).toBe(500);
    } finally {
      loggedError.mockRestore();
    }
    expect((await db.prepare(`SELECT id FROM cloud_saves`).all<{ id: string }>()).results.map((row) => row.id)).toEqual(["old"]);
    const removed = storageFetch.mock.calls.find(([url, options]) => options?.method === "DELETE");
    expect(removed).toBeDefined();
    expect(JSON.parse(removed![1]!.body as string).prefixes).not.toContain("user_1/10/old.zip");
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

  it("does not promote a pinned legacy save over the latest backup", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z", 1);
    await seedSave("user_1", "new", "10", "2026-09-01T00:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const response = await call("user_1", "PATCH", "/cloud-saves/old/pinned", { "content-type": "application/json" }, JSON.stringify({ pinned: false }));
    expect(response.status).toBe(200);
    const rows = await db.prepare(`SELECT id FROM cloud_saves ORDER BY id`).all<{ id: string }>();
    expect(rows.results.map((row) => row.id)).toEqual(["new", "old"]);
    const listed = await call("user_1", "GET", "/cloud-saves?appId=10");
    expect((await listed.json<{ saves: Array<{ id: string }> }>()).saves.map((save) => save.id)).toEqual(["new"]);
  });

  it("refuses concurrent writes on the same account/game without blocking other accounts", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      started();
      await blocked;
      return new Response("{}", { status: 200 });
    }));
    const deleting = call("user_1", "DELETE", "/cloud-saves/game/10");
    await entered;
    try {
      const headers = {
        "x-ghostbox-app-id": "10", "x-ghostbox-game-title": "Game",
        "x-ghostbox-sha256": "b".repeat(64), "content-type": "application/zip",
      };
      const upload = await call("user_1", "POST", "/cloud-saves", headers, new Uint8Array([1]));
      expect(upload.status).toBe(409);
      expect(await upload.json()).toMatchObject({ error: "cloud_save_busy" });
      expect((await call("user_2", "DELETE", "/cloud-saves/game/10")).status).toBe(200);
    } finally {
      release();
    }
    expect((await deleting).status).toBe(200);
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM cloud_saves WHERE user_id = 'user_1'`).first<{ count: number }>())?.count).toBe(0);
  });

  it("does not prune an in-flight game's legacy saves", async () => {
    await seedSave("user_1", "old", "10", "2026-08-01T00:00:00.000Z");
    await seedSave("user_1", "new", "10", "2026-09-01T00:00:00.000Z");
    await db.prepare(`INSERT INTO cloud_save_write_locks VALUES (?, ?, ?, ?)`).bind("user_1", "10", "in-flight", "2099-01-01T00:00:00.000Z").run();
    const storageFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", storageFetch);
    await pruneLegacyCloudSaves({ SUBSCRIPTION_DB: db, SUPABASE_URL: "https://storage.example.com", SUPABASE_SERVICE_ROLE_KEY: "test-key" } as any);
    expect(storageFetch).not.toHaveBeenCalled();
    expect((await db.prepare(`SELECT COUNT(*) AS count FROM cloud_saves`).first<{ count: number }>())?.count).toBe(2);
  });
});
