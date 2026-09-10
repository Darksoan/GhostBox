import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCloudProfileToLocal } from "../src/lib/cloudProfile";
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
});
