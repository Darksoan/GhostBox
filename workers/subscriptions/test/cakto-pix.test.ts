import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  caktoAmountCents,
  caktoOrderIsPaid,
  caktoOrderIsReversed,
  isValidBrazilianPhone,
  isValidCpf,
  resetCaktoTokenCache,
} from "../src/cakto";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe, sessionToken } from "./helpers/worker";

const WEBHOOK_SECRET = "cakto_webhook_test_secret";
const ORDER_ID = "order_test_1";

function caktoEnv(db: ReturnType<typeof fakeD1>) {
  return makeEnv(db, {
    CAKTO_CLIENT_ID: "cakto_client",
    CAKTO_CLIENT_SECRET: "cakto_secret",
    CAKTO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CAKTO_OFFER_MONTHLY: "offer_monthly",
    CAKTO_OFFER_QUARTERLY: "offer_quarterly",
  });
}

function pixPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_pix_1",
    checkout_reference: "cakto-ABC123",
    checkout_id: ORDER_ID,
    cakto_order_id: ORDER_ID,
    stripe_checkout_session_id: null,
    steam_id: null,
    user_id: "user_1",
    plan_id: "monthly",
    amount_cents: 699,
    currency: "BRL",
    status: "pending",
    hosted_checkout_url: "https://pay.cakto.com.br/ABC123",
    stripe_subscription_id: null,
    provider: "cakto",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    confirmed_at: null,
    ...overrides,
  };
}

/** mockStripe is a URL-fragment fetch stub; here it stands in for Cakto. */
function mockCakto(orderStatus: string) {
  return mockStripe({
    routes: {
      "public_api/token": { access_token: "cakto_access_token", expires_in: 3600 },
      "public_api/orders/": {
        id: ORDER_ID,
        refId: "ABC123",
        status: orderStatus,
        paymentMethod: "pix",
      },
    },
  });
}

function webhookRequest(body: Record<string, unknown>) {
  return new Request("https://worker.test/cakto/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function approvedEvent(secret = WEBHOOK_SECRET) {
  return { secret, event: "purchase_approved", data: { id: ORDER_ID, refId: "ABC123" } };
}

let cakto: ReturnType<typeof mockStripe> | null = null;

beforeEach(() => {
  resetCaktoTokenCache();
});

afterEach(() => {
  cakto?.restore();
  cakto = null;
});

describe("cakto helpers", () => {
  it("maps order statuses to access decisions", () => {
    expect(caktoOrderIsPaid({ status: "paid" })).toBe(true);
    expect(caktoOrderIsPaid({ status: "waiting_payment" })).toBe(false);
    // Pix has no manual capture: an authorized-but-unsettled order is not money.
    expect(caktoOrderIsPaid({ status: "authorized" })).toBe(false);
    expect(caktoOrderIsReversed({ status: "refunded" })).toBe(true);
    expect(caktoOrderIsReversed({ status: "chargedback" })).toBe(true);
    // A refund still awaiting the producer's approval must not cut access.
    expect(caktoOrderIsReversed({ status: "refund_requested" })).toBe(false);
  });

  it("reads the charged amount, service fee included", () => {
    // The offer is R$ 6,00; Cakto adds its R$ 0,99 fee at checkout, and the
    // receipt has to show what the customer actually paid.
    expect(caktoAmountCents({ amount: "6.99" })).toBe(699);
    expect(caktoAmountCents({ amount: 14.99 })).toBe(1499);
    expect(caktoAmountCents({ amount: null })).toBeNull();
    expect(caktoAmountCents({ amount: "abc" })).toBeNull();
  });

  it("validates CPF check digits and rejects repdigits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });

  it("accepts landline and mobile numbers, with or without country code", () => {
    expect(isValidBrazilianPhone("(11) 91234-5678")).toBe(true);
    expect(isValidBrazilianPhone("1132145678")).toBe(true);
    expect(isValidBrazilianPhone("+55 11 91234-5678")).toBe(true);
    expect(isValidBrazilianPhone("91234")).toBe(false);
  });

});

describe("POST /cakto/webhook", () => {
  it("rejects a payload whose secret does not match", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });

    const response = await worker.fetch(webhookRequest(approvedEvent("wrong_secret")), caktoEnv(db), executionContext);

    expect(response.status).toBe(401);
    expect(db.rows("subscriptions")).toHaveLength(0);
    expect(db.rows("payments")[0].status).toBe("pending");
  });

  it("grants a stacked period when the order really is paid", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });

    const response = await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("payments")[0].status).toBe("paid");
    expect(db.rows("subscriptions")[0]).toMatchObject({
      user_id: "user_1",
      status: "active",
      provider: "cakto",
      // Pix never renews itself, so the panel must not promise a next charge.
      cancel_at_period_end: 1,
    });
  });

  it("does not grant access when the API says the order is unpaid", async () => {
    // Cakto signs nothing — the body alone could be forged, so the order is
    // re-read from the API before anything is granted.
    cakto = mockCakto("waiting_payment");
    const db = fakeD1({ payments: [pixPayment()] });

    const response = await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("payments")[0].status).toBe("pending");
    expect(db.rows("subscriptions")).toHaveLength(0);
  });

  it("grants once across a redelivery of the same event", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });
    const env = caktoEnv(db);

    await worker.fetch(webhookRequest(approvedEvent()), env, executionContext);
    const second = await worker.fetch(webhookRequest(approvedEvent()), env, executionContext);

    expect(await second.json()).toEqual({ ok: true, note: "duplicate" });
    expect(db.counted("payments.cakto_pay")).toBe(1);
  });

  it("never persists the shared secret with the event", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });

    await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    expect(db.rows("webhook_events")[0].payload).not.toContain(WEBHOOK_SECRET);
  });

  it("revokes the period on a refund", async () => {
    cakto = mockCakto("refunded");
    const db = fakeD1({
      payments: [pixPayment({ status: "paid", confirmed_at: "2026-01-01T00:00:00.000Z" })],
      subscriptions: [
        {
          steam_id: null,
          user_id: "user_1",
          plan_id: "monthly",
          status: "active",
          current_period_start: "2026-01-01T00:00:00.000Z",
          current_period_end: "2099-01-01T00:00:00.000Z",
          last_payment_id: "pay_pix_1",
          provider: "cakto",
          cancel_at_period_end: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const response = await worker.fetch(
      webhookRequest({ secret: WEBHOOK_SECRET, event: "refund", data: { id: ORDER_ID } }),
      caktoEnv(db),
      executionContext
    );

    expect(response.status).toBe(200);
    expect(db.rows("subscriptions")[0].status).toBe("expired");
    expect(db.rows("payments")[0].status).toBe("cancelled");
  });

  it("stacks the new period on top of the remaining one", async () => {
    // Renewing early must not burn the days already paid for.
    cakto = mockCakto("paid");
    const remainingEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const db = fakeD1({
      payments: [pixPayment({ plan_id: "quarterly" })],
      subscriptions: [
        {
          steam_id: null,
          user_id: "user_1",
          plan_id: "monthly",
          status: "active",
          current_period_start: "2026-01-01T00:00:00.000Z",
          current_period_end: remainingEnd,
          last_payment_id: "pay_old",
          provider: "cakto",
          cancel_at_period_end: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    const stacked = Date.parse(db.rows("subscriptions")[0].current_period_end);
    const threeMonthsFromRemaining = new Date(remainingEnd);
    threeMonthsFromRemaining.setUTCMonth(threeMonthsFromRemaining.getUTCMonth() + 3);
    expect(stacked).toBe(threeMonthsFromRemaining.getTime());
  });

  it("restarts from now when the previous period already expired", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({
      payments: [pixPayment()],
      subscriptions: [
        {
          steam_id: null,
          user_id: "user_1",
          plan_id: "monthly",
          status: "expired",
          current_period_start: "2025-01-01T00:00:00.000Z",
          current_period_end: "2025-02-01T00:00:00.000Z",
          last_payment_id: "pay_old",
          provider: "cakto",
          cancel_at_period_end: 1,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    const row = db.rows("subscriptions")[0];
    expect(row.status).toBe("active");
    // A month from now, not a month from a period that ended in the past.
    expect(Date.parse(row.current_period_end)).toBeGreaterThan(Date.now());
  });

  it("ignores an order that belongs to another product on the same account", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1();

    const response = await worker.fetch(webhookRequest(approvedEvent()), caktoEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("subscriptions")).toHaveLength(0);
  });
});

describe("GET /subscription/pix/charges/:id", () => {
  it("confirms a paid charge even if the webhook never arrived", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });
    const token = await sessionToken("user_1");

    const response = await worker.fetch(
      new Request(`https://worker.test/subscription/pix/charges/pay_pix_1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      caktoEnv(db),
      executionContext
    );
    const body = await response.json<any>();

    expect(response.status).toBe(200);
    expect(body.charge.status).toBe("paid");
    expect(db.rows("subscriptions")[0].status).toBe("active");
  });

  it("hides another account's charge behind a 404", async () => {
    cakto = mockCakto("paid");
    const db = fakeD1({ payments: [pixPayment()] });
    const token = await sessionToken("user_2");

    const response = await worker.fetch(
      new Request(`https://worker.test/subscription/pix/charges/pay_pix_1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      caktoEnv(db),
      executionContext
    );

    expect(response.status).toBe(404);
    expect(db.rows("payments")[0].status).toBe("pending");
  });

  it("rejects an unauthenticated caller", async () => {
    const db = fakeD1({ payments: [pixPayment()] });

    const response = await worker.fetch(
      new Request(`https://worker.test/subscription/pix/charges/pay_pix_1`),
      caktoEnv(db),
      executionContext
    );

    expect(response.status).toBe(401);
  });
});
