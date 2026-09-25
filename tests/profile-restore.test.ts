import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCloudAvatarToLocal, applyCloudProfileToLocal } from "../src/lib/cloudProfile";
import { isCustomProfileAvatar, mergeSteamProfile } from "../src/lib/steamProfile";
import type { SteamProfile } from "../src/types";

const UPLOADED_AVATAR =
  "https://project.supabase.co/storage/v1/object/public/profile-images/user-1/avatar.webp?v=1";
const UPLOADED_BANNER =
  "https://project.supabase.co/storage/v1/object/public/profile-images/user-1/banner.webp?v=1";
const STEAM_AVATAR =
  "https://avatars.cloudflare.steamstatic.com/abc_full.jpg";

function steamNativeProfile(steamId = "76561198000000000"): SteamProfile {
  return {
    steamId,
    displayName: "Haya",
    avatarUrl: STEAM_AVATAR,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
  };
}

describe("custom profile image detection", () => {
  it("treats uploaded cloud images as custom, not only inline data URLs", () => {
    expect(isCustomProfileAvatar(UPLOADED_AVATAR)).toBe(true);
    expect(isCustomProfileAvatar("data:image/webp;base64,AAAA")).toBe(true);
    expect(isCustomProfileAvatar(STEAM_AVATAR)).toBe(false);
  });

  it("treats non-Steam hosted avatars as custom so the Steam login path keeps them", () => {
    // A cloud avatar saved from outside Steam (e.g. Discord CDN) must survive
    // the native Steam restore exactly like a bucket upload does. Only the
    // Steam login path fetches a native summary before the cloud restore
    // lands, so anything else makes avatar sync depend on the provider used.
    expect(isCustomProfileAvatar("https://cdn.discordapp.com/avatars/1/abc.png?size=256")).toBe(true);
    expect(isCustomProfileAvatar("https://example.com/avatar.png")).toBe(true);
    expect(isCustomProfileAvatar("")).toBe(false);
    expect(isCustomProfileAvatar("https://avatars.akamai.steamstatic.com/abc_full.jpg")).toBe(false);
    expect(isCustomProfileAvatar("https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/abc_full.jpg")).toBe(false);
    expect(isCustomProfileAvatar("https://steamcommunity.com/profiles/1")).toBe(false);
  });
});

describe("mergeSteamProfile", () => {
  it("keeps the cloud avatar and banner when the Steam profile arrives after the cloud restore", () => {
    // The cloud restore produces a profile with an empty steamId: it belongs to
    // the GhostBox account, not to Steam.
    const cloudRestored: SteamProfile = {
      steamId: "",
      displayName: "Haya",
      avatarUrl: UPLOADED_AVATAR,
      bannerUrl: UPLOADED_BANNER,
      bannerPosition: { x: 40, y: 60, scale: 1.5 },
      profileUrl: "",
    };

    const merged = mergeSteamProfile(steamNativeProfile(), cloudRestored);

    expect(merged?.steamId).toBe("76561198000000000");
    expect(merged?.avatarUrl).toBe(UPLOADED_AVATAR);
    expect(merged?.bannerUrl).toBe(UPLOADED_BANNER);
    expect(merged?.bannerPosition).toEqual({ x: 40, y: 60, scale: 1.5 });
  });

  it("keeps the uploaded avatar over the Steam one for the same account", () => {
    const current: SteamProfile = {
      ...steamNativeProfile(),
      avatarUrl: UPLOADED_AVATAR,
      bannerUrl: UPLOADED_BANNER,
    };

    const merged = mergeSteamProfile(steamNativeProfile(), current);

    expect(merged?.avatarUrl).toBe(UPLOADED_AVATAR);
    expect(merged?.bannerUrl).toBe(UPLOADED_BANNER);
  });

  it("keeps a non-Steam hosted cloud avatar over the Steam one", () => {
    // Same account, Discord login path: the cloud avatar points at the Discord
    // CDN. The native Steam restore must not replace it — otherwise the avatar
    // only survives when signing in with the same provider as before.
    const current: SteamProfile = {
      steamId: "",
      displayName: "Haya",
      avatarUrl: "https://cdn.discordapp.com/avatars/1/abc.png?size=256",
      bannerUrl: UPLOADED_BANNER,
      profileUrl: "",
    };

    const merged = mergeSteamProfile(steamNativeProfile(), current);

    expect(merged?.steamId).toBe("76561198000000000");
    expect(merged?.avatarUrl).toBe("https://cdn.discordapp.com/avatars/1/abc.png?size=256");
    expect(merged?.bannerUrl).toBe(UPLOADED_BANNER);
  });

  it("still replaces the profile when another Steam account is linked", () => {
    const current: SteamProfile = {
      ...steamNativeProfile("76561198999999999"),
      avatarUrl: UPLOADED_AVATAR,
      bannerUrl: UPLOADED_BANNER,
    };

    const merged = mergeSteamProfile(steamNativeProfile(), current);

    expect(merged?.avatarUrl).toBe(STEAM_AVATAR);
    expect(merged?.bannerUrl).toBeUndefined();
  });
});

describe("applyCloudProfileToLocal", () => {
  it("does not wipe the current avatar when the snapshot has none stored yet", () => {
    const applied = applyCloudProfileToLocal({
      currentProfile: steamNativeProfile(),
      snapshot: {
        version: 2,
        updatedAt: new Date().toISOString(),
        steamProfile: {
          displayName: "Haya",
          avatarUrl: null,
          bannerUrl: null,
          bannerPosition: null,
        },
        favoriteGameIds: [],
        hiddenProfileGameIds: [],
        userCollections: [],
      },
    });

    expect(applied.steamProfile?.avatarUrl).toBe(STEAM_AVATAR);
  });

  it("applies the stored avatar and banner over the Steam profile", () => {
    const applied = applyCloudProfileToLocal({
      currentProfile: steamNativeProfile(),
      snapshot: {
        version: 2,
        updatedAt: new Date().toISOString(),
        steamProfile: {
          displayName: "Haya",
          avatarUrl: UPLOADED_AVATAR,
          bannerUrl: UPLOADED_BANNER,
          bannerPosition: { x: 50, y: 50, scale: 1 },
        },
        favoriteGameIds: [],
        hiddenProfileGameIds: [],
        userCollections: [],
      },
    });

    expect(applied.steamProfile?.avatarUrl).toBe(UPLOADED_AVATAR);
    expect(applied.steamProfile?.bannerUrl).toBe(UPLOADED_BANNER);
    expect(applied.steamProfile?.steamId).toBe("76561198000000000");
  });
});

describe("free account avatar restore", () => {
  it("restores the avatar without replacing Steam identity or Premium banner", () => {
    const current = {
      ...steamNativeProfile(),
      bannerUrl: UPLOADED_BANNER,
      bannerPosition: { x: 40, y: 60, scale: 1.5 },
    };
    const restored = applyCloudAvatarToLocal(current, UPLOADED_AVATAR);

    expect(restored).toEqual({ ...current, avatarUrl: UPLOADED_AVATAR });
    expect(mergeSteamProfile(steamNativeProfile(), restored)?.avatarUrl).toBe(UPLOADED_AVATAR);
  });

  it("keeps an existing avatar when the account has not saved one yet", () => {
    const current = steamNativeProfile();
    expect(applyCloudAvatarToLocal(current, null)).toBe(current);
    const restored = applyCloudAvatarToLocal(null, UPLOADED_AVATAR);
    expect(restored).toMatchObject({
      steamId: "",
      avatarUrl: UPLOADED_AVATAR,
    });
    expect(restored?.bannerUrl).toBeUndefined();
  });
});

describe("linked Steam account restore", () => {
  it("merges the restored Steam profile instead of overwriting the cloud one", () => {
    // The linked-Steam restore and the cloud-profile restore race on sign-in.
    // Writing the raw Steam profile here dropped the account avatar/banner.
    const source = readFileSync(
      new URL("../src/context/AppDataContext.tsx", import.meta.url),
      "utf8",
    );
    const restoreBlock = source.slice(
      source.indexOf("const restoreLinkedAccount"),
      source.indexOf("void restoreLinkedAccount()"),
    );

    expect(restoreBlock).toContain("mergeSteamProfile(");
    expect(restoreBlock).not.toMatch(/setSteamProfile\(profile\)/);
  });

  it("re-asserts the account cloud profile after the Steam write", () => {
    // The Steam login path writes a native summary to state/disk before the
    // cloud snapshot lands; the Discord path does not. Without re-asserting,
    // whichever order the two restores finish in decides the avatar/banner —
    // i.e. sync works only on the same provider as before.
    const source = readFileSync(
      new URL("../src/context/AppDataContext.tsx", import.meta.url),
      "utf8",
    );
    const restoreBlock = source.slice(
      source.indexOf("const restoreLinkedAccount"),
      source.indexOf("void restoreLinkedAccount()"),
    );

    expect(restoreBlock).toContain("cloudProfileRestoredUserIdRef.current !== restoreAccountId");
    expect(restoreBlock).toContain("void restoreCloudProfileFromRemote()");
  });

  it("scopes the local updatedAt to the signed-in account", () => {
    // The timestamp lives in device-global localStorage. Trusting it for any
    // account lets a stale value (or the login's own Steam-native write) pose
    // as current local state, so the remote avatar/banner is skipped.
    const source = readFileSync(
      new URL("../src/context/AppDataContext.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("cloudProfileLocalUpdatedAtAccountRef");
    expect(source).toContain(
      "cloudProfileLocalUpdatedAtAccountRef.current === accountId"
    );
  });
});

describe("profile placeholder while the cloud syncs", () => {
  it("holds the sidebar avatar skeleton and no username during restore", () => {
    // Reopening the app painted the Steam summary before the account cloud
    // profile landed. While syncing, the sidebar keeps the placeholder and
    // an empty title instead of the provisional Steam data.
    const source = readFileSync(
      new URL("../src/components/layout/Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const isHoldingForCloudSync = Boolean(isCloudProfileRestoring);");
    expect(source).toContain("{identity.loading || isHoldingForCloudSync ? (");
    expect(source).toContain('{isHoldingForCloudSync ? "" : identity.title}');
    expect(source).not.toContain("shouldHoldSteamAvatar");
  });

  it("holds the profile avatar, banner and display name during restore", () => {
    const source = readFileSync(
      new URL("../src/pages/ProfilePage.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const isHoldingForCloudSync = Boolean(isCloudProfileRestoring);");
    expect(source).toContain("{isHoldingForCloudSync ? (");
    expect(source).toContain("const isBannerPlaceholder = !paintedBannerSource || isHoldingForCloudSync;");
    expect(source).toContain("const profileDisplayName = isHoldingForCloudSync");
    expect(source).not.toContain("shouldHoldSteamAvatar");
  });
});
