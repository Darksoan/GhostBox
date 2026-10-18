import { describe, expect, it } from "vitest";
import { normalizeToastDuration, toastDurationOptions } from "../src/utils/toastDuration";

describe("toast display duration", () => {
  it.each(toastDurationOptions)("accepts %s seconds", (seconds) => {
    expect(normalizeToastDuration(seconds)).toBe(seconds);
  });

  it.each([undefined, null, 0, -1, 5, 6000, "10", NaN, {}, true])(
    "defaults invalid or missing saved values (%s) to 6 seconds",
    (value) => {
      expect(normalizeToastDuration(value)).toBe(6);
    },
  );
});
