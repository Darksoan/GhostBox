import { describe, expect, it } from "vitest";
import { hmacSha256Hex, timingSafeEqual } from "../src/crypto";
import { STRIPE_WEBHOOK_TOLERANCE_SECONDS, verifyStripeWebhookSignature } from "../src/stripe";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

async function signatureHeader(timestamp: number, payload = PAYLOAD, secret = SECRET) {
  const signature = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeWebhookSignature", () => {
  const now = 1_735_689_600;

  it("accepts a correctly signed payload", async () => {
    const header = await signatureHeader(now);
    expect(await verifyStripeWebhookSignature(header, PAYLOAD, SECRET, now)).toBe(true);
  });

  it("accepts a header carrying several schemes", async () => {
    const signature = await hmacSha256Hex(SECRET, `${now}.${PAYLOAD}`);
    const header = `t=${now},v0=deadbeef,v1=${signature}`;
    expect(await verifyStripeWebhookSignature(header, PAYLOAD, SECRET, now)).toBe(true);
  });

  it("rejects a timestamp outside the tolerance window", async () => {
    const stale = now - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 1;
    const header = await signatureHeader(stale);
    expect(await verifyStripeWebhookSignature(header, PAYLOAD, SECRET, now)).toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    const header = await signatureHeader(now, PAYLOAD, "whsec_other");
    expect(await verifyStripeWebhookSignature(header, PAYLOAD, SECRET, now)).toBe(false);
  });

  it("rejects a payload altered after signing", async () => {
    const header = await signatureHeader(now);
    const tampered = JSON.stringify({ id: "evt_1", type: "customer.subscription.deleted" });
    expect(await verifyStripeWebhookSignature(header, tampered, SECRET, now)).toBe(false);
  });

  it("rejects malformed or missing headers", async () => {
    expect(await verifyStripeWebhookSignature(null, PAYLOAD, SECRET, now)).toBe(false);
    expect(await verifyStripeWebhookSignature("", PAYLOAD, SECRET, now)).toBe(false);
    expect(await verifyStripeWebhookSignature(`t=${now}`, PAYLOAD, SECRET, now)).toBe(false);
    expect(await verifyStripeWebhookSignature("v1=abc", PAYLOAD, SECRET, now)).toBe(false);
    expect(await verifyStripeWebhookSignature(`t=,v1=`, PAYLOAD, SECRET, now)).toBe(false);
    expect(await verifyStripeWebhookSignature(`t=nope,v1=abc`, PAYLOAD, SECRET, now)).toBe(false);
  });

  it("rejects when no webhook secret is configured", async () => {
    const header = await signatureHeader(now);
    expect(await verifyStripeWebhookSignature(header, PAYLOAD, "", now)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("compares equal-length strings without leaking on the first mismatch", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
