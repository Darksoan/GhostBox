import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface UninstallConfirmModalProps {
  open: boolean;
  gameTitle: string;
  uninstall: boolean;
  waitingForSteam: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UninstallConfirmModal({
  open,
  gameTitle,
  uninstall,
  waitingForSteam,
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
              {waitingForSteam
                ? lang === "en"
                  ? "Waiting for Steam"
                  : "Aguardando a Steam"
                : uninstall
                  ? lang === "en"
                    ? "Remove and uninstall"
                    : "Remover e desinstalar"
                  : lang === "en"
                    ? "Remove from library"
                    : "Remover da biblioteca"}
            </h3>
            <p>
              {waitingForSteam
                ? lang === "en"
                  ? `Finish uninstalling "${gameTitle}" in Steam. It will then be removed from your library.`
                  : `Conclua a desinstalação de "${gameTitle}" na Steam. Depois, o jogo será removido da biblioteca.`
                : lang === "en"
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
          {uninstall && !waitingForSteam && (
            <p className="uninstall-confirm-modal__note">
              {lang === "en"
                ? "Steam will uninstall the game first. It will leave the library only after the uninstall finishes."
                : "A Steam desinstalará o jogo primeiro. Ele só sairá da biblioteca após a desinstalação terminar."}
            </p>
          )}

          <div className="collection-modal__actions">
            <button
              type="button"
              className="button button--outline"
              onClick={onCancel}
            >
              {waitingForSteam
                ? lang === "en"
                  ? "Stop waiting"
                  : "Parar de aguardar"
                : lang === "en"
                  ? "Cancel"
                  : "Cancelar"}
            </button>

            {!waitingForSteam && (
              <button
                type="button"
                className="button button--danger"
                onClick={onConfirm}
              >
                <Trash2 size={14} />
                {uninstall
                  ? lang === "en"
                    ? "Uninstall in Steam"
                    : "Desinstalar pela Steam"
                  : lang === "en"
                    ? "Remove"
                    : "Remover"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
