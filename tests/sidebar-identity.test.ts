import { describe, expect, it } from "vitest";
import { resolveSidebarIdentity } from "../src/lib/sidebarIdentity";
import type { AccountConnection, GhostBoxAccount } from "../src/lib/ghostboxApi.types";
import type { SteamProfile } from "../src/types";

const account: GhostBoxAccount = {
  userId: "user_1",
  email: "ghost@example.com",
  username: "ghostbox-user",
  displayName: null,
  emailVerified: true,
  verifiedVia: "discord",
};

const discord: AccountConnection = {
  provider: "discord",
  providerId: "discord_1",
  metadata: {
    username: "discord-user",
    globalName: "Discord User",
    avatarUrl: "https://cdn.discordapp.com/avatar.png",
  },
  linkedAt: "2026-01-01T00:00:00.000Z",
};

const steam: AccountConnection = {
  provider: "steam",
  providerId: "steam_1",
  metadata: {
    displayName: "Steam User",
    avatarUrl: "https://steam.example/avatar.jpg",
  },
  linkedAt: "2026-01-01T00:00:00.000Z",
};

const labels = {
  anonymousLabel: "Fazer login",
  loadingLabel: "Carregando conta…",
  accountLabel: "Conta GhostBox",
};

describe("sidebar identity", () => {
  it("shows login only to an anonymous user", () => {
    expect(resolveSidebarIdentity({
      ...labels,
      status: "anonymous",
      account: null,
      connections: [],
      authenticatedVia: null,
      profile: null,
    }).title).toBe("Fazer login");

    expect(resolveSidebarIdentity({
      ...labels,
      status: "authenticated",
      account: null,
      connections: [],
      authenticatedVia: "discord",
      profile: null,
    }).title).toBe("Conta GhostBox");
  });

  it("keeps the loading state distinct from logout", () => {
    expect(resolveSidebarIdentity({
      ...labels,
      status: "loading",
      account: null,
      connections: [],
      authenticatedVia: null,
      profile: null,
    })).toEqual({ title: "Carregando conta…", avatarUrl: "", loading: true });
  });

  it("uses the current Discord identity before the account username", () => {
    expect(resolveSidebarIdentity({
      ...labels,
      status: "authenticated",
      account,
      connections: [discord],
      authenticatedVia: "discord",
      profile: null,
    })).toMatchObject({
      title: "Discord User",
      avatarUrl: "https://cdn.discordapp.com/avatar.png",
    });
  });

  it("prefers the provider used for this login when multiple are linked", () => {
    expect(resolveSidebarIdentity({
      ...labels,
      status: "authenticated",
      account,
      connections: [discord, steam],
      authenticatedVia: "steam",
      profile: null,
    })).toMatchObject({
      title: "Steam User",
      avatarUrl: "https://steam.example/avatar.jpg",
    });
  });

  it("keeps the customized GhostBox profile above provider identity", () => {
    const profile: SteamProfile = {
      steamId: "steam_1",
      displayName: "Meu perfil",
      avatarUrl: "data:image/png;base64,custom",
      profileUrl: "",
    };
    expect(resolveSidebarIdentity({
      ...labels,
      status: "authenticated",
      account,
      connections: [discord],
      authenticatedVia: "discord",
      profile,
    })).toMatchObject({
      title: "Meu perfil",
      avatarUrl: "data:image/png;base64,custom",
    });
  });
});
