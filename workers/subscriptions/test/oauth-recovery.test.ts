import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256 } from "../src/crypto";
import { fakeD1, type Row } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

// Provider-only auth: Steam signs in and signs up directly, Discord login
// tickets double as the second proof for the confirmed merge flow, and the
// password-recovery hand-off is gone (410).

const STATE_SECRET = "discord_state_test_secret";
const DISCORD_USER_ID = "discord_1";
const APP_NONCE = "app_nonce_abcdefghij";
const LOOPBACK_PORT = 51234;
const STEAM_ID = "76561198000000001";

function env(db: ReturnType<typeof fakeD1>, overrides: Record<string, unknown> = {}) {
  return makeEnv(db, {
    DISCORD_CLIENT_ID: "client_1",
    DISCORD_CLIENT_SECRET: "client_secret_1",
    DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
    ...overrides,
  });
}

async function oauthState(options: {
  purpose?: "login" | "recover" | "link";
  provider?: "discord";
  userId?: string;
  port?: number | string;
  appNonce?: string;
} = {}) {
  const payload = [
    options.purpose ?? "login",
    options.provider ?? "discord",
    options.userId ?? "",
    options.port ?? LOOPBACK_PORT,
    options.appNonce ?? APP_NONCE,
    Math.floor(Date.now() / 1000) + 600,
    "nonce_1",
  ].join(".");
  return `${payload}.${await hmacSha256(STATE_SECRET, payload)}`;
}

/** The OAuth token + profile exchange the callback performs after the browser
 * round-trip, stubbed at the network boundary. */
function mockDiscordOAuth(user: Record<string, unknown> = {}) {
  return mockStripe({
    routes: {
      "oauth2/token": { access_token: "discord_access_token", token_type: "Bearer" },
      "users/@me": {
        id: DISCORD_USER_ID,
        username: "ghost",
        global_name: "Ghost",
        email: "ghost@example.com",
        verified: true,
        ...user,
      },
    },
  });
}

function account(overrides: Row = {}): Row {
  return {
    user_id: "user_1",
    email: "ghost@example.com",
    username: "ghost",
    display_name: "Ghost",
    email_verified: 0,
    verified_via: null,
    token_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function connection(userId: string, provider: string, providerId: string, overrides: Row = {}): Row {
  return {
    user_id: userId,
    provider,
    provider_id: providerId,
    metadata_json: "{}",
    linked_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let mock: ReturnType<typeof mockStripe> | null = null;
afterEach(() => {
  mock?.restore();
  mock = null;
});

/** A Steam OpenID callback shaped like the desktop app produces it:
 * loopback return_to, Steam op_endpoint, matching claimed/identity ids, and
 * a fresh response_nonce. `overrides` swaps any parameter. */
function steamCallbackUrl(overrides: Record<string, string | null> = {}, nonce?: string) {
  const params: Record<string, string> = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": "http://127.0.0.1:5000/steam/callback?state=abc",
    "openid.response_nonce": nonce ?? `${new Date().toISOString()}unique-${Math.random()}`,
    "openid.sig": "abc",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete params[key];
    else params[key] = value;
  }
  const query = new URLSearchParams(params).toString();
  return `http://127.0.0.1:5000/steam/callback?${query}`;
}

/** Stubs the Steam check_authentication call. */
function steamMock(isValid: boolean) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${isValid}\n`)) as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("POST /auth/steam/login", () => {
  function loginRequest(body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/steam/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("signs in the account that linked this Steam", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: steamCallbackUrl() }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(200);
      const body = await response.json<any>();
      expect(body.account.userId).toBe("user_1");
      expect(body.steamId).toBe(STEAM_ID);
    } finally {
      restore();
    }
  });

  it("refuses a callback Steam does not vouch for, whatever the body claims", async () => {
    const restore = steamMock(false);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: steamCallbackUrl() }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(401);
    } finally {
      restore();
    }
  });

  it("creates and signs into an account for an unknown Steam", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({ accounts: [account()] });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: steamCallbackUrl() }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(201);
      expect(await response.json<any>()).toMatchObject({ isNewAccount: true, steamId: STEAM_ID });
      expect(db.rows("accounts")).toHaveLength(2);
      expect(db.rows("accounts")[1].email).toBe(null);
    } finally {
      restore();
    }
  });

  it("rejects an assertion minted for somebody else's return_to", async () => {
    // Even with Steam answering is_valid:true, an assertion addressed to
    // another flow is not ours.
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const response = await worker.fetch(
        loginRequest({
          callbackUrl: steamCallbackUrl({ "openid.return_to": "https://evil.example/steam/callback" }),
        }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(401);
    } finally {
      restore();
    }
  });

  it("rejects a replayed assertion, even one Steam would still confirm", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const callbackUrl = steamCallbackUrl();
      const first = await worker.fetch(loginRequest({ callbackUrl }), env(db), executionContext);
      expect(first.status).toBe(200);

      const replay = await worker.fetch(loginRequest({ callbackUrl }), env(db), executionContext);
      expect(replay.status).toBe(401);
      expect(await replay.json<any>()).toEqual({ error: "invalid_steam_login" });
    } finally {
      restore();
    }
  });

  it("rejects an assertion past the freshness window", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const response = await worker.fetch(
        loginRequest({ callbackUrl: steamCallbackUrl({}, `${old}stale`) }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(401);
    } finally {
      restore();
    }
  });
});

describe("POST /auth/oauth/exchange", () => {
  async function loginTicket(db: ReturnType<typeof fakeD1>) {
    const callback = await worker.fetch(
      new Request(
        `https://worker.test/oauth/callback?code=auth_code_1&state=${encodeURIComponent(await oauthState({}))}`,
        { redirect: "manual" }
      ),
      env(db),
      executionContext
    );
    expect(callback.status).toBe(302);
    return new URL(callback.headers.get("location")!).searchParams.get("ticket")!;
  }

  function exchangeRequest(ticket: string) {
    return new Request("https://worker.test/auth/oauth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  }

  it("returns the linked Steam id, like Steam login does", async () => {
    // The client keys the linked-Steam restore off `steamId`. A Discord
    // sign-in to a doubly-linked account must carry it too otherwise avatar
    // and banner sync depends on which provider signed in.
    mock = mockDiscordOAuth();
    const db = fakeD1({
      accounts: [account()],
      user_connections: [
        connection("user_1", "discord", DISCORD_USER_ID),
        connection("user_1", "steam", STEAM_ID),
      ],
    });
    const response = await worker.fetch(exchangeRequest(await loginTicket(db)), env(db), executionContext);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ isNewAccount: false, steamId: STEAM_ID });
  });

  it("returns a null Steam id when no Steam is linked", async () => {
    mock = mockDiscordOAuth();
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("user_1", "discord", DISCORD_USER_ID)],
    });
    const response = await worker.fetch(exchangeRequest(await loginTicket(db)), env(db), executionContext);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ isNewAccount: false, steamId: null });
  });
});

describe("removed provider signup route", () => {
  it("answers 404 for POST /auth/steam/signup", async () => {
    const restore = steamMock(true);
    try {
      const response = await worker.fetch(
        new Request("https://worker.test/auth/steam/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callbackUrl: steamCallbackUrl(), username: "ghost" }),
        }),
        env(fakeD1()),
        executionContext
      );
      expect(response.status).toBe(404);
    } finally {
      restore();
    }
  });
});

describe("concurrent first logins converge", () => {
  it("two Steam assertions for the same account yield one account", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1();
      const loginRequest = (callbackUrl: string) =>
        new Request("https://worker.test/auth/steam/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            callbackUrl,
            displayName: "Steam Ghost",
            avatarUrl: "https://example.com/a.png",
          }),
        });
      const [left, right] = await Promise.all([
        worker.fetch(loginRequest(steamCallbackUrl()), env(db), executionContext),
        worker.fetch(loginRequest(steamCallbackUrl()), env(db), executionContext),
      ]);
      expect([left.status, right.status].sort()).toEqual([200, 201]);
      expect(db.rows("accounts")).toHaveLength(1);
      expect(db.rows("user_connections")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("two Discord tickets for the same account yield one account", async () => {
    mock = mockDiscordOAuth();
    const db = fakeD1();
    async function ticket() {
      const callback = await worker.fetch(
        new Request(
          `https://worker.test/oauth/callback?code=auth_code_1&state=${encodeURIComponent(await oauthState({}))}`,
          { redirect: "manual" }
        ),
        env(db),
        executionContext
      );
      expect(callback.status).toBe(302);
      return new URL(callback.headers.get("location")!).searchParams.get("ticket")!;
    }
    const first = await ticket();
    const second = await ticket();
    const exchange = (value: string) =>
      new Request("https://worker.test/auth/oauth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: value }),
      });
    const [left, right] = await Promise.all([
      worker.fetch(exchange(first), env(db), executionContext),
      worker.fetch(exchange(second), env(db), executionContext),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(db.rows("accounts")).toHaveLength(1);
    expect(db.rows("user_connections").filter((row) => row.provider === "discord")).toHaveLength(1);
  });

  it("simultaneous unlinks cannot remove the last provider", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [
        connection("user_1", "discord", DISCORD_USER_ID),
        connection("user_1", "steam", STEAM_ID),
      ],
    });
    const token = await sessionToken("user_1");
    const remove = (provider: string) =>
      new Request(`https://worker.test/auth/connections/${provider}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
    const [left, right] = await Promise.all([
      worker.fetch(remove("discord"), env(db), executionContext),
      worker.fetch(remove("steam"), env(db), executionContext),
    ]);
    // Exactly one unlink wins. The loser is rejected — either by the
    // last-connection guard or by the session rotation of the winner.
    const statuses = [left.status, right.status].sort();
    expect(statuses[0]).toBe(200);
    expect([401, 409]).toContain(statuses[1]);
    expect(db.rows("user_connections")).toHaveLength(1);
  });
});

describe("removed merge and deletion routes", () => {
  it("answers 404 for merge preview, merge confirm and account deletion", async () => {
    const db = fakeD1({ accounts: [account()] });
    const token = await sessionToken("user_1");
    for (const request of [
      new Request("https://worker.test/auth/merge/preview", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      new Request("https://worker.test/auth/merge/confirm", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
      new Request("https://worker.test/auth/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
    ]) {
      const response = await worker.fetch(request, env(db), executionContext);
      expect(response.status).toBe(404);
    }
    expect(db.rows("accounts")).toHaveLength(1);
  });
});
