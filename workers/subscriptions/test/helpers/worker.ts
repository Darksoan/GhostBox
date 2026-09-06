import { hmacSha256, hmacSha256Hex } from "../../src/crypto";
import type { FakeD1 } from "./fake-d1";

export const WEBHOOK_SECRET = "whsec_test_secret";
export const SESSION_SECRET = "cloud_session_test_secret";

export function makeEnv(db: FakeD1, overrides: Record<string, unknown> = {}) {
  return {
    SUBSCRIPTION_DB: db,
    STRIPE_SECRET_KEY: "sk_test_key",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CLOUD_SESSION_SECRET: SESSION_SECRET,
    ALLOWED_ORIGIN: "*",
    ...overrides,
  } as any;
}

export const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

export async function stripeWebhookRequest(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}.${payload}`);
  return new Request("https://worker.test/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signature}`,
      "content-type": "application/json",
    },
    body: payload,
  });
}

/**
 * Mints the worker's own session token (payload.signature, HMAC-SHA256).
 *
 * `version` is left off by default on purpose: that is exactly the shape of a
 * token minted before migration 0016, and those must keep working.
 */
export async function sessionToken(userId: string, expiresInSeconds = 3600, version?: number) {
  const session = {
    userId,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    ...(version === undefined ? {} : { v: version }),
  };
  const json = new TextEncoder().encode(JSON.stringify(session));
  let binary = "";
  for (const byte of json) binary += String.fromCharCode(byte);
  const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payload}.${await hmacSha256(SESSION_SECRET, payload)}`;
}

type StripeRoute = (path: string) => unknown | Promise<unknown>;

/**
 * Replaces global fetch with a Stripe stub. `routes` maps a path fragment to
 * the JSON body; `fail` makes every call reject, which is how the tests
 * simulate Stripe being unreachable mid-webhook. Route functions may return a
 * promise, which lets concurrency tests hold Stripe open with a deferred.
 */
export function mockStripe(options: { routes?: Record<string, unknown>; fail?: boolean } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (options.fail) throw new Error("stripe unreachable");

    for (const [fragment, body] of Object.entries(options.routes ?? {})) {
      if (url.includes(fragment)) {
        const resolved = typeof body === "function" ? await (body as StripeRoute)(url) : body;
        return new Response(JSON.stringify(resolved), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: { message: `unexpected stripe call ${url}` } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
