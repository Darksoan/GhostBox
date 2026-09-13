import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256 } from "../src/crypto";
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
    expect(body.account.username).toBe("ghost");
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

  it("leaves the ticket unspent when the provider still needs a signup", async () => {
    discord = mockDiscordOAuth({ email: "other@example.com" });
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    const first = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);
    expect(first.status).toBe(200);

    // Same ticket twice: the atomic consume lets exactly one exchange through.
    const replay = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);
    expect(replay.status).toBe(400);
    expect(await replay.json<any>()).toEqual({ error: "invalid_ticket" });
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

  it("answers signup_required for a Discord nobody linked, without spending the ticket", async () => {
    // Discord creates accounts directly now: the exchange points the app at
    // the signup confirmation instead of signing in.
    discord = mockDiscordOAuth();
    const db = fakeD1();

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(exchangeRequest(ticket), discordEnv(db), executionContext);

    expect(response.status).toBe(404);
    const body = await response.json<any>();
    expect(body.error).toBe("signup_required");
    expect(body.provider).toBe("discord");
    expect(body.providerId).toBe(DISCORD_USER_ID);
    expect(body.suggestedUsername).toBe("ghost");
    expect(body.disclaimer).toMatch(/Discord ou pela Steam/);
    // Still unspent: the follow-up signup consumes this very ticket.
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

describe("POST /auth/oauth/signup", () => {
  function signupRequest(body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/oauth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates the account, links Discord, and signs straight in", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1();

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(
      signupRequest({ ticket, username: "ghost", displayName: "Ghost", acceptTerms: true }),
      discordEnv(db),
      executionContext
    );

    expect(response.status).toBe(201);
    const body = await response.json<any>();
    expect(body.isNewAccount).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.account.username).toBe("ghost");
    expect(body.account.email).toBe("ghost@example.com");
    expect(body.disclaimer).toMatch(/Discord ou pela Steam/);
    expect(db.rows("accounts")).toHaveLength(1);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ provider: "discord", provider_id: DISCORD_USER_ID }),
    ]);
    expect(db.rows("discord_links")).toEqual([
      expect.objectContaining({ discord_user_id: DISCORD_USER_ID }),
    ]);

    // The ticket is spent: no second account comes out of it.
    const replay = await worker.fetch(
      signupRequest({ ticket, username: "ghost2", acceptTerms: true }),
      discordEnv(db),
      executionContext
    );
    expect(replay.status).toBe(400);
    expect(db.rows("accounts")).toHaveLength(1);
  });

  it("requires the terms acceptance", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1();

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(
      signupRequest({ ticket, username: "ghost" }),
      discordEnv(db),
      executionContext
    );

    expect(response.status).toBe(400);
    expect(await response.json<any>()).toEqual({ error: "terms_required" });
    expect(db.rows("accounts")).toHaveLength(0);
  });

  it("rejects a username that is already taken", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()] });

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(
      signupRequest({ ticket, username: "ghost", acceptTerms: true }),
      discordEnv(db),
      executionContext
    );

    expect(response.status).toBe(409);
    expect(await response.json<any>()).toEqual({ error: "username_taken" });
  });

  it("refuses a Discord that is already attached to another account", async () => {
    // A ticket that resolves to an existing account is a login, not a
    // signup: it cannot open a second account for the same Discord.
    discord = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });

    const ticket = await loginCallbackTicket(db);
    const response = await worker.fetch(
      signupRequest({ ticket, username: "someone_else", acceptTerms: true }),
      discordEnv(db),
      executionContext
    );

    expect(response.status).toBe(409);
    expect(await response.json<any>()).toEqual({ error: "provider_already_linked" });
    expect(db.rows("accounts")).toHaveLength(1);
  });
});

describe("linking a Discord that belongs to another account", () => {
  async function linkState() {
    return fakeD1({
      accounts: [
        account({
          user_id: "user_old",
          username: "old",
          email: "old@example.com",
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

  it("refuses the link instead of moving it — uniting accounts is the merge flow", async () => {
    // Silently moving the Discord was a takeover vector. The link stays where
    // it is; the confirmed merge flow is the only way to unite two accounts.
    discord = mockDiscordOAuth({ email: "unrelated@example.com" });
    const db = await linkState();

    const response = await linkCallback(db, "user_new");

    expect(response.status).toBe(409);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ user_id: "user_old", provider: "discord" }),
    ]);
  });
});

describe("retired email-verification endpoints", () => {
  it("answers 410: there is no email to verify anymore", async () => {
    const db = fakeD1({ accounts: [account()], user_connections: [discordConnection()] });
    const token = await sessionToken("user_1");
    const env = discordEnv(db);

    for (const path of ["/auth/discord/send-code", "/auth/discord/confirm-code"]) {
      const response = await worker.fetch(
        new Request(`https://worker.test${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ code: "123456" }),
        }),
        env,
        executionContext
      );
      expect(response.status).toBe(410);
      expect(await response.json<any>()).toMatchObject({ error: "password_auth_removed" });
    }
  });
});
