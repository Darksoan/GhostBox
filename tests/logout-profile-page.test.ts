import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveMountedPages } from "../src/components/routing/pageMounting";
import type { Page } from "../src/types";

function mounted(...pages: Page[]) {
  return new Set<Page>(pages);
}

describe("keep-alive mount reconciliation", () => {
  it("settles in one step when signing out from the profile page", () => {
    // The crash: one rule removed the signed-out profile, the other re-added it
    // because it was still the current page, and React gave up with
    // "Too many re-renders".
    const first = resolveMountedPages({
      current: mounted("home", "profile"),
      page: "profile",
      keepAliveDisabled: false,
      isAuthenticated: false,
    });

    expect(Array.from(first)).toEqual(["home"]);

    const second = resolveMountedPages({
      current: first,
      page: "profile",
      keepAliveDisabled: false,
      isAuthenticated: false,
    });

    // Same reference: no further state update, no render loop.
    expect(second).toBe(first);
  });

  it("keeps the profile mounted while the account is signed in", () => {
    const next = resolveMountedPages({
      current: mounted("home"),
      page: "profile",
      keepAliveDisabled: false,
      isAuthenticated: true,
    });

    expect(next.has("profile")).toBe(true);
  });

  it("does not grow the mount set when keep-alive is disabled", () => {
    const current = mounted("home");
    const next = resolveMountedPages({
      current,
      page: "catalogue",
      keepAliveDisabled: true,
      isAuthenticated: true,
    });

    expect(next).toBe(current);
  });

  it("still drops the signed-out profile with keep-alive disabled", () => {
    const next = resolveMountedPages({
      current: mounted("home", "profile"),
      page: "home",
      keepAliveDisabled: true,
      isAuthenticated: false,
    });

    expect(next.has("profile")).toBe(false);
  });

  it("returns the same set when nothing changes", () => {
    const current = mounted("home", "catalogue");
    const next = resolveMountedPages({
      current,
      page: "home",
      keepAliveDisabled: false,
      isAuthenticated: true,
    });

    expect(next).toBe(current);
  });
});

describe("sign-out navigation", () => {
  const routerSource = readFileSync(
    new URL("../src/components/routing/PageRouter.tsx", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );

  it("routes the mount set through the single reconciler", () => {
    expect(routerSource).toContain("resolveMountedPages(");
    expect(routerSource).not.toMatch(/nextMounted\.delete\("profile"\)/);
  });

  it("never renders the profile page to a signed-out user", () => {
    expect(routerSource).toMatch(
      /targetPage === "profile"[\s\S]{0,400}if \(!isAuthenticated\) return null;/,
    );
  });

  it("leaves the profile page for home before the next paint", () => {
    // useEffect would paint one frame of an empty profile before the fallback.
    expect(appSource).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]{0,200}purgePage\("profile"\)/,
    );
  });
});
