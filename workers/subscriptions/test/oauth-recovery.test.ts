import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256, sha256Hex } from "../src/crypto";
import { fakeD1, type Row } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe } from "./helpers/worker";

const STATE_SECRET = "discord_state_test_secret";
const GOOGLE_CLIENT_ID = "google_client_1";
const APP_NONCE = "app_nonce_abcdefghij";
const LOOPBACK_PORT = 51234;

function env(db: ReturnType<typeof fakeD1>, overrides: Record<string, unknown> = {}) {
  return makeEnv(db, {
    DISCORD_CLIENT_ID: "client_1",
    DISCORD_CLIENT_SECRET: "client_secret_1",
    DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: "google_secret_1",
    FIREBASE_API_KEY: "firebase_key",
    ...overrides,
  });
}

async function oauthState(options: {
  purpose?: "login" | "recover" | "link";
  provider?: "discord" | "google";
  userId?: string;
  port?: number | string;
  appNonce?: string;
} = {}) {
  const payload = [
    options.purpose ?? "login",
    options.provider ?? "google",
    options.userId ?? "",
    options.port ?? LOOPBACK_PORT,
    options.appNonce ?? APP_NONCE,
    Math.floor(Date.now() / 1000) + 600,
    "nonce_1",
  ].join(".");
  return `${payload}.${await hmacSha256(STATE_SECRET, payload)}`;
}

/** A Google id_token is read, not verified — see googleIdentityFromIdToken. So
 * the tests only need a well-formed unsigned payload segment. */
function idToken(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    sub: "google_sub_1",
    email: "ghost@example.com",
    email_verified: true,
    name: "Ghost",
    ...overrides,
  };
}

function mockGoogle(claims: Record<string, unknown> = googleClaims()) {
  return mockStripe({ routes: { "oauth2.googleapis.com/token": { id_token: idToken(claims) } } });
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

describe("Google OAuth", () => {
  it("signs in the account that owns the Google connection", async () => {
    mock = mockGoogle();
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("google", "google_sub_1")],
    });

    const callback = await worker.fetch(callbackRequest(await oauthState()), env(db), executionContext);
    expect(callback.status).toBe(302);

    const location = new URL(callback.headers.get("location")!);
    expect(location.port).toBe(String(LOOPBACK_PORT));
    expect(location.pathname).toBe("/oauth/callback");
    // The app's own nonce comes back, which is what lets its loopback listener
    // tell this callback apart from a ticket injected by another local process.
    expect(location.searchParams.get("state")).toBe(APP_NONCE);

    const ticket = location.searchParams.get("ticket")!;
    const exchange = await worker.fetch(
      new Request("https://worker.test/auth/oauth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
      }),
      env(db),
      executionContext
    );
    expect(exchange.status).toBe(200);
    const body = await exchange.json<any>();
    expect(body.account.userId).toBe("user_1");
    // Google vouched for the very address on file, so no email was ever sent
    // and the account is verified anyway.
    expect(body.account.emailVerified).toBe(true);
  });

  it("rejects an id_token minted for a different client", async () => {
    mock = mockGoogle(googleClaims({ aud: "someone_elses_client" }));
    const db = fakeD1({ accounts: [account()] });

    const response = await worker.fetch(callbackRequest(await oauthState()), env(db), executionContext);
    expect(response.status).toBe(502);
  });

  it("rejects an id_token that does not come from Google", async () => {
    mock = mockGoogle(googleClaims({ iss: "https://accounts.evil.example" }));
    const db = fakeD1({ accounts: [account()] });

    const response = await worker.fetch(callbackRequest(await oauthState()), env(db), executionContext);
    expect(response.status).toBe(502);
  });

  it("does not confirm the email when Google says it is unverified", async () => {
    mock = mockGoogle(googleClaims({ email_verified: false }));
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("google", "google_sub_1")],
    });

    const callback = await worker.fetch(callbackRequest(await oauthState()), env(db), executionContext);
    const ticket = new URL(callback.headers.get("location")!).searchParams.get("ticket")!;

    const exchange = await worker.fetch(
      new Request("https://worker.test/auth/oauth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
      }),
      env(db),
      executionContext
    );
    expect((await exchange.json<any>()).account.emailVerified).toBe(false);
  });
});

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
    mock = mockGoogle();
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
    mock = mockGoogle();
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
      user_connections: [connection("google", "google_sub_1")],
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
      user_connections: [connection("google", "google_sub_1")],
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
      user_connections: [connection("google", "google_sub_1")],
    });
    const ticket = await recoveryTicket(db);

    expect((await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext)).status).toBe(200);
    expect((await worker.fetch(exchangeRequest({ ticket }), env(db), executionContext)).status).toBe(400);
  });

  it("sets the new password and signs every other device out", async () => {
    const db = fakeD1({
      accounts: [account()],
      user_connections: [connection("google", "google_sub_1")],
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
