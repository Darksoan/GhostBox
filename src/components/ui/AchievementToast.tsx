import { Trophy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../../context/settings";
import type { AchievementToastState } from "../../context/OverlayContext";

interface AchievementToastProps {
  toast: AchievementToastState;
  onClose: (id: number) => void;
}

export function AchievementToast({ toast, onClose }: AchievementToastProps) {
  const { appearance, notifications } = useSettings();
  const [iconFailed, setIconFailed] = useState(false);
  const closedRef = useRef(false);
  const autoDismissTimerRef = useRef<number | null>(null);

  const handleClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (autoDismissTimerRef.current !== null) {
      window.clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    onClose(toast.id);
  }, [onClose, toast.id]);

  useEffect(() => {
    autoDismissTimerRef.current = window.setTimeout(
      handleClose,
      notifications.toastDurationSeconds * 1000,
    );

    return () => {
      if (autoDismissTimerRef.current !== null) {
        window.clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
    };
  }, [handleClose, notifications.toastDurationSeconds]);

  const showIcon = Boolean(toast.iconUrl) && !iconFailed;

  return (
    <div className="achievement-toast">
      <div className="achievement-toast__content">
        <div className="achievement-toast__media">
          {showIcon ? (
            <img
              className="achievement-toast__icon"
              src={toast.iconUrl}
              alt=""
              onError={() => setIconFailed(true)}
            />
          ) : (
            <span className="achievement-toast__icon achievement-toast__icon--fallback" aria-hidden="true">
              <Trophy size={20} aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="achievement-toast__body">
          <strong className="achievement-toast__title">{toast.title}</strong>
          {toast.description ? (
            <span className="achievement-toast__description">{toast.description}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="achievement-toast__close"
          onClick={handleClose}
          aria-label={appearance.language === "en" ? "Close notification" : "Fechar aviso"}
        >
          <X size={24} strokeWidth={1.25} aria-hidden="true" />
        </button>
      </div>
      <div key={`${toast.id}-${notifications.toastDurationSeconds}`} className="achievement-toast__progress" style={{ animationDuration: `${notifications.toastDurationSeconds}s` }} />
    </div>
  );
}

interface StackProps {
  toasts: AchievementToastState[];
  onDismiss: (id: number) => void;
  offsetBottom?: number;
}

export function AchievementToastStack({ toasts, onDismiss, offsetBottom = 0 }: StackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="achievement-toast-stack"
      aria-live="polite"
      aria-label="Conquistas desbloqueadas"
      style={offsetBottom ? { bottom: `calc(var(--space-8) + ${offsetBottom}px)` } : undefined}
    >
      {toasts.map((item) => (
        <AchievementToast key={item.id} toast={item} onClose={onDismiss} />
      ))}
    </div>
  );
}
