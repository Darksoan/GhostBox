import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSessionToastEvent } from "../src/lib/authSessionToast";
import { translate } from "../src/i18n";

describe("session toast transitions", () => {
  it("stays quiet while the stored session is being resolved on boot", () => {
    expect(resolveSessionToastEvent("loading", "authenticated")).toBeNull();
    expect(resolveSessionToastEvent("loading", "anonymous")).toBeNull();
  });

  it("announces a sign-in and a sign-out", () => {
    expect(resolveSessionToastEvent("anonymous", "authenticated")).toBe(
      "signed-in",
    );
    expect(resolveSessionToastEvent("authenticated", "anonymous")).toBe(
      "signed-out",
    );
  });

  it("says nothing when the status did not change", () => {
    expect(resolveSessionToastEvent("authenticated", "authenticated")).toBeNull();
    expect(resolveSessionToastEvent("anonymous", "anonymous")).toBeNull();
    expect(resolveSessionToastEvent("anonymous", "loading")).toBeNull();
  });
});

describe("session toast copy", () => {
  const keys = [
    "auth.toast.signedInTitle",
    "auth.toast.signedOutTitle",
    "auth.toast.signedOutMessage",
    "auth.toast.signedInMessageGeneric",
  ];

  it("is translated in both languages", () => {
    for (const key of keys) {
      expect(translate("pt", key)).not.toBe(key);
      expect(translate("en", key)).not.toBe(key);
    }
  });

  it("greets the user by name when the account has one", () => {
    expect(translate("pt", "auth.toast.signedInMessage", { name: "Haya" })).toContain(
      "Haya",
    );
    expect(translate("en", "auth.toast.signedInMessage", { name: "Haya" })).toContain(
      "Haya",
    );
  });

  it("never reads as an error to the toast variant heuristic", () => {
    // getToastVariant infers "error" from the title; these are informational.
    const errorish = /falha|erro|inv[aá]lid|aten[cç][aã]o|indispon|n[aã]o foi poss/i;
    for (const language of ["pt", "en"] as const) {
      expect(translate(language, "auth.toast.signedInTitle")).not.toMatch(errorish);
      expect(translate(language, "auth.toast.signedOutTitle")).not.toMatch(errorish);
    }
  });
});

describe("session toast wiring", () => {
  it("runs inside the always-mounted shell that renders the Toast", () => {
    const appSource = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("useAuthSessionToast()");
    // The Toast itself lives in AppContent; firing from anywhere above the
    // OverlayProvider would show nothing.
    expect(appSource).toMatch(
      /function AppContent[\s\S]*useAuthSessionToast\(\)[\s\S]*<Toast/,
    );
  });
});
