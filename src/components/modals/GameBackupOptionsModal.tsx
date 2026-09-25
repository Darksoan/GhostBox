import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, FolderOpen, History, Loader2 } from "lucide-react";
import { CloudUpload } from "reicon-react";
import type { GhostBoxGame } from "../../data";
import type { CloudSave } from "../../lib/ghostboxApi.types";
import { useSettings } from "../../context/settings";
import { useAppData } from "../../context/AppDataContext";
import { useOverlay } from "../../context/OverlayContext";
import { ghostboxApi } from "../../lib/ghostboxApi";

function cloudSaveTimestamp(save: CloudSave): number {
  const parsed = Date.parse(save.updatedAt || save.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

const GAME_ACTIONS_MENU_WIDTH = 300;

interface GameActionsMenuProps {
  open: boolean;
  game: GhostBoxGame | null;
  trigger: HTMLElement | null;
  onClose: () => void;
}

export function GameBackupOptionsModal({
  open,
  game,
  trigger,
  onClose,
}: GameActionsMenuProps) {
  const { appearance } = useSettings();
  const { showToast } = useOverlay();
  const { hiddenProfileGameIds, setProfileGameHidden } = useAppData();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [premiumGameId, setPremiumGameId] = useState<string | null>(null);
  const isEnglish = appearance.language === "en";
  const copy = (pt: string, en: string) => (isEnglish ? en : pt);
  const installPath = game?.installPath?.trim() ?? "";
  const isHidden = game ? hiddenProfileGameIds.has(game.appId) : false;
  const busy = backupBusy || folderBusy || restoreBusy;
  const canUseCloudBackups = Boolean(game?.appId && premiumGameId === game.appId);

  useLayoutEffect(() => {
    setPremiumGameId(null);
    if (!open || !game?.appId) return;

    let cancelled = false;
    void (async () => {
      const session = await ghostboxApi.getCloudSession();
      if (!session?.token) return;
      const status = await ghostboxApi.getSubscriptionStatus();
      if (!cancelled && status?.subscription.isPremium) setPremiumGameId(game.appId);
    })().catch(() => undefined);

    return () => { cancelled = true; };
  }, [open, game?.appId]);

  useLayoutEffect(() => {
    if (!open || !trigger) return;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      setPosition({
        left: Math.max(12, Math.min(rect.right - GAME_ACTIONS_MENU_WIDTH, window.innerWidth - GAME_ACTIONS_MENU_WIDTH - 12)),
        top: Math.max(12, rect.top - 8),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (busy) return;
      if (trigger?.contains(event.target as Node)) return;
      const menu = document.querySelector(".game-actions-menu");
      if (!menu?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy) return;
      onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [busy, onClose, open, trigger]);

  const handleOpenFolder = async () => {
    if (!installPath || folderBusy) return;
    setFolderBusy(true);
    try {
      await ghostboxApi.openInstallFolder(installPath);
      onClose();
    } catch (error) {
      showToast(
        copy("Abrir pasta", "Open folder"),
        error instanceof Error ? error.message : copy("Não foi possível abrir a pasta de instalação.", "Could not open the installation folder."),
        "error",
      );
    } finally {
      setFolderBusy(false);
    }
  };

  const handleBackup = async () => {
    if (!game || !canUseCloudBackups || backupBusy) return;
    setBackupBusy(true);
    try {
      const result = await ghostboxApi.backupGameToCloud(game);
      if (!result) {
        showToast(
          copy("Fazer backup", "Back up now"),
          copy("Nenhum save encontrado para backup.", "No saves found to back up."),
          "error",
        );
        return;
      }
      showToast(
        copy("Backup concluído", "Backup complete"),
        copy(`Saves de "${game.title}" enviados para a nuvem.`, `Saves for "${game.title}" uploaded to the cloud.`),
        "success",
      );
      onClose();
    } catch (error) {
      showToast(
        copy("Fazer backup", "Back up now"),
        error instanceof Error ? error.message : copy("Não foi possível concluir o backup.", "Could not complete the backup."),
        "error",
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!game?.appId || !canUseCloudBackups || restoreBusy) return;
    setRestoreBusy(true);
    try {
      const saves = await ghostboxApi.listCloudSaves(game.appId);
      const latestSave = saves.reduce<CloudSave | null>((latest, save) => {
        if (!latest) return save;
        return cloudSaveTimestamp(save) > cloudSaveTimestamp(latest) ? save : latest;
      }, null);
      if (!latestSave) {
        showToast(
          copy("Restaurar backup", "Restore backup"),
          copy("Nenhum backup em nuvem encontrado para este jogo.", "No cloud backups found for this game."),
          "error",
        );
        return;
      }
      const result = await ghostboxApi.restoreCloudSave(game, latestSave.id);
      if (!result?.success) {
        showToast(
          copy("Restaurar backup", "Restore backup"),
          copy("Não foi possível restaurar o backup.", "Could not restore the backup."),
          "error",
        );
        return;
      }
      showToast(
        copy("Backup restaurado", "Backup restored"),
        copy(`Saves de "${game.title}" restaurados.`, `Saves for "${game.title}" restored.`),
        "success",
      );
      onClose();
    } catch (error) {
      showToast(
        copy("Restaurar backup", "Restore backup"),
        error instanceof Error ? error.message : copy("Não foi possível restaurar o backup.", "Could not restore the backup."),
        "error",
      );
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleToggleHidden = () => {
    if (!game?.appId || busy) return;
    setProfileGameHidden(game.appId, !isHidden);
    showToast(
      isHidden
        ? copy("Visível no perfil", "Visible on profile")
        : copy("Ocultado no perfil", "Hidden from profile"),
      isHidden
        ? copy(`"${game.title}" voltará a aparecer no seu perfil.`, `"${game.title}" will appear on your profile again.`)
        : copy(`"${game.title}" não aparecerá mais no seu perfil.`, `"${game.title}" will no longer appear on your profile.`),
      "success",
    );
    onClose();
  };

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="game-actions-menu"
      role="menu"
      aria-label={copy("Ajustes do jogo", "Game settings")}
      style={{ left: position.left, top: position.top }}
    >
      <button type="button" role="menuitem" onClick={() => void handleOpenFolder()} disabled={!installPath || busy}>
        {folderBusy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : <FolderOpen size={17} aria-hidden="true" />}
        {copy("Abrir pasta", "Open folder")}
      </button>
      {canUseCloudBackups && (
        <>
          <button type="button" role="menuitem" onClick={() => void handleBackup()} disabled={busy}>
            {backupBusy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : <CloudUpload size={17} aria-hidden="true" />}
            {copy("Fazer backup", "Back up now")}
          </button>
          <button type="button" role="menuitem" onClick={() => void handleRestore()} disabled={busy}>
            {restoreBusy ? <Loader2 className="game-actions-menu__spinner" size={17} aria-hidden="true" /> : <History size={17} aria-hidden="true" />}
            {copy("Restaurar backup", "Restore backup")}
          </button>
        </>
      )}
      <button type="button" role="menuitem" onClick={handleToggleHidden} disabled={!game?.appId || busy}>
        {isHidden ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
        {isHidden ? copy("Mostrar no perfil", "Show on profile") : copy("Ocultar no perfil", "Hide from profile")}
      </button>
    </div>,
    document.body,
  );
}
