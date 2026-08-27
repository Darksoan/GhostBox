import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveProfileAccess } from "../src/lib/appNavigation";

describe("profile access gate", () => {
  it("lets a signed-in account through", () => {
    expect(resolveProfileAccess("authenticated")).toBe("allow");
  });

  it("holds the click while the stored session is still resolving", () => {
    // The bug: "loading" was folded into "not authenticated", so opening the
    // profile before the session had been read back showed the login modal to
    // someone who never signed out.
    expect(resolveProfileAccess("loading")).toBe("wait");
  });

  it("asks a genuinely signed-out user to sign in", () => {
    expect(resolveProfileAccess("anonymous")).toBe("require-sign-in");
  });
});

describe("App wiring", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  it("routes every profile entry point through the gate", () => {
    expect(appSource).toContain("resolveProfileAccess(status)");
    // The old shape must not creep back in.
    expect(appSource).not.toMatch(/newPage === "profile" && status !== "authenticated"/);
  });

  it("replays the held click once auth settles", () => {
    expect(appSource).toContain("pendingProfileNavigationRef");
  });

  it("only purges the profile history on a real sign-out", () => {
    expect(appSource).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(status !== "anonymous"\) return;\s*purgePage\("profile"\)/,
    );
  });
});
