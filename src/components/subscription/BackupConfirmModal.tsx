import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

export type BackupConfirmAction = "restore" | "delete";

type BackupConfirmModalProps = {
  action: BackupConfirmAction;
  gameTitle: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BackupConfirmModal({ action, gameTitle, busy, error, onCancel, onConfirm }: BackupConfirmModalProps) {
  const { appearance } = useSettings();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const copy = (pt: string, en: string) => appearance.language === "en" ? en : pt;
  const restoring = action === "restore";

  useEffect(() => {
    cancelRef.current?.focus();
  }, [action, gameTitle]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onCancel();
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--confirm" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="collection-modal cloud-backup-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="cloud-backup-confirm-title"
        aria-describedby="cloud-backup-confirm-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="collection-modal__header">
          <div>
            <h3 id="cloud-backup-confirm-title">
              {restoring ? copy("Restaurar backup", "Restore backup") : copy("Excluir backup", "Delete backup")}
            </h3>
            <p id="cloud-backup-confirm-description">
              {restoring
                ? copy(
                    `Restaurar o backup de "${gameTitle}"? Saves e progresso neste dispositivo podem ser substituídos.`,
                    `Restore the backup for "${gameTitle}"? Local saves and progress may be replaced.`,
                  )
                : copy(
                    `Excluir o backup de "${gameTitle}" da nuvem? Essa ação não pode ser desfeita. Os arquivos locais não serão apagados.`,
                    `Delete the cloud backup for "${gameTitle}"? This cannot be undone. Local files will not be deleted.`,
                  )}
            </p>
          </div>
          <button
            type="button"
            className="collection-modal__close"
            onClick={onCancel}
            aria-label={copy("Fechar", "Close")}
            disabled={busy}
          >
            <ModalCloseIcon />
          </button>
        </header>
        <div className="collection-modal__content">
          {error && <p className="cloud-backup-confirm-modal__error" role="alert">{error}</p>}
          <div className="collection-modal__actions">
            <button ref={cancelRef} type="button" className="button button--outline" onClick={onCancel} disabled={busy}>
              {copy("Cancelar", "Cancel")}
            </button>
            <button
              type="button"
              className={`button button--outline${restoring ? "" : " cloud-backup-confirm-modal__delete"}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy
                ? copy(restoring ? "Restaurando…" : "Excluindo…", restoring ? "Restoring…" : "Deleting…")
                : copy(restoring ? "Restaurar" : "Excluir", restoring ? "Restore" : "Delete")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
