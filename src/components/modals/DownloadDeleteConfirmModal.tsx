import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface DownloadDeleteConfirmModalProps {
  open: boolean;
  gameTitle: string;
  deleting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DownloadDeleteConfirmModal({
  open,
  gameTitle,
  deleting,
  error,
  onConfirm,
  onCancel,
}: DownloadDeleteConfirmModalProps) {
  const { t } = useSettings();

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--confirm" onClick={deleting ? undefined : onCancel}>
      <div
        className="collection-modal uninstall-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="download-delete-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="collection-modal__header">
          <div>
            <h3 id="download-delete-confirm-title">{t("downloads.remove")}</h3>
            <p>{t("downloads.details.confirmDelete", { title: gameTitle })}</p>
          </div>
          <button
            type="button"
            className="collection-modal__close"
            onClick={onCancel}
            disabled={deleting}
            aria-label={t("downloads.cancel")}
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="collection-modal__content">
          {error && <p className="download-details-modal__error" role="alert">{error}</p>}
          <div className="collection-modal__actions">
            <button type="button" className="button button--outline" onClick={onCancel} disabled={deleting}>
              {t("downloads.cancel")}
            </button>
            <button type="button" className="button button--danger" onClick={onConfirm} disabled={deleting}>
              {deleting ? t("downloads.details.removing") : t("downloads.remove")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
