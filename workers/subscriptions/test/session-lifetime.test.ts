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
    // Linking is mandatory: with no recovery emails and no backup codes, the
    // last linked provider is the only way back into a forgotten password. The
    // refusal is final — no `confirm` flag on the client can talk past it.
    const db = linkedDb();
    const token = await sessionToken("user_1");

    const response = await worker.fetch(disconnectRequest(token, { confirm: true }), makeEnv(db), executionContext);
    expect(response.status).toBe(409);
    expect(await response.json<any>()).toMatchObject({ error: "last_connection" });
    expect(db.rows("user_connections")).toHaveLength(1);
  });

  it("unlinks Discord without touching the account session, when another provider stays", async () => {
    // Regression: disconnecting Discord dropped the user to the login modal.
    // Whatever the trigger was, the session must survive the round trip. A
    // Steam connection is kept so the unlink is allowed.
    const db = fakeD1({
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
        { user_id: "user_1", provider: "discord", provider_id: "discord_1", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
        { user_id: "user_1", provider: "steam", provider_id: "76561198000000001", metadata_json: "{}", linked_at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const token = await sessionToken("user_1");
    const env = makeEnv(db);

    const disconnected = await worker.fetch(disconnectRequest(token), env, executionContext);
    expect(disconnected.status).toBe(200);
    expect(db.rows("discord_links")).toEqual([]);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ provider: "steam", provider_id: "76561198000000001" }),
    ]);

    const me = await worker.fetch(meRequest(token), env, executionContext);
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

  it("signs other devices out when the password changes, and re-arms the caller", async () => {
    const db = fakeD1({ accounts: [account({ token_version: 1 })] });
    const env = makeEnv(db, { FIREBASE_API_KEY: "test_key" });
    const caller = await sessionToken("user_1", DAY, 1);
    const otherDevice = await sessionToken("user_1", DAY, 1);

    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("accounts:signInWithPassword")) {
        return Response.json({ localId: "user_1", idToken: "id_1", refreshToken: "r_1", email: "ghost@example.com" });
      }
      if (url.includes("accounts:update")) return Response.json({ localId: "user_1" });
      throw new Error(`unexpected call ${url}`);
    }) as typeof fetch;

    try {
      const changed = await worker.fetch(
        new Request("https://worker.test/auth/change-password", {
          method: "POST",
          headers: { authorization: `Bearer ${caller}`, "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
        }),
        env,
        executionContext
      );
      expect(changed.status).toBe(200);
      const { token: replacement } = await changed.json<any>();
      expect(replacement).toBeTruthy();

      // The device that was not the one changing the password is out.
      const stale = await worker.fetch(meRequest(otherDevice), env, executionContext);
      expect(stale.status).toBe(401);

      // The caller keeps working, on the token it just received.
      const fresh = await worker.fetch(meRequest(replacement), env, executionContext);
      expect(fresh.status).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
  });
});
