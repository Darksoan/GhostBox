import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeD1, type Row } from "./helpers/fake-d1";
import { executionContext, makeEnv, sessionToken } from "./helpers/worker";

const DAY = 24 * 60 * 60;

function account(overrides: Row = {}): Row {
  return {
    user_id: "user_1",
    email: "ghost@example.com",
    username: "ghost",
    display_name: "Ghost",
    email_verified: 1,
    verified_via: "email",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function linkedDb() {
  return fakeD1({
    accounts: [account()],
    discord_links: [
      {
        steam_id: null,
        user_id: "user_1",
        discord_user_id: "discord_1",
        discord_username: "ghost",
        discord_global_name: "Ghost",
        linked_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    user_connections: [
      {
        user_id: "user_1",
        provider: "discord",
        provider_id: "discord_1",
        metadata_json: "{}",
        linked_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
}

function meRequest(token: string) {
  return new Request("https://worker.test/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /auth/me session renewal", () => {
  it("slides the session forward once it is past half its life", async () => {
    // 3 days left out of 7 — under the halfway mark.
    const token = await sessionToken("user_1", 3 * DAY);
    const body = await worker
      .fetch(meRequest(token), makeEnv(linkedDb()), executionContext)
      .then((response) => response.json<any>());

    expect(body.token).toBeTruthy();
    expect(body.token).not.toBe(token);

    // The renewed token has to be accepted on its own.
    const reused = await worker.fetch(meRequest(body.token), makeEnv(linkedDb()), executionContext);
    expect(reused.status).toBe(200);
  });

  it("leaves a fresh session alone", async () => {
    const token = await sessionToken("user_1", 6 * DAY);
    const body = await worker
      .fetch(meRequest(token), makeEnv(linkedDb()), executionContext)
      .then((response) => response.json<any>());

    expect(body.token).toBeUndefined();
  });

  it("still rejects a session that already expired", async () => {
    const token = await sessionToken("user_1", -60);
    const response = await worker.fetch(meRequest(token), makeEnv(linkedDb()), executionContext);
    expect(response.status).toBe(401);
  });
});

function disconnectRequest(token: string, body?: Record<string, unknown>) {
  return new Request("https://worker.test/auth/connections/discord", {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("DELETE /auth/connections/discord", () => {
  it("refuses to remove the last connection, with no opt-out", async () => {
    // The provider account IS the login now: no password, no backup codes.
    // The last linked provider is the only way back in, so the refusal is
    // final — no `confirm` flag on the client can talk past it.
    const db = linkedDb();
    const token = await sessionToken("user_1");

    const response = await worker.fetch(disconnectRequest(token, { confirm: true }), makeEnv(db), executionContext);
    expect(response.status).toBe(409);
    expect(await response.json<any>()).toMatchObject({ error: "last_connection" });
    expect(db.rows("user_connections")).toHaveLength(1);
  });

  it("accepts an older valid session when removing a provider", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [
        { user_id: "user_1", provider: "discord", provider_id: "discord_1", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
        { user_id: "user_1", provider: "steam", provider_id: "76561198000000001", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    // Provider-only auth has no practical separate step-up mechanism.
    const stale = await sessionToken("user_1", 6 * 24 * 60 * 60, 1, Math.floor(Date.now() / 1000) - 3600);

    const response = await worker.fetch(disconnectRequest(stale), makeEnv(db), executionContext);
    expect(response.status).toBe(200);
    expect(db.rows("user_connections")).toHaveLength(1);
  });

  it("unlinks Discord and signs other devices out, when another provider stays", async () => {
    // Unlinking removes a way in, so every other device is signed out. The
    // caller gets a token on the new version and keeps working. A Steam
    // connection is kept so the unlink is allowed.
    const db = fakeD1({
      accounts: [account({ token_version: 1 })],
      discord_links: [
        {
          steam_id: null,
          user_id: "user_1",
          discord_user_id: "discord_1",
          discord_username: "ghost",
          discord_global_name: "Ghost",
          linked_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      user_connections: [
        { user_id: "user_1", provider: "discord", provider_id: "discord_1", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
        { user_id: "user_1", provider: "steam", provider_id: "76561198000000001", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const caller = await sessionToken("user_1", DAY, 1);
    const otherDevice = await sessionToken("user_1", DAY, 1);
    const env = makeEnv(db);

    const disconnected = await worker.fetch(disconnectRequest(caller), env, executionContext);
    expect(disconnected.status).toBe(200);
    const { token: replacement } = await disconnected.json<any>();
    expect(replacement).toBeTruthy();
    expect(db.rows("discord_links")).toEqual([]);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ provider: "steam", provider_id: "76561198000000001" }),
    ]);

    // The device that did not unlink is out.
    const stale = await worker.fetch(meRequest(otherDevice), env, executionContext);
    expect(stale.status).toBe(401);

    // The caller keeps working on the replacement, and only Steam is linked.
    const me = await worker.fetch(meRequest(replacement), env, executionContext);
    expect(me.status).toBe(200);
    const body = await me.json<any>();
    expect(body.account.userId).toBe("user_1");
    expect(body.connections).toEqual([expect.objectContaining({ provider: "steam" })]);
  });
});

describe("session revocation", () => {
  it("rejects a token minted before the account's current version", async () => {
    const db = fakeD1({ accounts: [account({ token_version: 3 })] });
    const stale = await sessionToken("user_1", DAY, 2);

    const response = await worker.fetch(meRequest(stale), makeEnv(db), executionContext);
    expect(response.status).toBe(401);
    expect(await response.json<any>()).toEqual({ error: "session_revoked" });
  });

  it("honours a token minted before migration 0016, which carries no version", async () => {
    const db = fakeD1({ accounts: [account({ token_version: 1 })] });
    const legacy = await sessionToken("user_1", DAY);

    const response = await worker.fetch(meRequest(legacy), makeEnv(db), executionContext);
    expect(response.status).toBe(200);
  });

  it("answers 410 on the retired password endpoints", async () => {
    const db = fakeD1({ accounts: [account({ token_version: 1 })] });
    const env = makeEnv(db);
    const caller = await sessionToken("user_1", DAY, 1);

    for (const [path, body] of [
      ["/auth/register", { email: "ghost@example.com", username: "ghost", password: "password123" }],
      ["/auth/login", { identifier: "ghost", password: "password123" }],
      ["/auth/change-password", { currentPassword: "old-password", newPassword: "new-password" }],
      ["/auth/recover/exchange", { ticket: "whatever" }],
      ["/auth/recover/password", {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${caller}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        executionContext
      );
      expect(response.status).toBe(410);
      expect(await response.json<any>()).toMatchObject({ error: "password_auth_removed" });
    }
  });
});
