import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

/** The subscription block of App.tsx, from the poll's cache hydration down to
 * the sign-out reset. */
function subscriptionBlock() {
  const start = appSource.indexOf("const subscriptionReadAliveRef");
  const end = appSource.indexOf("onCatalogueCacheUpdated");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe("premium status on sign-in", () => {
  it("re-reads the subscription when the account becomes authenticated", () => {
    // The bug: the status poll was mounted once with [] deps, so signing in
    // never triggered a read. A paying user kept seeing "Become premium" until
    // the five-minute tick or an accidental window focus.
    const block = subscriptionBlock();
    expect(block).toMatch(/if \(status !== "authenticated"\) return;/);
    expect(block).toMatch(/getSubscriptionStatus\(\)/);
  });

  it("does not gate the sign-in read behind the cache TTL", () => {
    // The cached entry describes whoever was signed in before — on a cold
    // start, nobody. It cannot answer for an account that just arrived.
    const block = subscriptionBlock();
    const signInEffect = block.slice(block.indexOf('if (status !== "authenticated") return;'));
    expect(signInEffect).not.toContain("getFreshCachedPremiumStatus");
  });

  it("retries a null answer instead of settling on the free plan", () => {
    const block = subscriptionBlock();
    expect(block).toContain("PREMIUM_LOGIN_READ_ATTEMPTS");
    expect(appSource).toMatch(/const PREMIUM_LOGIN_READ_ATTEMPTS = \d+;/);
  });

  it("still keeps the last known entitlement when a read fails", () => {
    // null is "could not read", never "subscription ended".
    expect(appSource).toMatch(/if \(!result\) return false;/);
  });

  it("drops the crown only on a real sign-out", () => {
    expect(appSource).toMatch(
      /if \(status !== "anonymous"\) return;\s*setIsPremium\(false\);/,
    );
  });
});
