import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface UninstallConfirmModalProps {
  open: boolean;
  gameTitle: string;
  gameAppId: string;
  waitingForSteam: boolean;
  onConfirm: (uninstall: boolean) => void;
  onCancel: () => void;
}

export function UninstallConfirmModal({
  open,
  gameTitle,
  gameAppId,
  waitingForSteam,
  onConfirm,
  onCancel,
}: UninstallConfirmModalProps) {
  const { appearance } = useSettings();
  const lang = appearance.language;
  const [uninstallSelected, setUninstallSelected] = useState(false);
  const [installCheck, setInstallCheck] = useState<{ appId: string; installed: boolean } | null>(null);

  useEffect(() => {
    setUninstallSelected(false);
    setInstallCheck(null);
    if (!open || waitingForSteam || !gameAppId) return;

    let cancelled = false;
    void ghostboxApi.isSteamGameInstalled(gameAppId)
      .then((installed) => {
        if (!cancelled) setInstallCheck({ appId: gameAppId, installed });
      })
      .catch(() => {
        if (!cancelled) setInstallCheck({ appId: gameAppId, installed: false });
      });

    return () => { cancelled = true; };
  }, [open, waitingForSteam, gameAppId]);

  const canUninstall = !waitingForSteam && installCheck?.appId === gameAppId && installCheck.installed;
  const uninstall = Boolean(canUninstall && uninstallSelected);

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
          {canUninstall && (
            <label className="uninstall-confirm-modal__option">
              <input
                type="checkbox"
                checked={uninstall}
                onChange={(event) => setUninstallSelected(event.target.checked)}
              />
              <span className="uninstall-confirm-modal__option-box" aria-hidden="true">
                <svg viewBox="0 0 10.1668 10.1668" width={12} height={12}>
                  <path d="M1 5.52L3.92 9.17L9.17 1" />
                </svg>
              </span>
              <span>{lang === "en" ? "Remove and uninstall" : "Remover e desinstalar"}</span>
            </label>
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
                className="button button--outline uninstall-confirm-modal__remove"
                onClick={() => onConfirm(uninstall)}
              >
                {lang === "en" ? "Remove" : "Remover"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
