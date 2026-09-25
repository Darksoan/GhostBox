import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("premium profile banner", () => {
  it("passes the premium entitlement to the profile editor", () => {
    expect(readSource("../src/App.tsx")).toContain("isPremium={isPremium}");
    expect(readSource("../src/components/routing/PageRouter.tsx")).toContain(
      "isPremium={isPremium}",
    );
    expect(readSource("../src/pages/ProfilePage.tsx")).toContain(
      "isPremium={isPremium}",
    );
  });

  it("disables banner controls and interactions for free users", () => {
    const source = readSource("../src/components/profile/EditProfileTab.tsx");

    expect(source).toContain("disabled={!isPremium}");
    expect(source).toContain("disabled={!isPremium || isBannerPlaceholder}");
    expect(source).toMatch(
      /handleBannerChange[\s\S]*?if \(!isPremium\) return;/,
    );
    expect(source).toMatch(
      /handleBannerPointerDown[\s\S]*?if \(!isPremium \|\|/,
    );
  });

  it("links the free banner notice to the subscription screen", () => {
    const source = readSource("../src/components/profile/EditProfileTab.tsx");

    expect(source).toContain("SquareArrowOutUpRight");
    expect(source).toContain("profile-page__edit-banner-premium-link");
    expect(source).toContain("setSubscriptionModalOpen(true)");
    expect(source).toContain('t("profile.bannerPremiumHelp")');
    expect(source).toContain('t("profile.bannerPremiumLink")');
  });

  it("rejects local banner persistence when Premium is unavailable", () => {
    const source = readSource("../src/context/AppDataContext.tsx");

    expect(source).toContain("if (bannerChanged && !canUseCloudImages)");
    expect(source).toMatch(
      /if \(bannerChanged && !canUseCloudImages\) \{[\s\S]*?throw new Error\(message\);[\s\S]*?\}\s*const optimisticProfile/,
    );
  });
});
