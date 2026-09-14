import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderInput, Loader2, MonitorDown, Trash2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import {
  readDownloadTasks,
  removeDownloadTask,
  updateInstallPathsForApp,
  type DownloadTask,
} from "../../lib/downloadManager";
import { ghostboxApi } from "../../lib/ghostboxApi";

interface GameActionsMenuProps {
  open: boolean;
  appId: string;
  gameTitle: string;
  game: GhostBoxGame | null;
  trigger: HTMLElement | null;
  onClose: () => void;
  onInstallationChanged?: () => void;
}

export function GameBackupOptionsModal({
  open,
  appId,
  gameTitle,
  game,
  trigger,
  onClose,
  onInstallationChanged,
}: GameActionsMenuProps) {
  const { appearance } = useSettings();
  const { showToast } = useOverlay();
  const [installTask, setInstallTask] = useState<DownloadTask | null>(null);
  const [confirmAction, setConfirmAction] = useState<"move" | "uninstall" | null>(null);
  const [moveTargetRoot, setMoveTargetRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const isEnglish = appearance.language === "en";
  const copy = (pt: string, en: string) => (isEnglish ? en : pt);
  const steamInstallPath = game?.installPath?.trim() ?? "";
  const installationKind = installTask ? "ghostbox" : steamInstallPath ? "steam" : null;

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
    setInstallTask(
      readDownloadTasks().find(
        (task) => task.appId === appId && task.status === "completed",
      ) ?? null,
    );
    setConfirmAction(null);
    setMoveTargetRoot(null);
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
        setMoveTargetRoot(null);
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

  const startMove = async () => {
    if (!installTask || busy) return;
    try {
      const target = await ghostboxApi.selectDownloadsDir();
      if (typeof target !== "string" || !target.trim()) return;
      if (target.trim() === installTask.downloadsRoot.trim()) {
        showToast(
          copy("Mover instalação", "Move installation"),
          copy("A nova pasta é a mesma da instalação atual.", "The selected folder is the same as the current installation folder."),
          "error",
        );
        return;
      }
      setMoveTargetRoot(target);
      setConfirmAction("move");
    } catch {
      // The folder picker was dismissed.
    }
  };

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
      if (confirmAction === "move" && installTask && moveTargetRoot) {
        const outputDir = await ghostboxApi.moveInstallDir(
          installTask.appId,
          installTask.downloadsRoot,
          installTask.outputDir,
          moveTargetRoot,
        );
        updateInstallPathsForApp(installTask.appId, moveTargetRoot, outputDir);
        setInstallTask((current) => current && { ...current, downloadsRoot: moveTargetRoot, outputDir });
        showToast(copy("Mover instalação", "Move installation"), copy("Instalação movida.", "Installation moved."), "success");
      }
      if (confirmAction === "uninstall") {
        if (installTask) {
          await ghostboxApi.deleteDownloadOutputDir(installTask.appId, installTask.downloadsRoot, installTask.outputDir);
          removeDownloadTask(installTask.id);
          setInstallTask(null);
          showToast(copy("Desinstalar", "Uninstall"), copy("Jogo desinstalado.", "Game uninstalled."), "success");
        } else {
          await ghostboxApi.openExternalUrl(`steam://uninstall/${appId}`);
          showToast(copy("Desinstalar", "Uninstall"), copy("Desinstalação aberta na Steam.", "Uninstall opened in Steam."), "info");
        }
      }
      onInstallationChanged?.();
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
        <button type="button" role="menuitem" onClick={() => void startMove()} disabled={installationKind !== "ghostbox" || busy}>
          <FolderInput size={17} aria-hidden="true" />
          {copy("Mover instalação", "Move installation")}
        </button>
        <button type="button" role="menuitem" onClick={() => setConfirmAction("uninstall")} disabled={!installationKind || busy}>
          <Trash2 size={17} aria-hidden="true" />
          {copy("Desinstalar", "Uninstall")}
        </button>
        <span className="game-actions-menu__separator" aria-hidden="true" />
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
                {confirmAction === "move" ? copy("Mover instalação", "Move installation") : copy("Desinstalar jogo", "Uninstall game")}
              </h3>
            </header>
            <div className="confirm-modal__content">
              <p>
                {confirmAction === "move"
                  ? copy(`Mover os arquivos de "${gameTitle}" para ${moveTargetRoot}? Movimentos entre discos diferentes podem demorar.`, `Move "${gameTitle}" files to ${moveTargetRoot}? Cross-drive moves can take a while.`)
                  : installationKind === "steam"
                    ? copy(`A Steam será aberta para desinstalar "${gameTitle}".`, `Steam will open to uninstall "${gameTitle}".`)
                    : copy(`Excluir permanentemente os arquivos instalados de "${gameTitle}"?`, `Permanently delete the installed files for "${gameTitle}"?`)}
              </p>
            </div>
            <div className="confirm-modal__actions">
              <button type="button" className="button button--outline" onClick={() => setConfirmAction(null)} disabled={busy}>
                {copy("Cancelar", "Cancel")}
              </button>
              <button type="button" className={`button ${confirmAction === "uninstall" ? "game-actions-menu__danger" : "button--primary"}`} onClick={() => void confirm()} disabled={busy}>
                {busy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : confirmAction === "move" ? copy("Mover", "Move") : copy("Desinstalar", "Uninstall")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>,
    document.body,
  );
}
