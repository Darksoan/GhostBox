import { describe, expect, it } from "vitest";
import {
  planIdFromStripe,
  stripeInvoiceSubscriptionId,
  stripeMetadataString,
  stripePeriodDate,
  stripeSubscriptionIsPremium,
  stripeSubscriptionPeriod,
} from "../src/stripe";

// The two payload shapes these helpers exist to bridge. Reading the wrong one
// means a paid subscription is stored with no period (instantly expired) or a
// renewal invoice is dropped on the floor.
const PERIOD_START = 1_735_689_600; // 2025-01-01T00:00:00Z
const PERIOD_END = 1_738_368_000; // 2025-02-01T00:00:00Z

describe("stripeSubscriptionPeriod", () => {
  it("reads the pre-basil top level fields", () => {
    expect(
      stripeSubscriptionPeriod({
        id: "sub_1",
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
      })
    ).toEqual({
      start: "2025-01-01T00:00:00.000Z",
      end: "2025-02-01T00:00:00.000Z",
    });
  });

  it("reads the basil item level fields when the top level is gone", () => {
    expect(
      stripeSubscriptionPeriod({
        id: "sub_1",
        items: {
          object: "list",
          data: [
            {
              id: "si_1",
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
            },
          ],
        },
      })
    ).toEqual({
      start: "2025-01-01T00:00:00.000Z",
      end: "2025-02-01T00:00:00.000Z",
    });
  });

  it("takes the widest window across several items", () => {
    const period = stripeSubscriptionPeriod({
      items: {
        data: [
          { current_period_start: PERIOD_START, current_period_end: PERIOD_END },
          { current_period_start: PERIOD_START + 86_400, current_period_end: PERIOD_END + 86_400 },
        ],
      },
    });
    expect(period.start).toBe("2025-01-01T00:00:00.000Z");
    expect(period.end).toBe("2025-02-02T00:00:00.000Z");
  });

  it("returns null instead of inventing a period", () => {
    // This is the case that used to fall back to `now`, writing a subscription
    // that was already expired the moment it was stored.
    expect(stripeSubscriptionPeriod({ id: "sub_1", items: { data: [] } })).toEqual({
      start: null,
      end: null,
    });
    expect(stripeSubscriptionPeriod(null)).toEqual({ start: null, end: null });
    expect(stripeSubscriptionPeriod({ current_period_end: "not-a-number" })).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("stripeInvoiceSubscriptionId", () => {
  it("reads the pre-basil invoice.subscription", () => {
    expect(stripeInvoiceSubscriptionId({ id: "in_1", subscription: "sub_1" })).toBe("sub_1");
  });

  it("reads an expanded invoice.subscription object", () => {
    expect(stripeInvoiceSubscriptionId({ id: "in_1", subscription: { id: "sub_1" } })).toBe("sub_1");
  });

  it("reads the basil parent block", () => {
    expect(
      stripeInvoiceSubscriptionId({
        id: "in_1",
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
      })
    ).toBe("sub_1");
  });

  it("falls back to the line item parent", () => {
    expect(
      stripeInvoiceSubscriptionId({
        id: "in_1",
        lines: {
          data: [
            { id: "il_1", parent: { subscription_item_details: { subscription: "sub_1" } } },
          ],
        },
      })
    ).toBe("sub_1");
  });

  it("returns null for a one-off invoice with no subscription", () => {
    expect(stripeInvoiceSubscriptionId({ id: "in_1", lines: { data: [{ id: "il_1" }] } })).toBeNull();
    expect(stripeInvoiceSubscriptionId(null)).toBeNull();
  });
});

describe("small payload readers", () => {
  it("treats trialing as premium and everything else as not", () => {
    expect(stripeSubscriptionIsPremium("active")).toBe(true);
    expect(stripeSubscriptionIsPremium("trialing")).toBe(true);
    expect(stripeSubscriptionIsPremium("past_due")).toBe(false);
    expect(stripeSubscriptionIsPremium(undefined)).toBe(false);
  });

  it("converts epoch seconds and honours the fallback", () => {
    expect(stripePeriodDate(PERIOD_END)).toBe("2025-02-01T00:00:00.000Z");
    expect(stripePeriodDate(null)).toBeNull();
    expect(stripePeriodDate("1738368000", "fallback")).toBe("fallback");
    expect(stripePeriodDate(Number.NaN, "fallback")).toBe("fallback");
  });

  it("only accepts known plan ids", () => {
    expect(planIdFromStripe("quarterly")).toBe("quarterly");
    expect(planIdFromStripe("monthly")).toBe("monthly");
    expect(planIdFromStripe("yearly")).toBe("monthly");
    expect(planIdFromStripe(undefined, "quarterly")).toBe("quarterly");
  });

  it("reads string metadata defensively", () => {
    expect(stripeMetadataString({ metadata: { user_id: "u1" } }, "user_id")).toBe("u1");
    expect(stripeMetadataString({ metadata: { user_id: 7 } }, "user_id")).toBeNull();
    expect(stripeMetadataString({}, "user_id")).toBeNull();
  });
});
