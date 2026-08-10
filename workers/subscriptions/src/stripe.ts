// Pure Stripe payload helpers. No Env, no D1, no fetch — everything here is
// unit tested in test/stripe-shape.test.ts, because the shape of these payloads
// is the single most dangerous thing in the billing flow: read the wrong field
// and a paying user silently loses Premium.

import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export type PlanId = "monthly" | "quarterly";

/**
 * Pinned Stripe API version. Every request sends it explicitly so the payload
 * shape can never change under us when the Stripe account's default version is
 * bumped in the dashboard. `2025-03-31.basil` and later removed
 * `current_period_start/end` from the Subscription object and `subscription`
 * from the Invoice object; the readers below tolerate both shapes anyway, but
 * the pin is what makes the behaviour deterministic.
 */
export const STRIPE_API_VERSION = "2024-06-20";

/** How long a signed webhook payload stays acceptable, in seconds. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Stripe fields are either an id string or, when expanded, an object with `id`. */
function stripeIdOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

export function stripeSubscriptionIsPremium(status: unknown) {
  return status === "active" || status === "trialing";
}

export function stripePeriodDate(value: unknown, fallback: string | null = null) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : fallback;
}

export function planIdFromStripe(value: unknown, fallback: PlanId = "monthly"): PlanId {
  return value === "quarterly" || value === "monthly" ? value : fallback;
}

export function stripeMetadataString(payload: Record<string, unknown>, key: string): string | null {
  const metadata = asRecord(payload.metadata);
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

export type StripePeriod = { start: string | null; end: string | null };

/**
 * Billing period of a Stripe Subscription, as ISO strings.
 *
 * Pre-`basil` payloads carry `current_period_start/end` on the subscription
 * itself. From `2025-03-31.basil` those fields moved onto each subscription
 * item. Both are read here, and `null` is returned when neither resolves —
 * callers must treat that as an error instead of substituting "now", which
 * would write a subscription that is already expired the instant it is stored.
 */
export function stripeSubscriptionPeriod(subscription: unknown): StripePeriod {
  const sub = asRecord(subscription);
  if (!sub) return { start: null, end: null };

  let start = stripePeriodDate(sub.current_period_start);
  let end = stripePeriodDate(sub.current_period_end);
  if (start && end) return { start, end };

  // A GhostBox subscription only ever has one item, but take the widest window
  // so a subscription edited by hand in the dashboard still grants access for
  // as long as it was actually paid for.
  const data = asRecord(sub.items)?.data;
  for (const entry of Array.isArray(data) ? data : []) {
    const item = asRecord(entry);
    if (!item) continue;
    const itemStart = stripePeriodDate(item.current_period_start);
    const itemEnd = stripePeriodDate(item.current_period_end);
    if (itemStart && (!start || itemStart < start)) start = itemStart;
    if (itemEnd && (!end || itemEnd > end)) end = itemEnd;
  }

  return { start, end };
}

/**
 * Subscription id an Invoice belongs to.
 *
 * `invoice.subscription` pre-`basil`; from `2025-03-31.basil` it lives under
 * `invoice.parent.subscription_details.subscription`, with per-line parents on
 * invoices that mix several subscriptions.
 */
export function stripeInvoiceSubscriptionId(invoice: unknown): string | null {
  const row = asRecord(invoice);
  if (!row) return null;

  const direct = stripeIdOf(row.subscription);
  if (direct) return direct;

  const fromParent = stripeIdOf(asRecord(asRecord(row.parent)?.subscription_details)?.subscription);
  if (fromParent) return fromParent;

  const lines = asRecord(row.lines)?.data;
  for (const entry of Array.isArray(lines) ? lines : []) {
    const parent = asRecord(asRecord(entry)?.parent);
    const fromLine =
      stripeIdOf(asRecord(parent?.subscription_item_details)?.subscription) ??
      stripeIdOf(asRecord(parent?.subscription_details)?.subscription);
    if (fromLine) return fromLine;
  }

  return null;
}

export async function verifyStripeWebhookSignature(
  signatureHeader: string | null,
  payload: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",");
  const tPart = parts.find((part) => part.trim().startsWith("t="));
  const v1Part = parts.find((part) => part.trim().startsWith("v1="));
  if (!tPart || !v1Part) return false;
  const timestamp = tPart.trim().slice(2);
  const signature = v1Part.trim().slice(3);
  if (!timestamp || !signature) return false;

  const diff = Math.abs(nowSeconds - parseInt(timestamp, 10));
  if (Number.isNaN(diff) || diff > STRIPE_WEBHOOK_TOLERANCE_SECONDS) return false;

  const expectedSignature = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return timingSafeEqual(signature, expectedSignature);
}
