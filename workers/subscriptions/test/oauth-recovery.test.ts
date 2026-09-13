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

  it("points an unknown Steam at signup instead of creating an account", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({ accounts: [account()] });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: steamCallbackUrl() }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(404);
      expect(await response.json<any>()).toMatchObject({ error: "steam_not_linked", steamId: STEAM_ID });
      expect(db.rows("accounts")).toHaveLength(1);
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

describe("POST /auth/steam/signup", () => {
  function signupRequest(body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/steam/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates the account from a validated Steam proof and signs in", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1();
      const response = await worker.fetch(
        signupRequest({
          callbackUrl: steamCallbackUrl(),
          username: "steamghost",
          displayName: "Steam Ghost",
          acceptTerms: true,
        }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(201);
      const body = await response.json<any>();
      expect(body.isNewAccount).toBe(true);
      expect(body.token).toBeTruthy();
      expect(body.account.username).toBe("steamghost");
      expect(body.account.email).toBe(null);
      expect(body.steamId).toBe(STEAM_ID);
      expect(body.disclaimer).toMatch(/Discord ou pela Steam/);
      expect(db.rows("user_connections")).toEqual([
        expect.objectContaining({ provider: "steam", provider_id: STEAM_ID }),
      ]);
    } finally {
      restore();
    }
  });

  it("reuses the same assertion from a bare login to complete the signup", async () => {
    // One browser round-trip: the login finds nobody and leaves the assertion
    // unspent, so the signup confirmation that follows consumes it.
    const restore = steamMock(true);
    try {
      const db = fakeD1();
      const callbackUrl = steamCallbackUrl();

      const login = await worker.fetch(
        new Request("https://worker.test/auth/steam/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callbackUrl }),
        }),
        env(db),
        executionContext
      );
      expect(login.status).toBe(404);

      const signup = await worker.fetch(
        signupRequest({ callbackUrl, username: "steamghost", acceptTerms: true }),
        env(db),
        executionContext
      );
      expect(signup.status).toBe(201);
      expect(db.rows("accounts")).toHaveLength(1);

      // And now it is spent.
      const replay = await worker.fetch(
        signupRequest({ callbackUrl, username: "someone_else", acceptTerms: true }),
        env(db),
        executionContext
      );
      expect(replay.status).toBe(401);
    } finally {
      restore();
    }
  });

  it("rejects a taken username and an already-linked Steam", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("user_1", "steam", STEAM_ID)],
      });
      const taken = await worker.fetch(
        signupRequest({ callbackUrl: steamCallbackUrl(), username: "ghost", acceptTerms: true }),
        env(db),
        executionContext
      );
      expect(taken.status).toBe(409);

      const linked = await worker.fetch(
        signupRequest({ callbackUrl: steamCallbackUrl(), username: "someone_new", acceptTerms: true }),
        env(db),
        executionContext
      );
      expect(linked.status).toBe(409);
      expect(await linked.json<any>()).toEqual({ error: "provider_already_linked" });
      expect(db.rows("accounts")).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("confirmed account merge", () => {
  /** A Discord login ticket proving the account that linked `discordId`. */
  async function discordTicket(db: ReturnType<typeof fakeD1>, discordId: string) {
    mock = mockDiscordOAuth({ id: discordId });
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

  function previewRequest(token: string, body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/merge/preview", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function confirmRequest(token: string, body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/merge/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("previews both sides, then absorbs the second account on confirm", async () => {
    // A holds Steam, B holds Discord: complementary types, so the merge moves
    // B's Discord onto A and deletes B.
    const db = fakeD1({
      accounts: [
        account({ user_id: "user_a", username: "alice", email: null }),
        account({ user_id: "user_b", username: "bob", email: "bob@example.com" }),
      ],
      user_connections: [
        connection("user_a", "steam", STEAM_ID),
        connection("user_b", "discord", "discord_b"),
      ],
    });
    const ticket = await discordTicket(db, "discord_b");
    const token = await sessionToken("user_a");

    const preview = await worker.fetch(previewRequest(token, { ticket }), env(db), executionContext);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json<any>();
    expect(previewBody.primaryAccount.username).toBe("alice");
    expect(previewBody.secondaryAccount.username).toBe("bob");
    expect(previewBody.warning).toMatch(/excluída/);
    // Preview spends nothing.
    expect(db.rows("accounts")).toHaveLength(2);

    const confirmed = await worker.fetch(
      confirmRequest(token, { ticket, confirm: true }),
      env(db),
      executionContext
    );
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json<any>();
    expect(body.account.username).toBe("alice");
    expect(body.token).toBeTruthy();

    // B is gone; both providers now belong to A.
    expect(db.rows("accounts").map((row) => row.user_id)).toEqual(["user_a"]);
    const providers = db.rows("user_connections").map((row) => `${row.provider}:${row.provider_id}`).sort();
    expect(providers).toEqual(["discord:discord_b", `steam:${STEAM_ID}`]);

    // B's old session dies with the account.
    const ghost = await sessionToken("user_b");
    const me = await worker.fetch(
      new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${ghost}` } }),
      env(db),
      executionContext
    );
    expect(me.status).toBe(404);
  });

  it("rolls back every database move when the merge batch fails", async () => {
    const db = fakeD1({
      accounts: [
        account({ user_id: "user_a", username: "alice", email: null }),
        account({ user_id: "user_b", username: "bob", email: null }),
      ],
      user_connections: [
        connection("user_a", "steam", STEAM_ID),
        connection("user_b", "discord", "discord_b"),
      ],
      payments: [{ id: "pay_b", user_id: "user_b", steam_id: null }],
    });
    const ticket = await discordTicket(db, "discord_b");
    const token = await sessionToken("user_a");
    db.failBatchAt(3);

    const response = await worker.fetch(
      confirmRequest(token, { ticket, confirm: true }),
      env(db),
      executionContext
    );

    expect(response.status).toBe(500);
    expect(db.rows("accounts").map((row) => row.user_id)).toEqual(["user_a", "user_b"]);
    expect(db.rows("payments")[0].user_id).toBe("user_b");
    expect(db.rows("user_connections").map((row) => row.user_id)).toEqual(["user_a", "user_b"]);
  });

  it("merges on a Steam second proof too", async () => {
    const restore = steamMock(true);
    try {
      const db = fakeD1({
        accounts: [
          account({ user_id: "user_a", username: "alice", email: "alice@example.com" }),
          account({ user_id: "user_b", username: "bob", email: null }),
        ],
        user_connections: [
          connection("user_a", "discord", "discord_a"),
          connection("user_b", "steam", STEAM_ID),
        ],
      });
      const token = await sessionToken("user_a");

      const preview = await worker.fetch(
        previewRequest(token, { callbackUrl: steamCallbackUrl() }),
        env(db),
        executionContext
      );
      expect(preview.status).toBe(200);

      const confirmed = await worker.fetch(
        confirmRequest(token, { callbackUrl: steamCallbackUrl(), confirm: true }),
        env(db),
        executionContext
      );
      expect(confirmed.status).toBe(200);
      expect(db.rows("accounts").map((row) => row.user_id)).toEqual(["user_a"]);
      const providers = db.rows("user_connections").map((row) => row.provider).sort();
      expect(providers).toEqual(["discord", "steam"]);
    } finally {
      restore();
    }
  });

  it("refuses when both accounts hold the same provider type", async () => {
    const db = fakeD1({
      accounts: [
        account({ user_id: "user_a", username: "alice" }),
        account({ user_id: "user_b", username: "bob" }),
      ],
      user_connections: [
        connection("user_a", "discord", "discord_a"),
        connection("user_b", "discord", "discord_b"),
      ],
    });
    const ticket = await discordTicket(db, "discord_b");
    const token = await sessionToken("user_a");

    const preview = await worker.fetch(previewRequest(token, { ticket }), env(db), executionContext);
    expect(preview.status).toBe(409);
    expect(await preview.json<any>()).toMatchObject({
      error: "merge_conflict",
      detail: "both_accounts_hold_discord",
    });
    expect(db.rows("accounts")).toHaveLength(2);
  });

  it("demands a recent session and an explicit confirmation", async () => {
    const db = fakeD1({
      accounts: [
        account({ user_id: "user_a", username: "alice", email: null }),
        account({ user_id: "user_b", username: "bob", email: "bob@example.com" }),
      ],
      user_connections: [
        connection("user_a", "steam", STEAM_ID),
        connection("user_b", "discord", "discord_b"),
      ],
    });
    const ticket = await discordTicket(db, "discord_b");
    const stale = await sessionToken("user_a", 3600, 1, Math.floor(Date.now() / 1000) - 3600);

    const preview = await worker.fetch(previewRequest(stale, { ticket }), env(db), executionContext);
    expect(preview.status).toBe(403);
    expect(await preview.json<any>()).toEqual({ error: "reauth_required" });

    const fresh = await sessionToken("user_a");
    const unconfirmed = await worker.fetch(
      confirmRequest(fresh, { ticket }),
      env(db),
      executionContext
    );
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json<any>()).toEqual({ error: "confirmation_required" });
    expect(db.rows("accounts")).toHaveLength(2);
  });

  it("fails the recover hand-off closed", async () => {
    mock = mockDiscordOAuth();
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("user_1", "discord", DISCORD_USER_ID)],
    });
    const callback = await worker.fetch(
      new Request(
        `https://worker.test/oauth/callback?code=auth_code_1&state=${encodeURIComponent(await oauthState({ purpose: "recover" }))}`,
        { redirect: "manual" }
      ),
      env(db),
      executionContext
    );
    expect(callback.status).toBe(410);
  });
});

describe("DELETE /auth/account", () => {
  it("deletes everything and invalidates the session", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [
        connection("user_1", "discord", DISCORD_USER_ID),
        connection("user_1", "steam", STEAM_ID),
      ],
      discord_links: [
        {
          steam_id: null,
          user_id: "user_1",
          discord_user_id: DISCORD_USER_ID,
          discord_username: "ghost",
          discord_global_name: "Ghost",
          linked_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      security_events: [
        { id: "e1", user_id: "user_1", kind: "login", provider: "discord", ip_prefix: null, created_at: "2026-01-01T00:00:00.000Z" },
      ],
      subscriptions: [{ user_id: "user_1", steam_id: STEAM_ID, status: "expired" }],
      payments: [{ id: "pay_1", user_id: "user_1", steam_id: STEAM_ID, status: "paid" }],
    });
    const token = await sessionToken("user_1");

    const response = await worker.fetch(
      new Request("https://worker.test/auth/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
      env(db),
      executionContext
    );
    expect(response.status).toBe(200);
    expect(db.rows("accounts")).toEqual([]);
    expect(db.rows("user_connections")).toEqual([]);
    expect(db.rows("discord_links")).toEqual([]);
    expect(db.rows("subscriptions")[0]).toMatchObject({ user_id: null, steam_id: null });
    expect(db.rows("payments")[0]).toMatchObject({ user_id: null, steam_id: null });

    const me = await worker.fetch(
      new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${token}` } }),
      env(db),
      executionContext
    );
    expect(me.status).toBe(404);
  });

  it("rolls back every database deletion when the batch fails", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("user_1", "discord", DISCORD_USER_ID)],
      subscriptions: [{ user_id: "user_1", steam_id: null, status: "expired" }],
    });
    const token = await sessionToken("user_1");
    db.failBatchAt(5);

    const response = await worker.fetch(
      new Request("https://worker.test/auth/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
      env(db),
      executionContext
    );

    expect(response.status).toBe(500);
    expect(db.rows("accounts")).toHaveLength(1);
    expect(db.rows("user_connections")).toHaveLength(1);
    expect(db.rows("subscriptions")[0].user_id).toBe("user_1");
  });

  it("keeps the account when its cloud objects cannot be deleted", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("user_1", "discord", DISCORD_USER_ID)],
      cloud_saves: [{ id: "save_1", user_id: "user_1", storage_path: "user_1/game/save.zip" }],
    });
    const token = await sessionToken("user_1");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://worker.test/auth/account", {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        }),
        env(db, {
          SUPABASE_URL: "https://storage.test",
          SUPABASE_SERVICE_ROLE_KEY: "service_key",
        }),
        executionContext
      );

      expect(response.status).toBe(502);
      expect(await response.json<any>()).toEqual({ error: "storage_delete_failed" });
      expect(db.rows("accounts")).toHaveLength(1);
      expect(db.rows("cloud_saves")).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses while a subscription is active, and without confirmation", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("user_1", "discord", DISCORD_USER_ID)],
      subscriptions: [
        {
          user_id: "user_1",
          plan_id: "monthly",
          status: "active",
          current_period_start: "2026-01-01T00:00:00.000Z",
          current_period_end: "2099-01-01T00:00:00.000Z",
          last_payment_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const token = await sessionToken("user_1");
    const request = (body: Record<string, unknown>) =>
      new Request("https://worker.test/auth/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const active = await worker.fetch(request({ confirm: true }), env(db), executionContext);
    expect(active.status).toBe(409);
    expect(await active.json<any>()).toEqual({ error: "subscription_active" });

    const unconfirmed = await worker.fetch(request({}), env(fakeD1({ accounts: [account()] })), executionContext);
    expect(unconfirmed.status).toBe(400);
  });
});
