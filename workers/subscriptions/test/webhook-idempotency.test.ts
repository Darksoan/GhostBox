import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, stripeWebhookRequest } from "./helpers/worker";

const SESSION_ID = "cs_test_1";
const SUBSCRIPTION_ID = "sub_test_1";
const PERIOD_START = 1_735_689_600; // 2025-01-01T00:00:00Z
const PERIOD_END = 1_738_368_000; // 2025-02-01T00:00:00Z

function pendingPayment() {
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
  };
}

function checkoutCompletedEvent(id = "evt_1") {
  return {
    id,
    type: "checkout.session.completed",
    created: PERIOD_START,
    data: {
      object: {
        id: SESSION_ID,
        customer: "cus_test_1",
        subscription: SUBSCRIPTION_ID,
        metadata: { user_id: "user_1", plan_id: "monthly" },
      },
    },
  };
}

const activeSubscriptionPayload = {
  id: SUBSCRIPTION_ID,
  status: "active",
  customer: "cus_test_1",
  current_period_start: PERIOD_START,
  current_period_end: PERIOD_END,
};

let stripe: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe("stripe webhook idempotency", () => {
  it("processes a new event and records it as handled", async () => {
    stripe = mockStripe({ routes: { "/subscriptions/": activeSubscriptionPayload } });
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    const response = await worker.fetch(await stripeWebhookRequest(checkoutCompletedEvent()), env, executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("webhook_events")[0].processed_at).toBeTruthy();
    expect(db.rows("payments")[0].status).toBe("paid");
    expect(db.rows("subscriptions")[0]).toMatchObject({
      user_id: "user_1",
      status: "active",
      current_period_end: "2025-02-01T00:00:00.000Z",
    });
  });

  it("short-circuits a redelivery of an already handled event", async () => {
    stripe = mockStripe({ routes: { "/subscriptions/": activeSubscriptionPayload } });
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    await worker.fetch(await stripeWebhookRequest(checkoutCompletedEvent()), env, executionContext);
    const paysAfterFirst = db.counted("payments.pay");

    const second = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, note: "duplicate" });
    expect(db.counted("payments.pay")).toBe(paysAfterFirst);
  });

  it("answers 5xx and leaves the event unhandled when processing fails", async () => {
    // The regression this guards: the event row used to be written before
    // processing and every handler swallowed its error, so a Stripe outage
    // burned a paid checkout permanently.
    stripe = mockStripe({ fail: true });
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    const response = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );

    expect(response.status).toBe(500);
    expect(db.rows("webhook_events")[0].processed_at).toBeNull();
    expect(db.rows("webhook_events")[0].attempts).toBe(1);
    expect(db.rows("payments")[0].status).toBe("pending");
    expect(db.rows("subscriptions")).toHaveLength(0);
  });

  it("recovers the payment when Stripe redelivers a previously failed event", async () => {
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    stripe = mockStripe({ fail: true });
    const failed = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );
    expect(failed.status).toBe(500);
    stripe.restore();

    stripe = mockStripe({ routes: { "/subscriptions/": activeSubscriptionPayload } });
    const retried = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );

    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ ok: true });
    expect(db.rows("webhook_events")[0].processed_at).toBeTruthy();
    expect(db.rows("payments")[0].status).toBe("paid");
    expect(db.rows("subscriptions")[0].status).toBe("active");
  });

  it("refuses to store an active subscription with no resolvable period", async () => {
    // A basil-shaped payload read with the old top-level-only reader produced
    // exactly this: no period, which used to be silently replaced by "now".
    stripe = mockStripe({
      routes: {
        "/subscriptions/": { id: SUBSCRIPTION_ID, status: "active", customer: "cus_test_1" },
      },
    });
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    const response = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );

    expect(response.status).toBe(500);
    expect(db.rows("subscriptions")).toHaveLength(0);
    expect(db.rows("webhook_events")[0].last_error).toContain("stripe_period_unresolved");
  });

  it("reads the basil item-level period", async () => {
    stripe = mockStripe({
      routes: {
        "/subscriptions/": {
          id: SUBSCRIPTION_ID,
          status: "active",
          customer: "cus_test_1",
          items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
        },
      },
    });
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    const response = await worker.fetch(
      await stripeWebhookRequest(checkoutCompletedEvent()),
      env,
      executionContext
    );

    expect(response.status).toBe(200);
    expect(db.rows("subscriptions")[0].current_period_end).toBe("2025-02-01T00:00:00.000Z");
  });

  it("rejects a payload whose signature does not match", async () => {
    const db = fakeD1({ payments: [pendingPayment()] });
    const env = makeEnv(db);

    const response = await worker.fetch(
      new Request("https://worker.test/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: JSON.stringify(checkoutCompletedEvent()),
      }),
      env,
      executionContext
    );

    expect(response.status).toBe(400);
    expect(db.rows("webhook_events")).toHaveLength(0);
  });
});

describe("out-of-order subscription events", () => {
  it("does not let a stale update resurrect a cancelled subscription", async () => {
    stripe = mockStripe();
    const db = fakeD1({
      subscriptions: [
        {
          steam_id: null,
          user_id: "user_1",
          plan_id: "monthly",
          status: "expired",
          current_period_start: "2025-01-01T00:00:00.000Z",
          current_period_end: "2025-02-01T00:00:00.000Z",
          stripe_subscription_id: SUBSCRIPTION_ID,
          stripe_subscription_status: "canceled",
          stripe_event_created: PERIOD_END,
          cancel_at_period_end: 0,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-02-01T00:00:00.000Z",
        },
      ],
    });
    const env = makeEnv(db);

    const stale = {
      id: "evt_stale",
      type: "customer.subscription.updated",
      created: PERIOD_START, // older than what is on record
      data: {
        object: {
          id: SUBSCRIPTION_ID,
          status: "active",
          customer: "cus_test_1",
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          metadata: { user_id: "user_1", plan_id: "monthly" },
        },
      },
    };

    const response = await worker.fetch(await stripeWebhookRequest(stale), env, executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("subscriptions")[0].status).toBe("expired");
  });

  it("does not revoke a resubscription when the old subscription is deleted", async () => {
    stripe = mockStripe();
    const db = fakeD1({
      subscriptions: [
        {
          steam_id: null,
          user_id: "user_1",
          plan_id: "monthly",
          status: "active",
          current_period_start: "2025-03-01T00:00:00.000Z",
          current_period_end: "2099-01-01T00:00:00.000Z",
          stripe_subscription_id: "sub_new",
          stripe_subscription_status: "active",
          stripe_event_created: PERIOD_END,
          cancel_at_period_end: 0,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-03-01T00:00:00.000Z",
        },
      ],
    });
    const env = makeEnv(db);

    const deleted = {
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      created: PERIOD_END + 10,
      data: {
        object: {
          id: "sub_old",
          status: "canceled",
          metadata: { user_id: "user_1" },
        },
      },
    };

    const response = await worker.fetch(await stripeWebhookRequest(deleted), env, executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("subscriptions")[0].status).toBe("active");
    expect(db.rows("subscriptions")[0].stripe_subscription_id).toBe("sub_new");
  });
});
