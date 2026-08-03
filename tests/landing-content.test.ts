import { describe, expect, it } from "vitest";
import { faqItems, features, plans } from "../GhostBoxSite/src/content";

describe("landing content", () => {
  it("keeps the approved product narrative", () => {
    expect(features).toHaveLength(6);
    expect(features.map((feature) => feature.id)).toEqual([
      "library",
      "catalogue",
      "collections",
      "achievements",
      "notifications",
      "profile",
    ]);
    expect(plans.map((plan) => plan.id)).toEqual(["free", "premium"]);
    expect(plans.find((plan) => plan.id === "premium")?.prices).toEqual({
      monthly: 699,
      quarterly: 1499,
    });
    expect(faqItems.map((item) => item.id)).toEqual([
      "steam",
      "profile",
      "cloud",
      "cancel",
    ]);
  });
});
