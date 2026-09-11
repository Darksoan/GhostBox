import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSettings } from "../../context/settings";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../../hooks/useCachedImageSources";

export type ToastVariant = "success" | "error" | "info";

const noImageSources: string[] = [];

interface ToastProps {
  toast: {
    id: number;
    title: string;
    message: string;
    variant?: ToastVariant;
    imageSources?: string[];
  } | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const { appearance } = useSettings();
  const isError = toast?.variant === "error";
  // A capsule (header) do jogo substitui o check nos toasts de backup bem
  // sucedido; se nenhuma arte carregar, o ícone volta como fallback dentro
  // da mesma caixa, que ocupa espaço desde o primeiro paint (sem reflow).
  const hasCapsule = !isError && Boolean(toast?.imageSources?.length);
  const capsuleSources = useCachedImageSources(
    hasCapsule && toast?.imageSources?.length ? toast.imageSources : noImageSources,
  );
  const { source: capsuleSource } = useLoadableImageCover(capsuleSources);

  if (!toast) return null;

  const isInfo = toast.variant === "info";
  const variantClass = isError
    ? "toast--error"
    : isInfo
      ? "toast--info"
      : "toast--success";

  return (
    <div className={`toast ${variantClass}`}>
      <div className="toast__content">
        {hasCapsule ? (
          <div className="toast__media">
            {capsuleSource ? (
              <img className="toast__capsule" src={capsuleSource} alt="" />
            ) : (
              <CircleCheck className="toast__icon" size={20} />
            )}
          </div>
        ) : isError ? (
          <CircleAlert className="toast__icon" size={20} />
        ) : isInfo ? (
          <Info className="toast__icon" size={20} />
        ) : (
          <CircleCheck className="toast__icon" size={20} />
        )}
        <div>
          <strong>{toast.title}</strong>
          {toast.message && <span>{toast.message}</span>}
        </div>
        <button type="button" className="toast__close" onClick={onClose} aria-label={appearance.language === "en" ? "Close notification" : "Fechar aviso"}>
          <X size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
        </button>
      </div>
      <div key={toast.id} className="toast__progress" />
    </div>
  );
}
