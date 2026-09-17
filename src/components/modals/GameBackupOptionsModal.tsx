import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MonitorDown, Trash2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import { ghostboxApi } from "../../lib/ghostboxApi";

interface GameActionsMenuProps {
  open: boolean;
  appId: string;
  gameTitle: string;
  game: GhostBoxGame | null;
  trigger: HTMLElement | null;
  onClose: () => void;
}

export function GameBackupOptionsModal({
  open,
  appId,
  gameTitle,
  game,
  trigger,
  onClose,
}: GameActionsMenuProps) {
  const { appearance } = useSettings();
  const { showToast } = useOverlay();
  const [confirmAction, setConfirmAction] = useState<"uninstall" | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const isEnglish = appearance.language === "en";
  const copy = (pt: string, en: string) => (isEnglish ? en : pt);
  const isSteamInstalled =
    game?.status === "installed" || game?.librarySource === "steam-installed";

  useLayoutEffect(() => {
    if (!open || !trigger) return;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      setPosition({ left: Math.max(12, rect.right - 244), top: Math.max(12, rect.top - 8) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    setConfirmAction(null);
    setBusy(false);
  }, [appId, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (confirmAction) return;
      if (trigger?.contains(event.target as Node)) return;
      const menu = document.querySelector(".game-actions-menu");
      if (!menu?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy) return;
      if (confirmAction) {
        setConfirmAction(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [busy, confirmAction, onClose, open, trigger]);

  const createDesktopShortcut = async () => {
    if (!game || busy) return;
    setBusy(true);
    try {
      await ghostboxApi.createGameShortcut(game, "desktop");
      showToast(
        copy("Atalho na área de trabalho", "Desktop shortcut"),
        copy("Atalho criado na área de trabalho.", "Desktop shortcut created."),
        "success",
      );
      onClose();
    } catch (error) {
      showToast(
        copy("Atalho na área de trabalho", "Desktop shortcut"),
        error instanceof Error ? error.message : copy("Não foi possível criar o atalho.", "Could not create the shortcut."),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!confirmAction || busy) return;
    setBusy(true);
    try {
      if (confirmAction === "uninstall") {
        await ghostboxApi.openExternalUrl(`steam://uninstall/${appId}`);
        showToast(copy("Desinstalar", "Uninstall"), copy("Desinstalação aberta na Steam.", "Uninstall opened in Steam."), "info");
      }
      setConfirmAction(null);
      onClose();
    } catch (error) {
      showToast(
        copy("Ajustes do jogo", "Game settings"),
        error instanceof Error ? error.message : copy("Não foi possível concluir a ação.", "Could not complete the action."),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="game-actions-menu"
        role="menu"
        aria-label={copy("Ajustes do jogo", "Game settings")}
        style={{ left: position.left, top: position.top }}
      >
        <button type="button" role="menuitem" onClick={() => setConfirmAction("uninstall")} disabled={!isSteamInstalled || busy}>
          <Trash2 size={17} aria-hidden="true" />
          {copy("Desinstalar", "Uninstall")}
        </button>
        <button type="button" role="menuitem" onClick={() => void createDesktopShortcut()} disabled={!game || busy}>
          {busy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : <MonitorDown size={17} aria-hidden="true" />}
          {copy("Criar atalho na área de trabalho", "Create desktop shortcut")}
        </button>
      </div>
      {confirmAction && (
        <div className="backdrop backdrop--profile game-actions-menu__confirm-backdrop">
          <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="game-actions-confirm-title">
            <header className="confirm-modal__header">
              <h3 id="game-actions-confirm-title">
                {copy("Desinstalar jogo", "Uninstall game")}
              </h3>
            </header>
            <div className="confirm-modal__content">
              <p>
                {copy(`A Steam será aberta para desinstalar "${gameTitle}".`, `Steam will open to uninstall "${gameTitle}".`)}
              </p>
            </div>
            <div className="confirm-modal__actions">
              <button type="button" className="button button--outline" onClick={() => setConfirmAction(null)} disabled={busy}>
                {copy("Cancelar", "Cancel")}
              </button>
              <button type="button" className="button game-actions-menu__danger" onClick={() => void confirm()} disabled={busy}>
                {busy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : copy("Desinstalar", "Uninstall")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>,
    document.body,
  );
}
