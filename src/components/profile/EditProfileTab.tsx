import {
  Camera,
  Crop,
  ImageUp,
  SquareArrowOutUpRight,
  Trash,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import { AnimatedAvatarError } from "../../utils/animatedWebp";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import {
  forgetCachedImageSource,
  preloadImageSources,
} from "../../utils/imageCache";
import { profileBannerPlaceholderSource } from "../../utils/image";
import avatarPlaceholder from "../../../Icons/userplaceholder.jpg";
import {
  encodeAvatarDataUrl,
  encodeBannerDataUrl,
} from "../../utils/profileImages";

type BannerPosition = NonNullable<SteamProfile["bannerPosition"]>;
type AvatarCropPosition = { x: number; y: number; scale: number };

const defaultBannerPosition: BannerPosition = { x: 50, y: 50, scale: 1 };
const defaultAvatarCropPosition: AvatarCropPosition = { x: 50, y: 50, scale: 1 };

function clampBannerPosition(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampBannerScale(value: number) {
  return Math.min(3, Math.max(1, Number(value.toFixed(2))));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampAvatarScale(value: number) {
  return Math.min(4, Math.max(1, Number(value.toFixed(2))));
}

function normalizeBannerPosition(position?: SteamProfile["bannerPosition"]): BannerPosition {
  return {
    x: clampBannerPosition(position?.x ?? defaultBannerPosition.x),
    y: clampBannerPosition(position?.y ?? defaultBannerPosition.y),
    scale: clampBannerScale(position?.scale ?? defaultBannerPosition.scale ?? 1),
  };
}

interface EditProfileTabProps {
  profile: SteamProfile | null;
  isPremium: boolean;
  onUpdateProfile: (
    displayName: string,
    avatarUrl: string,
    bannerUrl: string,
    bannerPosition: BannerPosition
  ) => Promise<void> | void;
}

export function EditProfileTab({ profile, isPremium, onUpdateProfile }: EditProfileTabProps) {
  const { appearance, t } = useSettings();
  const { showToast, setSubscriptionModalOpen } = useOverlay();
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const avatarEncodingRef = useRef<AbortController | null>(null);
  const [displayName, setDisplayName] = useState(() => profile?.displayName || "");
  const [avatarUrl, setAvatarUrl] = useState(() => profile?.avatarUrl || "");
  const [pendingAvatar, setPendingAvatar] = useState<{ source: string; type: string } | null>(null);
  const [avatarCropPosition, setAvatarCropPosition] = useState<AvatarCropPosition>(defaultAvatarCropPosition);
  const [isAvatarCropDragging, setIsAvatarCropDragging] = useState(false);
  const [bannerUrl, setBannerUrl] = useState(() => profile?.bannerUrl || "");
  const [failedBannerPreviewSource, setFailedBannerPreviewSource] = useState("");
  const [bannerPosition, setBannerPosition] = useState<BannerPosition>(() =>
    normalizeBannerPosition(profile?.bannerPosition)
  );
  const [isSaving, setIsSaving] = useState(false);

  const avatarDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const bannerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const avatarSources = useCachedImageSources(avatarUrl ? [avatarUrl] : []);
  const bannerSources = useCachedImageSources(bannerUrl ? [bannerUrl] : [profileBannerPlaceholderSource]);
  const avatarPreviewSource = avatarUrl.startsWith("data:") ? avatarUrl : avatarSources[0] ?? avatarUrl;

  const resolvedBannerSource = bannerSources[0];
  const hasResolvedBanner =
    !!resolvedBannerSource && resolvedBannerSource !== profileBannerPlaceholderSource;
  const bannerPreviewSource = bannerUrl
    ? bannerUrl.startsWith("data:")
      ? bannerUrl
      : hasResolvedBanner
        ? resolvedBannerSource
        : bannerUrl
    : resolvedBannerSource ?? profileBannerPlaceholderSource;

  const hasFailedBannerPreview =
    Boolean(failedBannerPreviewSource) &&
    failedBannerPreviewSource === bannerPreviewSource;
  const effectiveBannerPreviewSource = hasFailedBannerPreview
    ? profileBannerPlaceholderSource
    : bannerPreviewSource;
  const isBannerPlaceholder = !bannerUrl || hasFailedBannerPreview;

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setAvatarUrl(profile.avatarUrl || "");
      setBannerUrl(profile.bannerUrl || "");
      setBannerPosition(normalizeBannerPosition(profile.bannerPosition));
    }
  }, [profile]);

  useEffect(() => {
    setFailedBannerPreviewSource("");
  }, [bannerUrl]);

  useEffect(() => {
    preloadImageSources([avatarUrl, bannerUrl], {
      limit: 2,
      idle: true,
      decode: true,
    });
  }, [avatarUrl, bannerUrl]);

  useEffect(() => {
    return () => {
      avatarEncodingRef.current?.abort();
    };
  }, []);

  const handleAvatarChange = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const source = event.target?.result as string;
          setPendingAvatar({ source, type: file.type });
          setAvatarCropPosition(defaultAvatarCropPosition);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, []);

  const handleOpenAvatarCrop = useCallback(() => {
    if (!avatarUrl) return;

    setPendingAvatar({
      source: avatarPreviewSource,
      type: avatarUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg",
    });
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, [avatarUrl, avatarPreviewSource]);

  const handleAvatarCropCancel = useCallback(() => {
    avatarEncodingRef.current?.abort();
    avatarEncodingRef.current = null;
    setIsProcessingAvatar(false);
    setPendingAvatar(null);
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, []);

  const handleAvatarCropSave = useCallback(async () => {
    if (!pendingAvatar || avatarEncodingRef.current) return;
    const controller = new AbortController();
    avatarEncodingRef.current = controller;
    setIsProcessingAvatar(true);
    try {
      const encoded = await encodeAvatarDataUrl(
        pendingAvatar.source, avatarCropPosition, controller.signal,
      );
      if (controller.signal.aborted) return;
      setAvatarUrl(encoded);
      setPendingAvatar(null);
      setAvatarCropPosition(defaultAvatarCropPosition);
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast(t("profile.profileAvatar"), t(
          error instanceof AnimatedAvatarError && error.reason === "tooLarge"
            ? "profile.avatarTooLarge" : "profile.avatarProcessingError",
        ), "error");
      }
    } finally {
      if (avatarEncodingRef.current === controller) {
        avatarEncodingRef.current = null;
        setIsProcessingAvatar(false);
      }
    }
  }, [avatarCropPosition, pendingAvatar, showToast, t]);

  const handleBannerChange = useCallback(async () => {
    if (!isPremium) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const source = event.target?.result as string;
          try {
            setBannerUrl(await encodeBannerDataUrl(source));
          } catch {
            setBannerUrl(source);
          }
          setBannerPosition(defaultBannerPosition);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [isPremium]);

  const handleBannerRemove = useCallback(() => {
    if (!isPremium) return;

    setBannerUrl("");
    setBannerPosition(defaultBannerPosition);
  }, [isPremium]);

  const handleBannerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPremium || isBannerPlaceholder || !bannerPreviewSource) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    bannerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: bannerPosition.x,
      originY: bannerPosition.y,
    };
  }, [bannerPosition.x, bannerPosition.y, bannerPreviewSource, isBannerPlaceholder, isPremium]);

  const handleBannerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPremium) return;

    const drag = bannerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 100;
    setBannerPosition((current) => ({
      ...current,
      x: clampBannerPosition(drag.originX - deltaX),
      y: clampBannerPosition(drag.originY - deltaY),
    }));
  }, [isPremium]);

  const handleBannerPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (bannerDragRef.current?.pointerId === event.pointerId) {
      bannerDragRef.current = null;
    }
  }, []);

  const handleBannerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!isPremium || isBannerPlaceholder || !bannerPreviewSource) return;

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setBannerPosition((current) => ({
      ...current,
      scale: clampBannerScale((current.scale ?? 1) + direction * 0.08),
    }));
  }, [bannerPreviewSource, isBannerPlaceholder, isPremium]);

  const handleAvatarCropPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!pendingAvatar) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsAvatarCropDragging(true);
    avatarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: avatarCropPosition.x,
      originY: avatarCropPosition.y,
    };
  }, [avatarCropPosition.x, avatarCropPosition.y, pendingAvatar]);

  const handleAvatarCropPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = avatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 100;
    setAvatarCropPosition((current) => ({
      ...current,
      x: clampPercent(drag.originX - deltaX / current.scale),
      y: clampPercent(drag.originY - deltaY / current.scale),
    }));
  }, []);

  const handleAvatarCropPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (avatarDragRef.current?.pointerId === event.pointerId) {
      avatarDragRef.current = null;
      setIsAvatarCropDragging(false);
    }
  }, []);

  const handleAvatarCropWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!pendingAvatar) return;

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setAvatarCropPosition((current) => ({
      ...current,
      scale: clampAvatarScale(current.scale + direction * 0.08),
    }));
  }, [pendingAvatar]);

  const handleSave = useCallback(async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    try {
      await onUpdateProfile(trimmedName, avatarUrl, bannerUrl, bannerPosition);
      showToast(t("profile.editProfile"), t("profile.changesSaved"), "success");
    } finally {
      setIsSaving(false);
    }
  }, [avatarUrl, bannerPosition, bannerUrl, displayName, isSaving, onUpdateProfile, showToast, t]);

  const bannerPreviewStyle = bannerPreviewSource && !isBannerPlaceholder
    ? {
        objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
        transform: `scale(${bannerPosition.scale ?? 1})`,
      }
    : undefined;

  const avatarCropImageStyle = pendingAvatar
    ? {
        objectPosition: `${avatarCropPosition.x}% ${avatarCropPosition.y}%`,
        transformOrigin: `${avatarCropPosition.x}% ${avatarCropPosition.y}%`,
        transform: `scale(${avatarCropPosition.scale})`,
      }
    : undefined;

  const isAvatarCropMode = Boolean(pendingAvatar);

  return (
    <div className="profile-page__edit-tab" aria-label={t("profile.editProfile")}>
      {isAvatarCropMode && pendingAvatar ? (
        <section className="profile-page__edit-section profile-page__edit-section--crop">
          <div className="profile-page__edit-section-header">
            <h3>{appearance.language === "en" ? "Crop avatar" : "Recortar avatar"}</h3>
            <p>
              {appearance.language === "en"
                ? "Choose the image framing for your profile avatar."
                : "Escolha o enquadramento da sua foto de perfil."}
            </p>
          </div>

          <div className="edit-profile-modal__avatar-cropper">
              <div
                className={`edit-profile-modal__avatar-crop-stage${
                  isAvatarCropDragging
                    ? " edit-profile-modal__avatar-crop-stage--dragging"
                    : ""
                }`}
                onPointerDown={handleAvatarCropPointerDown}
                onPointerMove={handleAvatarCropPointerMove}
                onPointerUp={handleAvatarCropPointerEnd}
                onPointerCancel={handleAvatarCropPointerEnd}
                onLostPointerCapture={() => setIsAvatarCropDragging(false)}
              onWheel={handleAvatarCropWheel}
            >
              <img
                src={pendingAvatar.source}
                alt=""
                draggable={false}
                style={avatarCropImageStyle}
              />
              <div className="edit-profile-modal__avatar-crop-grid" aria-hidden="true" />
            </div>
            <p className="edit-profile-modal__avatar-crop-help">
              {t("profile.avatarCropHelp")}
            </p>
          </div>

          <div className="profile-page__edit-actions">
            <button
              type="button"
              className="button button--outline"
              onClick={handleAvatarCropCancel}
            >
              {appearance.language === "en" ? "Cancel" : "Cancelar"}
            </button>
            <button
              type="button"
              className="button button--outline"
              onClick={handleAvatarCropSave}
              disabled={isProcessingAvatar}
              aria-busy={isProcessingAvatar}
            >
              {isProcessingAvatar ? t("profile.processingAvatar") : appearance.language === "en" ? "Apply" : "Aplicar"}
            </button>
          </div>
        </section>
      ) : (
        <section className="profile-page__edit-panel">
          <div className="profile-page__edit-section-header">
            <h3>{t("profile.editProfile")}</h3>
            <p>{t("profile.editProfileSubtitle")}</p>
          </div>

          <div className="profile-page__edit-form">
            <div className="profile-page__edit-identity">
              <div className="profile-page__edit-avatar-row">
                <div className="profile-page__edit-avatar-preview">
                  <button
                    type="button"
                    className="profile-page__edit-avatar-btn"
                    onClick={handleAvatarChange}
                    aria-label={t("profile.changeAvatar")}
                  >
                    <img
                      src={avatarPreviewSource || avatarPlaceholder}
                      alt=""
                      decoding="async"
                    />
                    <span className="profile-page__edit-avatar-change-icon" aria-hidden="true">
                      <Camera size={22} />
                    </span>
                  </button>
                  {avatarUrl ? (
                    <button
                      type="button"
                      className="profile-page__edit-avatar-badge"
                      onClick={handleOpenAvatarCrop}
                      aria-label={t("profile.cropAvatar")}
                    >
                      <Crop size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="profile-page__edit-field">
                  <h4>{t("profile.profileAvatar")}</h4>
                  <p>{t("profile.avatarFormatHelp")}</p>
                </div>
              </div>
              <div className="profile-page__edit-field profile-page__edit-name">
                <label htmlFor="profile-display-name">{t("profile.displayName")}</label>
                <input
                  id="profile-display-name"
                  className="profile-page__edit-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("profile.displayNamePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="profile-page__edit-banner-section">
              <div className="profile-page__edit-field">
                <h4>{t("profile.bannerCover")}</h4>
              </div>

              <div
                className={`profile-page__edit-banner-preview${isBannerPlaceholder ? " profile-page__edit-banner-preview--placeholder" : ""}${!isPremium ? " profile-page__edit-banner-preview--locked" : ""}`}
                onPointerDown={handleBannerPointerDown}
                onPointerMove={handleBannerPointerMove}
                onPointerUp={handleBannerPointerEnd}
                onPointerCancel={handleBannerPointerEnd}
                onWheel={handleBannerWheel}
              >
                {effectiveBannerPreviewSource ? (
                  <img
                    className={`edit-profile-cover-modal__preview-image${isBannerPlaceholder ? " edit-profile-cover-modal__preview-image--placeholder" : ""}`}
                    src={effectiveBannerPreviewSource}
                    alt=""
                    decoding="async"
                    draggable={false}
                    style={bannerPreviewStyle}
                    onError={() => {
                      if (
                        !bannerPreviewSource ||
                        bannerPreviewSource === profileBannerPlaceholderSource
                      ) {
                        return;
                      }
                      forgetCachedImageSource(bannerPreviewSource);
                      setFailedBannerPreviewSource(bannerPreviewSource);
                    }}
                  />
                ) : (
                  <div className="edit-profile-modal__banner-placeholder" />
                )}
                <div
                  className="profile-page__edit-banner-overlay"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="button profile-page__edit-banner-overlay-btn"
                    onClick={handleBannerChange}
                    disabled={!isPremium}
                    aria-describedby={!isPremium ? "profile-banner-premium-help" : undefined}
                  >
                    <ImageUp size={18} aria-hidden="true" />
                    <span>{t("profile.changeBanner")}</span>
                  </button>
                  <button
                    type="button"
                    className="button profile-page__edit-banner-overlay-btn profile-page__edit-remove-btn"
                    onClick={handleBannerRemove}
                    disabled={!isPremium || isBannerPlaceholder}
                  >
                    <Trash size={18} aria-hidden="true" />
                    <span>{t("profile.removeBanner")}</span>
                  </button>
                </div>
              </div>
              {!isPremium ? (
                <div className="profile-page__edit-banner-toolbar">
                  <div className="profile-page__edit-banner-actions">
                    <p id="profile-banner-premium-help">
                      {t("profile.bannerPremiumHelp")}{" "}
                      <button
                        type="button"
                        className="profile-page__edit-banner-premium-link"
                        onClick={() => setSubscriptionModalOpen(true)}
                      >
                        <span>{t("profile.bannerPremiumLink")}</span>
                        <SquareArrowOutUpRight size={13} aria-hidden="true" />
                      </button>
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="profile-page__edit-footer">
            <button
              type="button"
              className="button button--primary profile-page__edit-save-btn"
              disabled={!displayName.trim() || isSaving}
              onClick={handleSave}
            >
              <span>{isSaving ? t("profile.saving") : t("profile.saveChanges")}</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
