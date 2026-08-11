import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri bridges are not available under vitest; only the cache logic in
// ghostboxApi is under test here, so they are stubbed at the module boundary.
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async () => {},
  revealItemInDir: async () => {},
}));

const PREMIUM_CACHE_KEY = "ghostbox:premium-status";
const PENDING_CHECKOUT_KEY = "ghostbox:pending-checkout";
const TTL_MS = 5 * 60 * 1000;

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  return store;
}

async function loadApi() {
  vi.resetModules();
  const module = await import("../src/lib/ghostboxApi.tauri");
  return module.ghostboxApi;
}

let store: Map<string, string>;

beforeEach(() => {
  store = installLocalStorage();
  invoke.mockReset();
});

afterEach(() => {
  delete (globalThis as any).localStorage;
});

describe("premium status cache", () => {
  it("does not treat a stale stored entry as fresh", async () => {
    // Regression: getCachedIsPremium used to re-stamp cachedAt with Date.now(),
    // so a week-old entry looked fresh and the boot revalidation was skipped —
    // an expired subscription kept rendering as Premium.
    store.set(
      PREMIUM_CACHE_KEY,
      JSON.stringify({
        isPremium: true,
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
        cachedAt: Date.now() - TTL_MS - 1,
      })
    );

    const api = await loadApi();

    expect(api.getCachedIsPremium()).toBe(true);
    expect(api.getFreshCachedPremiumStatus()).toBeNull();
  });

  it("keeps a recent entry fresh and preserves its period end", async () => {
    store.set(
      PREMIUM_CACHE_KEY,
      JSON.stringify({
        isPremium: true,
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
        cachedAt: Date.now(),
      })
    );

    const api = await loadApi();

    expect(api.getCachedIsPremium()).toBe(true);
    expect(api.getFreshCachedPremiumStatus()).toMatchObject({
      isPremium: true,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    });
  });

  it("keeps the cached entitlement when the status read fails", async () => {
    store.set(
      PREMIUM_CACHE_KEY,
      JSON.stringify({ isPremium: true, currentPeriodEnd: null, cachedAt: 0 })
    );
    invoke.mockRejectedValue(new Error("offline"));

    const api = await loadApi();

    // A failed read must not be mistaken for "user is on the free plan".
    expect(await api.getSubscriptionStatus()).toBeNull();
    expect(await api.isPremiumUser()).toBe(true);
    expect(JSON.parse(store.get(PREMIUM_CACHE_KEY)!).isPremium).toBe(true);
  });

  it("records a real status read", async () => {
    invoke.mockResolvedValue({
      userId: "u1",
      steamId: null,
      subscription: {
        status: "active",
        isPremium: true,
        planId: "monthly",
        currentPeriodStart: null,
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
        lastPaymentId: null,
        updatedAt: null,
      },
      latestPayment: null,
    });

    const api = await loadApi();
    await api.getSubscriptionStatus();

    expect(JSON.parse(store.get(PREMIUM_CACHE_KEY)!)).toMatchObject({
      isPremium: true,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    });
  });
});

describe("checkout error handling", () => {
  it("propagates the reason a checkout failed", async () => {
    // Swallowing this collapsed "rate limited" / "session expired" / "Stripe
    // not configured" into a single unhelpful retry toast.
    invoke.mockRejectedValue("Muitas tentativas de assinatura. Aguarde alguns minutos e tente novamente.");

    const api = await loadApi();

    await expect(api.createSubscriptionCheckout("monthly")).rejects.toThrow(
      "Muitas tentativas de assinatura"
    );
  });
});

describe("pending checkout tracking", () => {
  it("round-trips and clears the pending checkout id", async () => {
    const api = await loadApi();

    expect(api.getPendingCheckoutId()).toBeNull();
    api.setPendingCheckoutId("cs_test_1");
    expect(api.getPendingCheckoutId()).toBe("cs_test_1");
    api.setPendingCheckoutId(null);
    expect(api.getPendingCheckoutId()).toBeNull();
  });

  it("caches the entitlement a refreshed checkout reports", async () => {
    invoke.mockResolvedValue({
      payment: { id: "pay_1", status: "paid", checkoutId: "cs_test_1" },
      subscription: { status: "active", isPremium: true, currentPeriodEnd: "2099-01-01T00:00:00.000Z" },
    });

    const api = await loadApi();
    const result = await api.refreshSubscriptionCheckout("cs_test_1");

    expect(invoke).toHaveBeenCalledWith("subscription_refresh_status", { checkoutId: "cs_test_1" });
    expect(result?.payment.status).toBe("paid");
    expect(JSON.parse(store.get(PREMIUM_CACHE_KEY)!).isPremium).toBe(true);
  });

  it("reports a failed refresh as null instead of a decision", async () => {
    invoke.mockRejectedValue(new Error("offline"));

    const api = await loadApi();

    expect(await api.refreshSubscriptionCheckout("cs_test_1")).toBeNull();
  });

  it("drops the pending checkout when account caches are cleared", async () => {
    const api = await loadApi();
    api.setPendingCheckoutId("cs_test_1");

    api.clearAccountCaches();

    expect(store.has(PENDING_CHECKOUT_KEY)).toBe(false);
  });
});
