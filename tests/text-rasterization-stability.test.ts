import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("text rasterization stability", () => {
  const appStyles = readFileSync("src/app.scss", "utf8");
  const profileStyles = readFileSync("src/pages/ProfilePage.scss", "utf8");
  const premiumStyles = readFileSync("src/styles/_premium-modal.scss", "utf8");
  const authStyles = readFileSync("src/features/auth/AuthScreen.scss", "utf8");

  it("does not retain decorative animations on text-bearing app surfaces", () => {
    const decorativeAnimations = [
      "content-overlay-fade-in",
      "sidebar-mode-panel-in",
      "sidebar-mode-item-in",
      "home-banner-info-in",
      "settings-dropdown-open",
      "context-menu-in",
      "catalogue-filter-panel-in",
      "app-notification-child-in",
      "toast-in",
      "toast-icon-in",
      "achievement-tooltip-fade-in",
      "game-settings-modal-in",
      "game-settings-section-in",
      "modal-content-fade-in",
    ];

    for (const animation of decorativeAnimations) {
      expect(appStyles).not.toMatch(
        new RegExp(`animation:\\s*${animation}(?![\\w-])`),
      );
    }
  });

  it("keeps profile, premium and authentication text outside animated layers", () => {
    expect(profileStyles).not.toMatch(/animation:\s*steamid-(reveal|hide|copy-enter)/);
    expect(profileStyles).not.toMatch(/animation:\s*profile-achievement-percent-reveal/);
    expect(profileStyles).not.toMatch(/animation:\s*profile-achievement-fill-reveal/);
    expect(premiumStyles).not.toMatch(/animation:\s*premium-modal-(scrim-in|in|item-in)/);
    expect(authStyles).not.toMatch(/animation:\s*auth-form-enter/);
  });

  it("preserves functional progress and loading animation", () => {
    expect(appStyles).toMatch(/animation:\s*spin/);
    expect(appStyles).toMatch(/animation:\s*toast-progress/);
  });
});
