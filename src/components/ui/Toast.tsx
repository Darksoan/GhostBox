import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../../context/settings";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../../hooks/useCachedImageSources";

export type ToastVariant = "success" | "error" | "info";

const noImageSources: string[] = [];
const TOAST_EXIT_MS = 220;

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
  const [displayed, setDisplayed] = useState(toast);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const isError = displayed?.variant === "error";
  // A capsule (header) do jogo substitui o check nos toasts de backup bem
  // sucedido; se nenhuma arte carregar, o ícone volta como fallback dentro
  // da mesma caixa, que ocupa espaço desde o primeiro paint (sem reflow).
  const hasCapsule = !isError && Boolean(displayed?.imageSources?.length);
  const capsuleSources = useCachedImageSources(
    hasCapsule && displayed?.imageSources?.length ? displayed.imageSources : noImageSources,
  );
  const { source: capsuleSource } = useLoadableImageCover(capsuleSources);

  useEffect(() => {
    if (toast) {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      setDisplayed(toast);
      setExiting(false);
      return;
    }

    if (displayed && !exiting) {
      setExiting(true);
      exitTimerRef.current = window.setTimeout(() => {
        setDisplayed(null);
        setExiting(false);
      }, TOAST_EXIT_MS);
    }

    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    };
  }, [toast, displayed, exiting]);

  const handleClose = () => {
    if (exiting) return;
    setExiting(true);
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      onClose();
      // displayed será limpo pelo efeito acima quando toast virar null
    }, TOAST_EXIT_MS);
  };

  if (!displayed) return null;

  const isInfo = displayed.variant === "info";
  const variantClass = isError
    ? "toast--error"
    : isInfo
      ? "toast--info"
      : "toast--success";

  return (
    <div className={`toast ${variantClass}${exiting ? " toast--exiting" : ""}`}>
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
          <strong>{displayed.title}</strong>
          {displayed.message && <span>{displayed.message}</span>}
        </div>
        <button type="button" className="toast__close" onClick={handleClose} aria-label={appearance.language === "en" ? "Close notification" : "Fechar aviso"}>
          <X size={18} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
        </button>
      </div>
      <div key={displayed.id} className="toast__progress" />
    </div>
  );
}
