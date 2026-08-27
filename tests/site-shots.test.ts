import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shots } from "../GhostBoxSite/src/content/shots.generated";

const PUBLIC_DIR = join(process.cwd(), "GhostBoxSite", "public");

describe("capturas de tela do launcher", () => {
  it("aponta só para arquivos que existem em public/shots", () => {
    for (const [variant, shot] of Object.entries(shots)) {
      if (!shot) continue;
      for (const url of [shot.src, shot.small]) {
        expect(url, variant).toMatch(/^\/shots\/[a-z]+(@sm)?\.webp$/);
        expect(existsSync(join(PUBLIC_DIR, url.replace(/^\//, ""))), `${variant}: ${url}`).toBe(
          true,
        );
      }
      expect(shot.width, variant).toBeGreaterThan(0);
      expect(shot.height, variant).toBeGreaterThan(0);
    }
  });
});
