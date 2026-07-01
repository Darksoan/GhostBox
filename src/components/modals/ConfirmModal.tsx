import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const { appearance } = useSettings();

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--confirm" onClick={onClose}>
      <section
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-modal__header">
          <h3 id="confirm-modal-title">{title}</h3>

          <button
            type="button"
            className="confirm-modal__close"
            onClick={onClose}
            aria-label={appearance.language === "en" ? "Close" : "Fechar"}
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="confirm-modal__content">
          <p>{description}</p>
        </div>

        <footer className="confirm-modal__actions">
          <button type="button" className="button button--outline" onClick={onClose}>
            {cancelLabel ?? (appearance.language === "en" ? "Cancel" : "Cancelar")}
          </button>
          <button type="button" className="button button--outline confirm-modal__confirm" onClick={onConfirm}>
            {confirmLabel ?? (appearance.language === "en" ? "Delete" : "Excluir")}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
