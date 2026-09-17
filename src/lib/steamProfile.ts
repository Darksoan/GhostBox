import type { Language } from "../i18n";
import type { SteamProfile } from "../types";

/** Storage path the worker uploads avatars and banners to. */
const UPLOADED_PROFILE_IMAGE_PATH = "/storage/v1/object/public/profile-images/";

/**
 * A custom image is either still inline (picked, not uploaded yet), already
 * living in the account's profile-images bucket, or hosted outside Steam
 * (e.g. a Discord CDN avatar saved to the cloud profile). Only Steam-hosted
 * images count as Steam ones: treating every uploaded avatar as Steam made
 * the Steam summary win on merge and the account's picture was lost on the
 * next sign-in — and only on the Steam-login path, since only it fetches a
 * native profile before the cloud restore lands.
 */
export function isCustomProfileAvatar(avatarUrl: string) {
  const url = (avatarUrl || "").trim();
  if (!url) return false;
  if (/^data:image\//i.test(url)) return true;
  if (url.includes(UPLOADED_PROFILE_IMAGE_PATH)) return true;
  if (/^https?:\/\//i.test(url)) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const isSteamHost =
        host === "steamstatic.com" ||
        host.endsWith(".steamstatic.com") ||
        host === "steamcommunity.com" ||
        host.endsWith(".steamcommunity.com") ||
        host === "akamaihd.net" ||
        host.endsWith(".akamaihd.net");
      return !isSteamHost;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * The single source of truth for "is Steam linked?".
 *
 * A non-null SteamProfile does NOT mean Steam is connected: restoring the
 * account's cloud profile produces one carrying only the display name, avatar
 * and banner, with an empty steamId. Truthiness checks on the object made
 * Settings claim Steam was connected while the profile page offered to
 * connect it. The steamId is the connection; the object is just the profile.
 */
export function isSteamConnected(profile: SteamProfile | null | undefined) {
  return Boolean(profile?.steamId?.trim());
}

export function mergeSteamProfile(
  nativeProfile: SteamProfile | null,
  currentProfile: SteamProfile | null
): SteamProfile | null {
  if (!nativeProfile) return currentProfile;
  // An empty steamId is not "another account": it is the shell the cloud
  // restore builds for the GhostBox account, carrying the avatar, banner and
  // display name. Only a different *linked* Steam account replaces the profile.
  const isSameAccount =
    !currentProfile?.steamId?.trim() ||
    currentProfile.steamId === nativeProfile.steamId;
  if (!currentProfile || !isSameAccount) {
    return nativeProfile;
  }

  return {
    ...nativeProfile,
    displayName: currentProfile.displayName || nativeProfile.displayName,
    avatarUrl: isCustomProfileAvatar(currentProfile.avatarUrl)
      ? currentProfile.avatarUrl
      : nativeProfile.avatarUrl || currentProfile.avatarUrl,
    bannerUrl: currentProfile.bannerUrl ?? nativeProfile.bannerUrl,
    bannerPosition:
      currentProfile.bannerPosition ?? nativeProfile.bannerPosition,
  };
}

export function formatSteamLoginError(error: unknown, language: Language) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const normalized = message.toLowerCase();

  if (language === "en") {
    if (normalized.includes("cancelled")) {
      return "Steam login was cancelled in the browser.";
    }
    if (normalized.includes("timed out")) {
      return "Steam login timed out. Try again.";
    }
    if (normalized.includes("already in progress")) {
      return "A Steam login is already in progress.";
    }
    if (normalized.includes("openid validation failed")) {
      return "Steam could not validate the login.";
    }
    if (normalized.includes("invalid")) {
      return "Steam returned an invalid profile.";
    }
    return message || "Could not complete Steam login.";
  }

  if (normalized.includes("cancelled") || normalized.includes("cancelado")) {
    return "Login cancelado no navegador.";
  }
  if (normalized.includes("timed out") || normalized.includes("expirou")) {
    return "Login expirou. Tente novamente.";
  }
  if (normalized.includes("already in progress") || normalized.includes("andamento")) {
    return "Já existe um login Steam em andamento.";
  }
  if (normalized.includes("openid validation failed") || normalized.includes("validation failed")) {
    return "A Steam não validou o login.";
  }
  if (normalized.includes("invalid")) {
    return "A Steam retornou um perfil inválido.";
  }

  return message || "Não foi possível concluir o login com a Steam.";
}
