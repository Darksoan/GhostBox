import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useSettings } from "../../context/settings";

export type ToastVariant = "success" | "error";

interface ToastProps {
  toast: { id: number; title: string; message: string; variant?: ToastVariant } | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const { appearance } = useSettings();
  const isError = toast?.variant === "error";
  if (!toast) return null;

  return (
    <div className={`toast ${isError ? "toast--error" : "toast--success"}`}>
      <div className="toast__content">
        {isError ? <CircleAlert className="toast__icon" size={20} /> : <CircleCheck className="toast__icon" size={20} />}
        <div>
          <strong>{toast.title}</strong>
          {toast.message && <span>{toast.message}</span>}
        </div>
        <button type="button" onClick={onClose} aria-label={appearance.language === "en" ? "Close notification" : "Fechar aviso"}>
          <X size={16} />
        </button>
      </div>
      <div key={toast.id} className="toast__progress" />
    </div>
  );
}
