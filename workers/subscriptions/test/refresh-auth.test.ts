import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

const SESSION_ID = "cs_test_1";
const SUBSCRIPTION_ID = "sub_test_1";
// Far enough out that publicSubscription still reports the subscription as
// active whenever the suite happens to run.
const PERIOD_END = 4_070_908_800; // 2099-01-01T00:00:00Z

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    checkout_reference: "ghostbox-user_1-monthly-pay_1",
    checkout_id: SESSION_ID,
    stripe_checkout_session_id: SESSION_ID,
    steam_id: null,
    user_id: "user_1",
    plan_id: "monthly",
    amount_cents: 699,
    currency: "BRL",
    status: "pending",
    hosted_checkout_url: "https://checkout.stripe.com/c/pay/cs_test_1",
    stripe_subscription_id: null,
    provider: "stripe",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    confirmed_at: null,
    ...overrides,
  };
}

function refreshRequest(token?: string) {
  return new Request(`https://worker.test/subscription/refresh?checkoutId=${SESSION_ID}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

let stripe: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe("POST /subscription/refresh", () => {
  it("rejects an unauthenticated caller", async () => {
    // Previously this endpoint was open: a checkout id was enough to read back
    // the owner's userId, steamId, Stripe ids and hosted checkout URL.
    const db = fakeD1({ payments: [payment()] });
    const response = await worker.fetch(refreshRequest(), makeEnv(db), executionContext);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects an expired session token", async () => {
    const db = fakeD1({ payments: [payment()] });
    const token = await sessionToken("user_1", -60);
    const response = await worker.fetch(refreshRequest(token), makeEnv(db), executionContext);

    expect(response.status).toBe(401);
  });

  it("hides another account's payment behind a 404", async () => {
    const db = fakeD1({
      accounts: [{ user_id: "user_2", token_version: 1 }],
      payments: [payment()],
    });
    const token = await sessionToken("user_2");
    const response = await worker.fetch(refreshRequest(token), makeEnv(db), executionContext);

    expect(response.status).toBe(404);
    // A 403 would confirm the checkout id exists.
    expect(await response.json()).toEqual({ error: "Payment not found" });
  });

  it("confirms the payment for its owner", async () => {
    stripe = mockStripe({
      routes: {
        "/checkout/sessions/": {
          id: SESSION_ID,
          payment_status: "paid",
          customer: "cus_test_1",
          subscription: SUBSCRIPTION_ID,
        },
        "/subscriptions/": {
          id: SUBSCRIPTION_ID,
          status: "active",
          customer: "cus_test_1",
          items: { data: [{ current_period_end: PERIOD_END }] },
        },
      },
    });
    const db = fakeD1({ payments: [payment()] });
    const token = await sessionToken("user_1");

    const response = await worker.fetch(refreshRequest(token), makeEnv(db), executionContext);
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.payment.status).toBe("paid");
    expect(body.subscription).toMatchObject({
      status: "active",
      isPremium: true,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    });
  });

  it("reports an unresolvable period instead of storing a dead subscription", async () => {
    stripe = mockStripe({
      routes: {
        "/checkout/sessions/": {
          id: SESSION_ID,
          payment_status: "paid",
          customer: "cus_test_1",
          subscription: SUBSCRIPTION_ID,
        },
        "/subscriptions/": { id: SUBSCRIPTION_ID, status: "active", customer: "cus_test_1" },
      },
    });
    const db = fakeD1({ payments: [payment()] });
    const token = await sessionToken("user_1");

    const response = await worker.fetch(refreshRequest(token), makeEnv(db), executionContext);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "stripe_period_unresolved" });
    expect(db.rows("subscriptions")).toHaveLength(0);
  });
});
