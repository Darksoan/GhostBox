import { createPortal } from "react-dom";
import { HardDrive, Trash2 } from "lucide-react";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface UninstallConfirmModalProps {
  open: boolean;
  gameTitle: string;
  hasLocalInstall: boolean;
  onRemoveOnly: () => void;
  onRemoveAndUninstall: () => void;
  onCancel: () => void;
}

export function UninstallConfirmModal({
  open,
  gameTitle,
  hasLocalInstall,
  onRemoveOnly,
  onRemoveAndUninstall,
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
                ? "This game has files installed by GhostBox. You can also delete them to free up disk space."
                : "Este jogo possui arquivos instalados pelo GhostBox. Você também pode apagá-los para liberar espaço em disco."}
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
              onClick={onRemoveOnly}
            >
              {hasLocalInstall && <HardDrive size={14} />}
              {hasLocalInstall
                ? lang === "en"
                  ? "Remove only"
                  : "Só remover"
                : lang === "en"
                  ? "Remove"
                  : "Remover"}
            </button>

            {hasLocalInstall && (
              <button
                type="button"
                className="button button--danger"
                onClick={onRemoveAndUninstall}
              >
                <Trash2 size={14} />
                {lang === "en" ? "Remove & uninstall" : "Remover e desinstalar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
