import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NavProfile", () => {
  const source = readFileSync("src/components/layout/NavProfile.tsx", "utf8");

  it("segura o avatar antigo da Steam enquanto o perfil da nuvem restaura", () => {
    expect(source).toContain("shouldHoldSteamAvatar");
    expect(source).toContain("/storage/v1/object/public/profile-images/");
  });

  it("mantém a cadeia de fallback do nome", () => {
    expect(source).toContain("profile?.displayName");
    expect(source).toContain("account?.displayName");
    expect(source).toContain("account?.username");
  });

  it("pré-carrega as imagens no hover e no foco", () => {
    expect(source).toContain("onMouseEnter");
    expect(source).toContain("onFocus");
    expect(source).toContain("preloadProfileImages");
  });
});
