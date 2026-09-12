import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256, sha256Hex } from "../src/crypto";
import { fakeD1, type Row } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

const STATE_SECRET = "discord_state_test_secret";
const DISCORD_USER_ID = "discord_1";
const LOOPBACK_PORT = 51234;
const APP_NONCE = "app_nonce_abcdefghij";

function discordEnv(db: ReturnType<typeof fakeD1>, overrides: Record<string, unknown> = {}) {
  return makeEnv(db, {
    DISCORD_CLIENT_ID: "client_1",
    DISCORD_CLIENT_SECRET: "client_secret_1",
    DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
    DISCORD_BOT_TOKEN: "bot_token_1",
    ...overrides,
  });
}

/** Mirrors createDiscordState:
 * `purpose.provider.userId.port.appNonce.expiresAt.nonce.signature`. */
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

function loginState(port: number | string = LOOPBACK_PORT) {
  return oauthState({ port });
}

/** The shape `/auth/discord/start` still mints for app builds that predate the
 * loopback binding: no app nonce at all. */
function legacyLoginState(port: number | string = LOOPBACK_PORT) {
  return oauthState({ port, appNonce: "" });
}

function mockDiscordOAuth(user: Record<string, unknown> = {}) {
  return mockStripe({
    routes: {
      "oauth2/token": { access_token: "discord_access_token", token_type: "Bearer" },
      "users/@me": {
        id: DISCORD_USER_ID,
        username: "ghost",
        global_name: "Ghost",
        avatar: "avatar_hash_1",
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
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function discordConnection(overrides: Row = {}): Row {
  return {
    user_id: "user_1",
    provider: "discord",
    provider_id: DISCORD_USER_ID,
    metadata_json: JSON.stringify({ username: "ghost", email: "ghost@example.com", emailVerified: true }),
    linked_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Runs the login callback and returns the ticket it bounced to the loopback. */
async function loginCallbackTicket(db: ReturnType<typeof fakeD1>, state?: string) {
  state = state ?? (await loginState());
  const response = await worker.fetch(
    new Request(`https://worker.test/discord/callback?code=auth_code_1&state=${encodeURIComponent(state)}`, {
      redirect: "manual",
    }),
    discordEnv(db),
    executionContext
  );
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(location.host).toBe(`127.0.0.1:${LOOPBACK_PORT}`);
  return location.searchParams.get("ticket")!;
}

function exchangeRequest(ticket: string) {
  return new Request("https://worker.test/auth/discord/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
}

let discord: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  discord?.restore();
  discord = null;
});

describe("GET /auth/discord/start", () => {
  it("refuses a port that is not a real loopback port", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/auth/discord/start?port=notaport"),
      discordEnv(fakeD1()),
      executionContext
    );
    expect(response.status).toBe(400);
  });

  it("asks Discord for the email scope so a link can verify the address", async () => {
    const response = await worker.fetch(
      new Request(`https://worker.test/auth/discord/start?port=${LOOPBACK_PORT}`),
      discordEnv(fakeD1()),
      executionContext
    );
    const { url } = await response.json<{ url: string }>();
    expect(new URL(url).searchParams.get("scope")).toBe("identify email");
  });

  it("still signs in an app build that predates the loopback nonce", async () => {
    // The legacy state carries no app nonce. Rejecting it would lock every
    // already-installed build out of Discord sign-in on deploy; it is no more
    // exposed than it was, and `/auth/oauth/*` refuses to mint an unbound
    // state for anything new.
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db, await legacyLoginState());
    const response = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);
    expect(response.status).toBe(200);
  });
});

describe("POST /auth/discord/exchange", () => {
  it("signs in the account that owns the Discord connection", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body.token).toBeTruthy();
    expect(body.account.userId).toBe("user_1");
    // The Discord address matches the one on file and Discord says it is
    // verified, so the account is confirmed without any email being sent.
    expect(body.account.emailVerified).toBe(true);
    expect(body.account.verifiedVia).toBe("email");
    expect(JSON.parse(db.rows("user_connections")[0].metadata_json)).toMatchObject({
      username: "ghost",
      globalName: "Ghost",
      avatarUrl: `https://cdn.discordapp.com/avatars/${DISCORD_USER_ID}/avatar_hash_1.png?size=256`,
    });

    const me = await worker
      .fetch(
        new Request("https://worker.test/auth/me", {
          headers: { authorization: `Bearer ${body.token}` },
        }),
        discordEnv(db),
        executionContext,
      )
      .then((meResponse) => meResponse.json<any>());
    expect(me.connections[0].metadata.avatarUrl).toBe(
      `https://cdn.discordapp.com/avatars/${DISCORD_USER_ID}/avatar_hash_1.png?size=256`,
    );
  });

  it("does not confirm the email when Discord holds a different address", async () => {
    discord = mockDiscordOAuth({ email: "other@example.com" });
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    const body = await worker
      .fetch(exchangeRequest(ticket), discordEnv(db), executionContext)
      .then((response) => response.json<any>());

    expect(body.account.emailVerified).toBe(false);
    expect(body.account.verifiedVia).toBe(null);
  });

  it("rejects a ticket that was already spent", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);
    const replay = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);

    expect(replay.status).toBe(400);
    expect(await replay.json<any>()).toEqual({ error: "invalid_ticket" });
  });

  it("rejects a ticket past its expiry", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    db.rows("discord_login_tickets")[0].expires_at = new Date(Date.now() - 1000).toISOString();

    const response = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);
    expect(response.status).toBe(400);
  });

  it("refuses to sign in a Discord nobody linked: accounts are born from email + password", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1();

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);

    expect(response.status).toBe(404);
    expect(await response.json<any>()).toEqual({ error: "provider_not_linked" });
    // Still unspent: the ticket is not a signup coupon, but it stays valid so
    // the same authorization can link the account later from Settings.
    expect(db.rows("discord_login_tickets")[0].consumed_at).toBe(null);
  });
});

describe("POST /auth/discord/register", () => {
  it("is gone: signing up through a provider is not a thing anymore", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/auth/discord/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: "whatever", username: "ghostuser", password: "hunter2hunter2" }),
      }),
      discordEnv(fakeD1()),
      executionContext
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /auth/login verification sync", () => {
  function loginRequest() {
    return new Request("https://worker.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "ghost@example.com", password: "hunter2hunter2" }),
    });
  }

  function firebaseLogin(emailVerified: boolean) {
    return mockStripe({
      routes: {
        "accounts:signInWithPassword": {
          localId: "user_1",
          idToken: "id_1",
          refreshToken: "refresh_1",
          email: "ghost@example.com",
        },
        "accounts:lookup": { users: [{ localId: "user_1", emailVerified }] },
      },
    });
  }

  it("does not strip a verification Firebase never knew about", async () => {
    // GhostBox stopped sending Firebase verification emails, so Firebase says
    // `false` for every account forever — including ones this app verified by
    // matching a Discord address Discord had already verified. Writing that
    // false back silently un-verified the account on the next sign-in.
    const db = fakeD1({ accounts: [account({ email_verified: 1, verified_via: "email" })] });
    const firebase = firebaseLogin(false);

    try {
      const body = await worker
        .fetch(loginRequest(), discordEnv(db, { FIREBASE_API_KEY: "k" }), executionContext)
        .then((response) => response.json<any>());

      expect(body.account.emailVerified).toBe(true);
      expect(body.account.verifiedVia).toBe("email");
    } finally {
      firebase.restore();
    }
  });

  it("leaves a Discord proof intact across sign-ins", async () => {
    const db = fakeD1({ accounts: [account({ email_verified: 0, verified_via: "discord" })] });
    const firebase = firebaseLogin(false);

    try {
      const body = await worker
        .fetch(loginRequest(), discordEnv(db, { FIREBASE_API_KEY: "k" }), executionContext)
        .then((response) => response.json<any>());

      expect(body.account.verifiedVia).toBe("discord");
    } finally {
      firebase.restore();
    }
  });

  it("still adopts a verification Firebase does report", async () => {
    const db = fakeD1({ accounts: [account({ email_verified: 0, verified_via: null })] });
    const firebase = firebaseLogin(true);

    try {
      const body = await worker
        .fetch(loginRequest(), discordEnv(db, { FIREBASE_API_KEY: "k" }), executionContext)
        .then((response) => response.json<any>());

      expect(body.account.emailVerified).toBe(true);
      expect(body.account.verifiedVia).toBe("email");
    } finally {
      firebase.restore();
    }
  });
});

describe("moving a Discord between accounts", () => {
  async function linkState(overrides: { fromVerifiedVia: string | null; fromEmailVerified?: number }) {
    return fakeD1({
      accounts: [
        account({
          user_id: "user_old",
          username: "old",
          email: "old@example.com",
          email_verified: overrides.fromEmailVerified ?? 0,
          verified_via: overrides.fromVerifiedVia,
        }),
        account({ user_id: "user_new", username: "new", email: "new@example.com" }),
      ],
      user_connections: [discordConnection({ user_id: "user_old" })],
      discord_links: [
        {
          steam_id: null,
          user_id: "user_old",
          discord_user_id: DISCORD_USER_ID,
          discord_username: "ghost",
          discord_global_name: "Ghost",
          linked_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  }

  async function linkCallback(db: ReturnType<typeof fakeD1>, userId: string) {
    const state = await oauthState({ purpose: "link", userId, port: "", appNonce: "" });
    return worker.fetch(
      new Request(`https://worker.test/discord/callback?code=auth_code_1&state=${encodeURIComponent(state)}`),
      discordEnv(db),
      executionContext
    );
  }

  it("revokes the Discord proof from the account that lost the link", async () => {
    // Otherwise one Discord stamps every account it ever touched as verified:
    // link, verify, move on, verify again — account farming with a single
    // Discord, which is exactly what the check is meant to prevent.
    discord = mockDiscordOAuth({ email: "unrelated@example.com" });
    const db = await linkState({ fromVerifiedVia: "discord" });

    await linkCallback(db, "user_new");

    const previous = db.rows("accounts").find((row) => row.user_id === "user_old");
    expect(previous?.verified_via).toBe(null);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ user_id: "user_new", provider: "discord" }),
    ]);
  });

  it("leaves an email proof alone — the address did not move", async () => {
    discord = mockDiscordOAuth({ email: "unrelated@example.com" });
    const db = await linkState({ fromVerifiedVia: "email", fromEmailVerified: 1 });

    await linkCallback(db, "user_new");

    const previous = db.rows("accounts").find((row) => row.user_id === "user_old");
    expect(previous?.verified_via).toBe("email");
    expect(previous?.email_verified).toBe(1);
  });
});

describe("Discord DM verification code", () => {
  function sendRequest(token: string) {
    return new Request("https://worker.test/auth/discord/send-code", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  function confirmRequest(token: string, code: string) {
    return new Request("https://worker.test/auth/discord/confirm-code", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
  }

  function linkedDb(accountOverrides: Row = {}, connectionOverrides: Row = {}) {
    return fakeD1({
      accounts: [account(accountOverrides)],
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
      user_connections: [discordConnection(connectionOverrides)],
    });
  }

  /** Recovers the plaintext PIN the handler DM'd, by brute-forcing the hash
   * against the stored row — the test never sees the code otherwise. */
  async function storedCode(db: ReturnType<typeof fakeD1>, dmBody: string) {
    const match = dmBody.match(/\*\*(\d{6})\*\*/);
    expect(match).not.toBe(null);
    const code = match![1];
    expect(db.rows("discord_verification_codes")[0].code_hash).toBe(await sha256Hex(`user_1:${code}`));
    return code;
  }

  function mockDiscordDm(options: { status?: number } = {}) {
    const bodies: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("users/@me/channels")) {
        return new Response(JSON.stringify({ id: "dm_channel_1" }), { status: options.status ?? 200 });
      }
      if (url.includes("/messages")) {
        bodies.push(JSON.parse(init.body).content);
        return new Response(JSON.stringify({ id: "message_1" }), { status: options.status ?? 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { bodies, restore: () => (globalThis.fetch = original) };
  }

  it("marks the account verified via Discord without touching the email flag", async () => {
    // Account email and Discord email differ, which is exactly the case the
    // PIN exists for: the person is real, the address is still unconfirmed.
    const db = linkedDb({ email: "other@example.com" });
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm();

    try {
      const sent = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      expect(sent.status).toBe(200);

      const code = await storedCode(db, dm.bodies[0]);
      const response = await worker.fetch(confirmRequest(token, code), discordEnv(db), executionContext);

      expect(response.status).toBe(200);
      const body = await response.json<any>();
      expect(body.account.verifiedVia).toBe("discord");
      expect(body.account.emailVerified).toBe(false);
      expect(db.rows("discord_verification_codes")).toEqual([]);
    } finally {
      dm.restore();
    }
  });

  it("confirms the email too when Discord holds that same address", async () => {
    const db = linkedDb();
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm();

    try {
      await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      const code = await storedCode(db, dm.bodies[0]);
      const body = await worker
        .fetch(confirmRequest(token, code), discordEnv(db), executionContext)
        .then((response) => response.json<any>());

      expect(body.account.emailVerified).toBe(true);
      expect(body.account.verifiedVia).toBe("email");
    } finally {
      dm.restore();
    }
  });

  it("locks the code after five wrong guesses", async () => {
    const db = linkedDb();
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm();

    try {
      await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      const real = await storedCode(db, dm.bodies[0]);
      const wrong = real === "000000" ? "111111" : "000000";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await worker.fetch(confirmRequest(token, wrong), discordEnv(db), executionContext);
        expect(response.status).toBe(401);
      }

      // Even the correct code is refused once the budget is gone.
      const locked = await worker.fetch(confirmRequest(token, real), discordEnv(db), executionContext);
      expect(locked.status).toBe(429);
      expect(db.rows("discord_verification_codes")).toEqual([]);
    } finally {
      dm.restore();
    }
  });

  it("rejects an expired code", async () => {
    const db = linkedDb();
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm();

    try {
      await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      const code = await storedCode(db, dm.bodies[0]);
      db.rows("discord_verification_codes")[0].expires_at = new Date(Date.now() - 1000).toISOString();

      const response = await worker.fetch(confirmRequest(token, code), discordEnv(db), executionContext);
      expect(response.status).toBe(410);
      expect(await response.json<any>()).toEqual({ error: "code_expired" });
    } finally {
      dm.restore();
    }
  });

  it("reports blocked DMs distinctly and leaves no dangling code", async () => {
    const db = linkedDb();
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm({ status: 403 });

    try {
      const response = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      expect(response.status).toBe(409);
      expect(await response.json<any>()).toEqual({ error: "discord_dm_blocked" });
      expect(db.rows("discord_verification_codes")).toEqual([]);
    } finally {
      dm.restore();
    }
  });

  it("does not spend the delivered-code budget on a blocked DM", async () => {
    // The user closes DMs, hits the error, fixes the setting, retries. Charging
    // the strict budget for the failures locked them out for an hour right at
    // the moment they had made it work.
    const db = linkedDb();
    const token = await sessionToken("user_1");

    const blocked = mockDiscordDm({ status: 403 });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
        expect(response.status).toBe(409);
      }
    } finally {
      blocked.restore();
    }

    const dm = mockDiscordDm();
    try {
      const response = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      expect(response.status).toBe(200);
      expect(dm.bodies).toHaveLength(1);
    } finally {
      dm.restore();
    }
  });

  it("still caps delivered codes per hour", async () => {
    const db = linkedDb();
    const token = await sessionToken("user_1");
    const dm = mockDiscordDm();

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
        expect(response.status).toBe(200);
      }

      const blockedBySpamLimit = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
      expect(blockedBySpamLimit.status).toBe(429);
      expect(dm.bodies).toHaveLength(5);
    } finally {
      dm.restore();
    }
  });

  it("refuses to send when no Discord is linked", async () => {
    const db = fakeD1({ accounts: [account()] });
    const token = await sessionToken("user_1");

    const response = await worker.fetch(sendRequest(token), discordEnv(db), executionContext);
    expect(response.status).toBe(409);
    expect(await response.json<any>()).toEqual({ error: "discord_not_linked" });
  });
});
