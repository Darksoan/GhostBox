import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface UninstallConfirmModalProps {
  open: boolean;
  gameTitle: string;
  hasLocalInstall: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UninstallConfirmModal({
  open,
  gameTitle,
  hasLocalInstall,
  onConfirm,
  onCancel,
}: UninstallConfirmModalProps) {
  const { appearance } = useSettings();
  const lang = appearance.language;

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--confirm" onClick={onCancel}>
      <div
        className="collection-modal uninstall-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="uninstall-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collection-modal__header">
          <div>
            <h3 id="uninstall-confirm-title">
              {lang === "en" ? "Remove from library" : "Remover da biblioteca"}
            </h3>
            <p>
              {lang === "en"
                ? `Remove "${gameTitle}" from your library?`
                : `Remover "${gameTitle}" da sua biblioteca?`}
            </p>
          </div>

          <button
            type="button"
            className="collection-modal__close"
            onClick={onCancel}
            aria-label={lang === "en" ? "Close" : "Fechar"}
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="collection-modal__content">
          {hasLocalInstall && (
            <p className="uninstall-confirm-modal__note">
              {lang === "en"
                ? "This game is installed. Removing it from the library will also uninstall its local files."
                : "Este jogo está instalado. Removê-lo da biblioteca também desinstalará os arquivos locais."}
            </p>
          )}

          <div className="collection-modal__actions">
            <button
              type="button"
              className="button button--outline"
              onClick={onCancel}
            >
              {lang === "en" ? "Cancel" : "Cancelar"}
            </button>

            <button
              type="button"
              className="button button--danger"
              onClick={onConfirm}
            >
              <Trash2 size={14} />
              {lang === "en" ? "Remove" : "Remover"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
