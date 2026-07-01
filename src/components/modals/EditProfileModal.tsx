import { ImageUp, Trash2, Camera, Crop } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SteamProfile } from "../../types";
import { useSettings } from "../../context/settings";
import { useCachedImageSources } from "../../hooks/useCachedImageSources";
import { preloadImageSources } from "../../utils/imageCache";
import { profileBannerPlaceholderSource } from "../../utils/image";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

type BannerPosition = NonNullable<SteamProfile["bannerPosition"]>;
type AvatarCropPosition = { x: number; y: number; scale: number };

const defaultBannerPosition: BannerPosition = { x: 50, y: 50, scale: 1 };
const defaultAvatarCropPosition: AvatarCropPosition = { x: 50, y: 50, scale: 1 };

const avatarCropSize = 512;
const bannerMaxWidth = 2800;
const bannerMaxHeight = 1225;
const bannerMaxPixels = 3_430_000;

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

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Avatar image could not be loaded"));
    image.src = source;
  });
}

async function cropAvatarDataUrl(
  source: string,
  type: string,
  position: AvatarCropPosition = defaultAvatarCropPosition
) {
  const image = await loadImage(source);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / position.scale;

  if (!sourceSize) return source;

  const canvas = document.createElement("canvas");
  canvas.width = avatarCropSize;
  canvas.height = avatarCropSize;

  const context = canvas.getContext("2d");
  if (!context) return source;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.drawImage(
    image,
    ((image.naturalWidth - sourceSize) * position.x) / 100,
    ((image.naturalHeight - sourceSize) * position.y) / 100,
    sourceSize,
    sourceSize,
    0,
    0,
    avatarCropSize,
    avatarCropSize
  );

  return canvas.toDataURL(type === "image/png" ? "image/png" : "image/jpeg", 0.92);
}

async function resizeBannerDataUrl(source: string) {
  const image = await loadImage(source);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  if (!width || !height) return source;

  const dimensionScale = Math.min(1, bannerMaxWidth / width, bannerMaxHeight / height);
  const pixelScale = Math.min(1, Math.sqrt(bannerMaxPixels / (width * height)));
  const scale = Math.min(dimensionScale, pixelScale);

  if (scale >= 1) return source;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) return source;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.94);
}

interface EditProfileModalProps {
  open: boolean;
  mode?: "profile" | "cover";
  profile: SteamProfile | null;
  onClose: () => void;
  onSubmit: (displayName: string, avatarUrl: string, bannerUrl: string, bannerPosition: BannerPosition) => void;
}

export function EditProfileModal({
  open,
  mode = "profile",
  profile,
  onClose,
  onSubmit,
}: EditProfileModalProps) {
  const { appearance, t } = useSettings();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState<{ source: string; type: string } | null>(null);
  const [avatarCropPosition, setAvatarCropPosition] = useState<AvatarCropPosition>(defaultAvatarCropPosition);
  const [bannerUrl, setBannerUrl] = useState("");
  const [bannerPosition, setBannerPosition] = useState<BannerPosition>(defaultBannerPosition);
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
  const bannerPreviewSource = bannerUrl.startsWith("data:") ? bannerUrl : bannerSources[0] ?? profileBannerPlaceholderSource;
  const isCoverMode = mode === "cover";
  const isBannerPlaceholder = !bannerUrl;

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.displayName);
      setAvatarUrl(profile.avatarUrl || "");
      setPendingAvatar(null);
      setAvatarCropPosition(defaultAvatarCropPosition);
      setBannerUrl(profile.bannerUrl || "");
      setBannerPosition(normalizeBannerPosition(profile.bannerPosition));
    }
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;

    preloadImageSources([avatarUrl, bannerUrl], {
      limit: 2,
      idle: true,
      decode: true,
    });
  }, [avatarUrl, bannerUrl, open]);

  const handleDisplayNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayName(event.target.value);
    },
    []
  );

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
            setBannerUrl(await resizeBannerDataUrl(source));
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

  const handleAvatarCropCancel = useCallback(() => {
    setPendingAvatar(null);
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, []);

  const handleAvatarCropSave = useCallback(async () => {
    if (!pendingAvatar) return;

    try {
      setAvatarUrl(
        await cropAvatarDataUrl(
          pendingAvatar.source,
          pendingAvatar.type,
          avatarCropPosition
        )
      );
    } catch {
      setAvatarUrl(pendingAvatar.source);
    }

    setPendingAvatar(null);
    setAvatarCropPosition(defaultAvatarCropPosition);
  }, [avatarCropPosition, pendingAvatar]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = displayName.trim();
      if (!trimmedName) return;
      onSubmit(trimmedName, avatarUrl, bannerUrl, bannerPosition);
    },
    [displayName, avatarUrl, bannerUrl, bannerPosition, onSubmit]
  );

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

  if (!open || !profile || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="backdrop backdrop--profile"
      onClick={onClose}
    >
      <form
        className={`collection-modal edit-profile-modal${isCoverMode ? " edit-profile-cover-modal" : ""}${isAvatarCropMode ? " edit-profile-modal--avatar-crop" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={isCoverMode ? "edit-profile-cover-modal-title" : "edit-profile-modal-title"}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
            <header className="collection-modal__header">
              <div>
                <h3 id={isCoverMode ? "edit-profile-cover-modal-title" : "edit-profile-modal-title"}>
                  {isAvatarCropMode
                    ? appearance.language === "en" ? "Crop avatar" : "Recortar avatar"
                    : isCoverMode
                      ? appearance.language === "en" ? "Change cover" : "Mudar capa"
                      : t("profile.editProfile")}
                </h3>
                <p>
                  {isAvatarCropMode
                    ? appearance.language === "en" ? "choose the image framing for your profile avatar." : "escolha o enquadramento da sua foto de perfil."
                    : isCoverMode
                      ? appearance.language === "en" ? "choose the banner shown on your profile." : "escolha a capa exibida no seu perfil."
                      : appearance.language === "en" ? "Customize your GhostBox identity" : "Personalize sua identidade no GhostBox"}
                </p>
              </div>

              <button type="button" className="collection-modal__close" onClick={onClose} aria-label={appearance.language === "en" ? "Close" : "Fechar"}>
                <ModalCloseIcon />
              </button>
            </header>

            <div className="collection-modal__content">
              {isAvatarCropMode && pendingAvatar ? (
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
                    {appearance.language === "en"
                      ? "Drag to reposition and use the mouse wheel to zoom."
                      : "Arraste para reposicionar e use a roda do mouse para aproximar."}
                  </p>
                </div>
              ) : isCoverMode ? (
                <div className="edit-profile-cover-modal__editor">
                  <div
                    className="edit-profile-modal__banner-button edit-profile-cover-modal__preview"
                    onPointerDown={handleBannerPointerDown}
                    onPointerMove={handleBannerPointerMove}
                    onPointerUp={handleBannerPointerEnd}
                    onPointerCancel={handleBannerPointerEnd}
                    onWheel={handleBannerWheel}
                  >
                    {bannerPreviewSource ? (
                      <img
                        className={`edit-profile-cover-modal__preview-image${isBannerPlaceholder ? " edit-profile-cover-modal__preview-image--placeholder" : ""}`}
                        src={bannerPreviewSource}
                        alt=""
                        decoding="async"
                        draggable={false}
                        style={bannerPreviewStyle}
                      />
                    ) : (
                      <div className="edit-profile-modal__banner-placeholder" />
                    )}
                    <div
                      className="edit-profile-cover-modal__preview-actions"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="edit-profile-cover-modal__preview-action"
                        onClick={handleBannerChange}
                      >
                        <ImageUp size={16} aria-hidden="true" />
                        {appearance.language === "en" ? "Change cover" : "Mudar capa"}
                      </button>
                      <button
                        type="button"
                        className="edit-profile-cover-modal__preview-action edit-profile-cover-modal__preview-action--danger"
                        onClick={handleBannerRemove}
                        disabled={isBannerPlaceholder}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {appearance.language === "en" ? "Remove" : "Remover"}
                      </button>
                    </div>
                    <div className="edit-profile-cover-modal__preview-frame" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="edit-profile-modal__avatar-section">
                    <span className="edit-profile-modal__section-title">
                      {appearance.language === "en" ? "Profile avatar" : "Foto de perfil"}
                      <button
                        type="button"
                        className="edit-profile-modal__section-title-action"
                        onClick={handleOpenAvatarCrop}
                        disabled={!avatarUrl}
                        aria-label={
                          appearance.language === "en"
                            ? "Crop current avatar"
                            : "Recortar avatar atual"
                        }
                      >
                        <Crop className="edit-profile-modal__section-title-icon" size={13} aria-hidden="true" />
                      </button>
                    </span>
                    <button
                      type="button"
                      className="edit-profile-modal__avatar-button"
                      onClick={handleAvatarChange}
                    >
                      {avatarPreviewSource ? (
                        <img src={avatarPreviewSource} alt="Avatar" decoding="async" />
                      ) : (
                        <div className="edit-profile-modal__avatar-placeholder" />
                      )}
                      <div className="edit-profile-modal__avatar-overlay">
                        <Camera size={24} />
                      </div>
                    </button>
                  </div>

                  <label className="collection-modal__field">
                    <span>{appearance.language === "en" ? "Display name" : "Nome de exibição"}</span>
                    <input
                      value={displayName}
                      onChange={handleDisplayNameChange}
                      placeholder={appearance.language === "en" ? "Your name" : "Seu nome"}
                      autoFocus
                    />
                  </label>
                </>
              )}

              <div className="collection-modal__actions">
                <button type="button" className="button button--outline" onClick={isAvatarCropMode ? handleAvatarCropCancel : onClose}>
                  {appearance.language === "en" ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type={isAvatarCropMode ? "button" : "submit"}
                  className="button button--outline"
                  disabled={!isAvatarCropMode && !displayName.trim()}
                  onClick={isAvatarCropMode ? handleAvatarCropSave : undefined}
                >
                  {appearance.language === "en" ? "Save" : "Salvar"}
                </button>
              </div>
            </div>
      </form>
    </div>,
    document.body
  );
}
