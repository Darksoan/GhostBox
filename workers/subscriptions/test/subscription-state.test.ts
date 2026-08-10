import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    steam_id: null,
    user_id: "user_1",
    plan_id: "monthly",
    status: "active",
    current_period_start: "2025-01-01T00:00:00.000Z",
    current_period_end: FUTURE,
    last_payment_id: null,
    stripe_customer_id: "cus_test_1",
    stripe_subscription_id: "sub_test_1",
    stripe_subscription_status: "active",
    cancel_at_period_end: 0,
    stripe_event_created: 1,
    stripe_payment_method_json: null,
    stripe_payment_method_updated_at: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function status(db: ReturnType<typeof fakeD1>, userId = "user_1") {
  const token = await sessionToken(userId);
  const response = await worker.fetch(
    new Request("https://worker.test/subscription/status", {
      headers: { authorization: `Bearer ${token}` },
    }),
    makeEnv(db),
    executionContext
  );
  return { response, body: await response.json<any>() };
}

let stripe: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe("GET /subscription/status", () => {
  it("reports a subscription with a future period as premium", async () => {
    stripe = mockStripe({
      routes: {
        "/subscriptions/": { id: "sub_test_1", default_payment_method: null },
        "/customers/": { invoice_settings: { default_payment_method: null } },
      },
    });
    const db = fakeD1({ subscriptions: [subscription()] });

    const { response, body } = await status(db);

    expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({
      status: "active",
      isPremium: true,
      planId: "monthly",
      currentPeriodEnd: FUTURE,
      cancelAtPeriodEnd: false,
    });
  });

  it("expires a subscription whose period has elapsed", async () => {
    const db = fakeD1({ subscriptions: [subscription({ current_period_end: PAST })] });

    const { body } = await status(db);

    expect(body.subscription).toMatchObject({ status: "expired", isPremium: false });
    // The lapse is written back, not just reported.
    expect(db.rows("subscriptions")[0].status).toBe("expired");
  });

  it("never reports premium for a row with no period at all", async () => {
    const db = fakeD1({ subscriptions: [subscription({ current_period_end: null })] });

    const { body } = await status(db);

    expect(body.subscription.isPremium).toBe(false);
  });

  it("treats an account with no subscription row as free", async () => {
    const db = fakeD1();

    const { body } = await status(db);

    expect(body.subscription).toMatchObject({
      status: "free",
      isPremium: false,
      planId: null,
      currentPeriodEnd: null,
    });
    expect(body.paymentMethod).toBeNull();
  });

  it("surfaces the card on file and caches it in D1", async () => {
    stripe = mockStripe({
      routes: {
        "/subscriptions/": {
          id: "sub_test_1",
          default_payment_method: { type: "card", card: { brand: "visa", last4: "4242" } },
        },
      },
    });
    const db = fakeD1({ subscriptions: [subscription()] });

    const first = await status(db);
    expect(first.body.paymentMethod).toEqual({ type: "card", brand: "visa", last4: "4242" });

    const callsAfterFirst = stripe.calls.length;

    // The subscription screen polls this endpoint every 10s; the second read
    // must come from the cached column, not from Stripe.
    const second = await status(db);
    expect(second.body.paymentMethod).toEqual({ type: "card", brand: "visa", last4: "4242" });
    expect(stripe.calls.length).toBe(callsAfterFirst);
  });

  it("rejects a request with no session", async () => {
    const db = fakeD1({ subscriptions: [subscription()] });
    const response = await worker.fetch(
      new Request("https://worker.test/subscription/status"),
      makeEnv(db),
      executionContext
    );

    expect(response.status).toBe(401);
  });
});
