import { memo, useEffect } from "react";
import { UserRound } from "lucide-react";
import type { SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { useAuth } from "../../context/AuthContext";
import {
  useCachedImageSources,
  useLoadableImageSource,
} from "../../hooks/useCachedImageSources";
import { preloadProfileImages } from "../../utils/image";

interface NavProfileProps {
  profile: SteamProfile | null;
  isCloudProfileRestoring: boolean;
  isActive: boolean;
  onOpenProfile: () => void;
  className?: string;
}

export const NavProfile = memo(function NavProfile({
  profile,
  isCloudProfileRestoring,
  isActive,
  onOpenProfile,
  className = "",
}: NavProfileProps) {
  const { appearance } = useSettings();
  const { account } = useAuth();
  const avatarSources = useCachedImageSources(
    profile?.avatarUrl ? [profile.avatarUrl] : []
  );
  const avatarSource = useLoadableImageSource(avatarSources);

  // Enquanto o perfil da nuvem restaura, o avatar antigo da Steam ainda está no
  // ar e trocaria duas vezes: segura no skeleton até a fonte final chegar.
  const shouldHoldSteamAvatar = Boolean(
    isCloudProfileRestoring &&
      profile?.avatarUrl &&
      !profile.avatarUrl.startsWith("data:") &&
      !profile.avatarUrl.includes("/storage/v1/object/public/profile-images/")
  );

  useEffect(() => {
    preloadProfileImages(profile);
  }, [profile?.avatarUrl, profile?.bannerUrl]);

  const displayName =
    profile?.displayName ||
    account?.displayName ||
    account?.username ||
    (appearance.language === "en" ? "Log in" : "Faça login");

  return (
    <button
      type="button"
      className={`nav-profile${isActive ? " nav-profile--active" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onOpenProfile}
      onMouseEnter={() => profile && preloadProfileImages(profile)}
      onFocus={() => profile && preloadProfileImages(profile)}
    >
      <span className="nav-profile__avatar" aria-hidden="true">
        {shouldHoldSteamAvatar || (isCloudProfileRestoring && !avatarSource) ? (
          <span className="nav-profile__avatar-skeleton" />
        ) : avatarSource ? (
          <img
            src={avatarSource}
            alt=""
            width={28}
            height={28}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserRound size={16} />
        )}
      </span>
      <span className="nav-profile__name">{displayName}</span>
    </button>
  );
});
