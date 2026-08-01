import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the `tests/` suite. `workers/steam-stats/test/*.mjs` are written
    // against `node:test` and are run by the worker's own runner, not vitest.
    include: ["tests/**/*.test.ts"],
  },
});
