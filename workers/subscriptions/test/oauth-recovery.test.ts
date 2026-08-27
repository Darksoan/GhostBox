import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256, sha256Hex } from "../src/crypto";
import { fakeD1, type Row } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe } from "./helpers/worker";

const STATE_SECRET = "discord_state_test_secret";
const DISCORD_USER_ID = "discord_1";
const APP_NONCE = "app_nonce_abcdefghij";
const LOOPBACK_PORT = 51234;

function env(db: ReturnType<typeof fakeD1>, overrides: Record<string, unknown> = {}) {
  return makeEnv(db, {
    DISCORD_CLIENT_ID: "client_1",
    DISCORD_CLIENT_SECRET: "client_secret_1",
    DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
    FIREBASE_API_KEY: "firebase_key",
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

function connection(provider: string, providerId: string, overrides: Row = {}): Row {
  return {
    user_id: "user_1",
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

function callbackRequest(state: string) {
  return new Request(
    `https://worker.test/oauth/callback?code=auth_code_1&state=${encodeURIComponent(state)}`,
    { redirect: "manual" }
  );
}

describe("POST /auth/steam/login", () => {
  function steamMock(isValid: boolean) {
    return mockStripe({
      routes: {
        "steamcommunity.com/openid/login": () =>
          new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${isValid}\n`),
      },
    });
  }

  const CALLBACK =
    "http://127.0.0.1:5000/steam/callback?openid.mode=id_res" +
    "&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000001" +
    "&openid.sig=abc";

  function loginRequest(body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/steam/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("signs in the account that linked this Steam", async () => {
    // The stub returns raw text, so mockStripe's JSON wrapper is bypassed by
    // handing back a Response directly.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")) as typeof fetch;

    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("steam", "76561198000000001")],
      });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: CALLBACK }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(200);
      const body = await response.json<any>();
      expect(body.account.userId).toBe("user_1");
      expect(body.steamId).toBe("76561198000000001");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses a callback Steam does not vouch for, whatever the body claims", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n")) as typeof fetch;

    try {
      const db = fakeD1({
        accounts: [account()],
        user_connections: [connection("steam", "76561198000000001")],
      });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: CALLBACK, steamId: "76561198000000001" }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(401);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not create an account for an unknown Steam", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")) as typeof fetch;

    try {
      const db = fakeD1({ accounts: [account()] });
      const response = await worker.fetch(
        loginRequest({ callbackUrl: CALLBACK }),
        env(db),
        executionContext
      );
      expect(response.status).toBe(404);
      expect(await response.json<any>()).toEqual({ error: "steam_not_linked" });
      expect(db.rows("accounts")).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("recovery", () => {
  async function recoveryTicket(db: ReturnType<typeof fakeD1>) {
    mock = mockDiscordOAuth();
    const callback = await worker.fetch(
      callbackRequest(await oauthState({ purpose: "recover" })),
      env(db),
      executionContext
    );
    expect(callback.status).toBe(302);
    return new URL(callback.headers.get("location")!).searchParams.get("ticket")!;
  }

  function exchangeRequest(body: Record<string, unknown>) {
    return new Request("https://worker.test/auth/recover/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses to start a recovery for a provider nobody linked", async () => {
    // Otherwise "I forgot my password" quietly turns into "here is a new
    // account", and the user never learns the recovery failed.
    mock = mockDiscordOAuth();
    const db = fakeD1({ accounts: [account()] });

    const response = await worker.fetch(
      callbackRequest(await oauthState({ purpose: "recover" })),
      env(db),
      executionContext
    );
    expect(response.status).toBe(404);
  });

  it("will not let a recovery ticket be traded for a full session", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("discord", DISCORD_USER_ID)],
    });
    const ticket = await recoveryTicket(db);

    const response = await worker.fetch(
      new Request("https://worker.test/auth/oauth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
      }),
      env(db),
      executionContext
    );
    expect(response.status).toBe(400);
    expect(await response.json<any>()).toEqual({ error: "invalid_ticket" });
  });

  it("issues a session that can only set a password", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("discord", DISCORD_USER_ID)],
    });
    const ticket = await recoveryTicket(db);

    const exchanged = await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext);
    expect(exchanged.status).toBe(200);
    const { token } = await exchanged.json<any>();

    const denied = await worker.fetch(
      new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${token}` } }),
      env(db),
      executionContext
    );
    expect(denied.status).toBe(403);
    expect(await denied.json<any>()).toEqual({ error: "recovery_scope" });
  });

  it("spends the ticket once", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("discord", DISCORD_USER_ID)],
    });
    const ticket = await recoveryTicket(db);

    expect((await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext)).status).toBe(200);
    expect((await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext)).status).toBe(400);
  });

  it("sets the new password and signs every other device out", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("discord", DISCORD_USER_ID)],
    });
    const ticket = await recoveryTicket(db);
    const exchanged = await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext);
    const { token: recoveryToken } = await exchanged.json<any>();

    // A device that was already signed in when the recovery started — the very
    // thing recovery exists to evict.
    const intruder = await (async () => {
      const session = { userId: "user_1", exp: Math.floor(Date.now() / 1000) + 3600, v: 1 };
      const json = new TextEncoder().encode(JSON.stringify(session));
      let binary = "";
      for (const byte of json) binary += String.fromCharCode(byte);
      const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      return `${payload}.${await hmacSha256("cloud_session_test_secret", payload)}`;
    })();

    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("accounts:signInWithCustomToken")) {
        return Response.json({ idToken: "id_1", refreshToken: "refresh_1" });
      }
      if (url.includes("accounts:update")) return Response.json({ localId: "user_1" });
      throw new Error(`unexpected call ${url}`);
    }) as typeof fetch;

    try {
      const recovered = await worker.fetch(
        new Request("https://worker.test/auth/recover/password", {
          method: "POST",
          headers: { authorization: `Bearer ${recoveryToken}`, "content-type": "application/json" },
          body: JSON.stringify({ newPassword: "a-brand-new-password" }),
        }),
        env(db, { FIREBASE_SERVICE_ACCOUNT_KEY: SERVICE_ACCOUNT }),
        executionContext
      );
      expect(recovered.status).toBe(200);
      const body = await recovered.json<any>();
      expect(body.token).toBeTruthy();

      const stale = await worker.fetch(
        new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${intruder}` } }),
        env(db),
        executionContext
      );
      expect(stale.status).toBe(401);

      const fresh = await worker.fetch(
        new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${body.token}` } }),
        env(db),
        executionContext
      );
      expect(fresh.status).toBe(200);

      // And the recovery token itself is spent — it proved the account once.
      const reused = await worker.fetch(
        new Request("https://worker.test/auth/recover/password", {
          method: "POST",
          headers: { authorization: `Bearer ${recoveryToken}`, "content-type": "application/json" },
          body: JSON.stringify({ newPassword: "yet-another-password" }),
        }),
        env(db, { FIREBASE_SERVICE_ACCOUNT_KEY: SERVICE_ACCOUNT }),
        executionContext
      );
      expect(reused.status).toBe(401);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("Discord PIN recovery", () => {
  function discordLinkRow(): Row {
    return {
      user_id: "user_1",
      discord_user_id: DISCORD_USER_ID,
      discord_username: "ghost",
      discord_global_name: "Ghost",
      discord_email: "ghost@example.com",
      discord_email_verified: 1,
      linked_at: "2026-01-01T00:00:00.000Z",
    };
  }

  /** Captures the bot DM so the test can read the PIN the worker minted. Any
   * fetch outside the DM handshake throws, which is how the no-DM assertions
   * below stay honest. */
  function captureDiscordDm() {
    const original = globalThis.fetch;
    let content = "";
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("users/@me/channels")) {
        return new Response(JSON.stringify({ id: "dm_channel_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/messages")) {
        content = JSON.parse(init.body).content;
        return new Response(JSON.stringify({ id: "dm_message_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected call ${url}`);
    }) as typeof fetch;
    return {
      get code() {
        const match = content.match(/\b(\d{6})\b/);
        return match ? match[1] : "";
      },
      restore() {
        globalThis.fetch = original;
      },
    };
  }

  function recoverStartRequest(identifier: string) {
    return new Request("https://worker.test/auth/recover/discord/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
  }

  function recoverConfirmRequest(identifier: string, code: string) {
    return new Request("https://worker.test/auth/recover/discord/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, code }),
    });
  }

  it("DMs a PIN and trades it for a recovery-scoped session", async () => {
    const dm = captureDiscordDm();
    try {
      const db = fakeD1({
        accounts: [account()],
        discord_links: [discordLinkRow()],
      });

      const start = await worker.fetch(
        recoverStartRequest("ghost"),
        env(db, { DISCORD_BOT_TOKEN: "bot_1" }),
        executionContext
      );
      expect(start.status).toBe(200);
      expect(await start.json<any>()).toEqual({ ok: true });

      const confirmed = await worker.fetch(
        recoverConfirmRequest("ghost@example.com", dm.code),
        env(db),
        executionContext
      );
      expect(confirmed.status).toBe(200);
      const { token } = await confirmed.json<any>();

      // Same narrow scope as the provider hand-off: it can do one thing.
      const denied = await worker.fetch(
        new Request("https://worker.test/auth/me", { headers: { authorization: `Bearer ${token}` } }),
        env(db),
        executionContext
      );
      expect(denied.status).toBe(403);
      expect(await denied.json<any>()).toEqual({ error: "recovery_scope" });
    } finally {
      dm.restore();
    }
  });

  it("answers ok even when nothing answers the identifier — no oracle", async () => {
    const dm = captureDiscordDm();
    try {
      const db = fakeD1({ accounts: [account()] });

      const response = await worker.fetch(
        recoverStartRequest("ghost"),
        env(db, { DISCORD_BOT_TOKEN: "bot_1" }),
        executionContext
      );
      expect(response.status).toBe(200);
      expect(await response.json<any>()).toEqual({ ok: true });
      // The account exists but has no Discord linked: no code, no DM — and no
      // signal in the response that anything was different.
      expect(db.rows("discord_verification_codes")).toHaveLength(0);
    } finally {
      dm.restore();
    }
  });

  it("reads a wrong PIN and an unknown identifier exactly the same", async () => {
    const dm = captureDiscordDm();
    try {
      const db = fakeD1({
        accounts: [account()],
        discord_links: [discordLinkRow()],
      });

      await worker.fetch(
        recoverStartRequest("ghost"),
        env(db, { DISCORD_BOT_TOKEN: "bot_1" }),
        executionContext
      );

      const wrong = await worker.fetch(
        recoverConfirmRequest("ghost@example.com", "000000"),
        env(db),
        executionContext
      );
      expect(wrong.status).toBe(400);
      expect(await wrong.json<any>()).toEqual({ error: "invalid_code" });

      const unknown = await worker.fetch(
        recoverConfirmRequest("nobody@nowhere.io", "000000"),
        env(db),
        executionContext
      );
      expect(unknown.status).toBe(400);
      expect(await unknown.json<any>()).toEqual({ error: "invalid_code" });

      // The wrong attempt counted against the code, and the code is still the
      // only one pending for the account.
      expect(db.rows("discord_verification_codes")).toHaveLength(1);
      expect(db.rows("discord_verification_codes")[0].attempts).toBe(1);
    } finally {
      dm.restore();
    }
  });
});

/** A throwaway RSA key. Only `mintFirebaseCustomToken` touches it, and the
 * stubbed Firebase never checks the signature — it exists so the import and
 * sign calls run for real rather than being mocked away. */
const SERVICE_ACCOUNT = JSON.stringify({
  client_email: "worker@ghostbox.iam.gserviceaccount.com",
  private_key: await generateTestPrivateKey(),
});

async function generateTestPrivateKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const exported = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of exported) binary += String.fromCharCode(byte);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
}
