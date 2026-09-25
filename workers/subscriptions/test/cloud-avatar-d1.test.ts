import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  await db.batch([
    `CREATE TABLE accounts (user_id TEXT PRIMARY KEY, token_version INTEGER)`,
    `CREATE TABLE user_connections (user_id TEXT, provider TEXT, provider_id TEXT)`,
    `CREATE TABLE subscriptions (user_id TEXT, steam_id TEXT, access_type TEXT, status TEXT, current_period_end TEXT)`,
    `CREATE TABLE user_profile_cloud (
      steam_id TEXT PRIMARY KEY, user_id TEXT UNIQUE, display_name TEXT,
      avatar_url TEXT, banner_url TEXT, banner_position_x INTEGER DEFAULT 50,
      banner_position_y INTEGER DEFAULT 50, banner_position_scale INTEGER DEFAULT 100,
      hidden_game_ids TEXT DEFAULT '[]', updated_at TEXT NOT NULL
    )`,
  ].map((sql) => db.prepare(sql)));
  await db.prepare(`INSERT INTO accounts (user_id, token_version) VALUES (?, 1)`).bind("free_1").run();
  await db.prepare(`INSERT INTO accounts (user_id, token_version) VALUES (?, 1)`).bind("free_2").run();
  await db.prepare(
    `INSERT INTO user_profile_cloud (user_id, display_name, banner_url, hidden_game_ids, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind("free_1", "Ada", "https://example.com/premium-banner.webp", '["10"]', "2026-01-01T00:00:00Z").run();
}, 20_000);

afterAll(async () => {
  await runtime?.dispose();
});

async function requestAvatar(userId: string | null, method: string, body?: unknown) {
  const token = userId ? await sessionToken(userId) : null;
  return worker.fetch(
    new Request("https://worker.test/cloud-profile/avatar", {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { SUBSCRIPTION_DB: db, CLOUD_SESSION_SECRET: "cloud_session_test_secret", ALLOWED_ORIGIN: "*" } as any,
    executionContext,
  );
}

describe("avatar em nuvem para contas gratuitas", () => {
  it("exige login tanto para leitura como gravação", async () => {
    expect((await requestAvatar(null, "GET")).status).toBe(401);
    expect((await requestAvatar(null, "PUT", { avatarUrl: "https://example.com/avatar.webp" })).status).toBe(401);
  });

  it("salva e recupera o avatar por conta sem apagar dados Premium", async () => {
    const avatarUrl = "https://example.com/avatar.webp";
    const saved = await requestAvatar("free_1", "PUT", {
      avatarUrl,
      bannerUrl: "https://example.com/unauthorized-banner.webp",
      hiddenProfileGameIds: ["999"],
    });
    expect(saved.status).toBe(200);
    expect(await saved.json<any>()).toEqual({ avatarUrl });

    const restored = await requestAvatar("free_1", "GET");
    expect(await restored.json<any>()).toEqual({ avatarUrl });
    expect(await (await requestAvatar("free_2", "GET")).json<any>()).toEqual({ avatarUrl: null });
    expect(await db.prepare(
      `SELECT display_name, avatar_url, banner_url, hidden_game_ids FROM user_profile_cloud WHERE user_id = ?`
    ).bind("free_1").first()).toEqual({
      display_name: "Ada",
      avatar_url: avatarUrl,
      banner_url: "https://example.com/premium-banner.webp",
      hidden_game_ids: '["10"]',
    });
  });

  it("cria registro para conta sem perfil anterior e rejeita data URLs", async () => {
    const avatarUrl = "https://example.com/free-2.webp";
    expect((await requestAvatar("free_2", "PUT", { avatarUrl })).status).toBe(200);
    expect(await (await requestAvatar("free_2", "GET")).json<any>()).toEqual({ avatarUrl });
    expect((await requestAvatar("free_2", "PUT", { avatarUrl: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect(await (await requestAvatar("free_2", "GET")).json<any>()).toEqual({ avatarUrl });
  });

  it("envia a imagem de um usuário free e recupera a URL após salvá-la", async () => {
    const storageFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", storageFetch);
    try {
      const token = await sessionToken("free_1");
      const uploaded = await worker.fetch(
        new Request("https://worker.test/cloud-profile/avatar", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "image/webp" },
          body: new Uint8Array([82, 73, 70, 70]),
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
      expect(uploaded.status).toBe(201);
      const { url } = await uploaded.json<{ url: string }>();
      expect(url).toContain("/profile-images/free_1/avatar.webp");
      expect(storageFetch).toHaveBeenCalledTimes(1);
      expect((await requestAvatar("free_1", "PUT", { avatarUrl: url })).status).toBe(200);
      expect(await (await requestAvatar("free_1", "GET")).json<any>()).toEqual({ avatarUrl: url });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("não concede acesso ao perfil completo ou às capas", async () => {
    const token = await sessionToken("free_1");
    const env = { SUBSCRIPTION_DB: db, CLOUD_SESSION_SECRET: "cloud_session_test_secret", ALLOWED_ORIGIN: "*" } as any;
    for (const [method, path] of [["GET", "/cloud-profile"], ["PUT", "/cloud-profile"], ["POST", "/cloud-profile/banner"]]) {
      const response = await worker.fetch(
        new Request(`https://worker.test${path}`, { method, headers: { authorization: `Bearer ${token}` } }),
        env,
        executionContext,
      );
      expect(response.status).toBe(402);
    }
  });
});
