import {
  Camera,
  Crop,
  ImageUp,
  Trash2,
  Check,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
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
  onUpdateProfile: (
    displayName: string,
    avatarUrl: string,
    bannerUrl: string,
    bannerPosition: BannerPosition
  ) => Promise<void> | void;
}

export function EditProfileTab({ profile, onUpdateProfile }: EditProfileTabProps) {
  const { appearance, t } = useSettings();
  const [displayName, setDisplayName] = useState(() => profile?.displayName || "");
  const [avatarUrl, setAvatarUrl] = useState(() => profile?.avatarUrl || "");
  const [pendingAvatar, setPendingAvatar] = useState<{ source: string; type: string } | null>(null);
  const [avatarCropPosition, setAvatarCropPosition] = useState<AvatarCropPosition>(defaultAvatarCropPosition);
  const [bannerUrl, setBannerUrl] = useState(() => profile?.bannerUrl || "");
  const [failedBannerPreviewSource, setFailedBannerPreviewSource] = useState("");
  const [bannerPosition, setBannerPosition] = useState<BannerPosition>(() =>
    normalizeBannerPosition(profile?.bannerPosition)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
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
      source: avatarUrl,
      type: avatarUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg",
    });
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, [avatarUrl]);

  const handleAvatarCropCancel = useCallback(() => {
    setPendingAvatar(null);
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, []);

  const handleAvatarCropSave = useCallback(async () => {
    if (!pendingAvatar) return;

    try {
      setAvatarUrl(
        await encodeAvatarDataUrl(pendingAvatar.source, avatarCropPosition)
      );
    } catch {
      setAvatarUrl(pendingAvatar.source);
    }

    setPendingAvatar(null);
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, [avatarCropPosition, pendingAvatar]);

  const handleBannerChange = useCallback(async () => {
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
  }, []);

  const handleBannerRemove = useCallback(() => {
    setBannerUrl("");
    setBannerPosition(defaultBannerPosition);
  }, []);

  const handleBannerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isBannerPlaceholder || !bannerPreviewSource) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    bannerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: bannerPosition.x,
      originY: bannerPosition.y,
    };
  }, [bannerPosition.x, bannerPosition.y, bannerPreviewSource, isBannerPlaceholder]);

  const handleBannerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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
  }, []);

  const handleBannerPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (bannerDragRef.current?.pointerId === event.pointerId) {
      bannerDragRef.current = null;
    }
  }, []);

  const handleBannerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (isBannerPlaceholder || !bannerPreviewSource) return;

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setBannerPosition((current) => ({
      ...current,
      scale: clampBannerScale((current.scale ?? 1) + direction * 0.08),
    }));
  }, [bannerPreviewSource, isBannerPlaceholder]);

  const handleAvatarCropPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!pendingAvatar) return;

    event.currentTarget.setPointerCapture(event.pointerId);
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
      setSaveSuccess(true);
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
      saveSuccessTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
      }, 2400);
    } finally {
      setIsSaving(false);
    }
  }, [avatarUrl, bannerPosition, bannerUrl, displayName, isSaving, onUpdateProfile]);

  const bannerPreviewStyle = bannerPreviewSource && !isBannerPlaceholder
    ? {
        objectPosition: `${bannerPosition.x}% ${bannerPosition.y}%`,
        transform: `scale(${bannerPosition.scale ?? 1})`,
      }
    : undefined;

  const avatarCropImageStyle = pendingAvatar
    ? {
        objectPosition: `${avatarCropPosition.x}% ${avatarCropPosition.y}%`,
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
              className="edit-profile-modal__avatar-crop-stage"
              onPointerDown={handleAvatarCropPointerDown}
              onPointerMove={handleAvatarCropPointerMove}
              onPointerUp={handleAvatarCropPointerEnd}
              onPointerCancel={handleAvatarCropPointerEnd}
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
            >
              {appearance.language === "en" ? "Apply" : "Aplicar"}
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
            {/* Display Name */}
            <div className="settings-option">
              <div className="settings-option__copy">
                <div className="settings-option__label">
                  <strong>{t("profile.displayName")}</strong>
                </div>
                <span>
                  {appearance.language === "en"
                    ? "The public name shown on your profile and leaderboards."
                    : "O nome público exibido no seu perfil e classificações."}
                </span>
              </div>
              <div className="settings-option__control">
                <input
                  className="settings-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("profile.displayNamePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Profile Avatar */}
            <div className="settings-option profile-page__edit-avatar-row">
              <div className="settings-option__copy">
                <div className="settings-option__label">
                  <strong>{t("profile.profileAvatar")}</strong>
                </div>
                <span>
                  {appearance.language === "en"
                    ? "Square image (JPG, PNG, GIF). Click the avatar to change it."
                    : "Imagem quadrada (JPG, PNG, GIF). Clique no avatar para alterar."}
                </span>
              </div>
              <div className="settings-option__control profile-page__edit-avatar-control">
                <button
                  type="button"
                  className="edit-profile-modal__avatar-button profile-page__edit-avatar-btn"
                  onClick={handleAvatarChange}
                  aria-label={t("profile.profileAvatar")}
                >
                  <img
                    src={avatarPreviewSource || avatarPlaceholder}
                    alt="Avatar"
                    decoding="async"
                  />
                  <div className="edit-profile-modal__avatar-overlay">
                    <Camera size={20} />
                  </div>
                </button>
                {avatarUrl ? (
                  <button
                    type="button"
                    className="button button--outline profile-page__edit-crop-btn"
                    onClick={handleOpenAvatarCrop}
                    title={t("profile.cropAvatar")}
                    aria-label={t("profile.cropAvatar")}
                  >
                    <Crop size={14} aria-hidden="true" />
                    <span>{t("profile.cropAvatar")}</span>
                  </button>
                ) : null}
              </div>
            </div>

            {/* Banner Cover */}
            <div className="profile-page__edit-banner-section">
              <div className="profile-page__edit-banner-header">
                <div className="settings-option__copy">
                  <div className="settings-option__label">
                    <strong>{t("profile.bannerCover")}</strong>
                  </div>
                  <span>
                    {appearance.language === "en"
                      ? "Drag the preview to adjust position and use mouse wheel to zoom."
                      : "Arraste a prévia para ajustar a posição e use a roda do mouse para aproximar."}
                  </span>
                </div>
                <div className="profile-page__edit-banner-actions">
                  <button
                    type="button"
                    className="button button--outline"
                    onClick={handleBannerChange}
                  >
                    <ImageUp size={15} aria-hidden="true" />
                    <span>{t("profile.changeBanner")}</span>
                  </button>
                  <button
                    type="button"
                    className="button button--outline"
                    onClick={handleBannerRemove}
                    disabled={isBannerPlaceholder}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    <span>{t("profile.removeBanner")}</span>
                  </button>
                </div>
              </div>

              <div
                className="edit-profile-modal__banner-button edit-profile-cover-modal__preview profile-page__edit-banner-preview"
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
                <div className="edit-profile-cover-modal__preview-frame" aria-hidden="true" />
              </div>
            </div>

            {/* Save Actions */}
            <div className="profile-page__edit-footer">
              {saveSuccess && (
                <span className="profile-page__edit-success-tag">
                  <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                  <span>{t("profile.changesSaved")}</span>
                </span>
              )}
              <button
                type="button"
                className="button button--outline profile-page__edit-save-btn"
                disabled={!displayName.trim() || isSaving}
                onClick={handleSave}
              >
                {isSaving ? t("profile.saving") : t("profile.saveChanges")}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
