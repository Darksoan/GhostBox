import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  Check,
  FolderInput,
  FolderOpen,
  Loader2,
  Trash2,
} from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";
import {
  readDownloadTasks,
  removeDownloadTask,
  updateInstallPathsForApp,
  type DownloadTask,
} from "../../lib/downloadManager";
import { ghostboxApi } from "../../lib/ghostboxApi";

interface BackupOptionsModalProps {
  open: boolean;
  appId: string;
  gameId: string;
  gameTitle: string;
  game: GhostBoxGame | null;
  customExePath: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
  onSetCustomExe?: (customExePath: string) => Promise<GhostBoxGame | null>;
  onInstallationChanged?: () => void;
}

type SettingsSection = "organization" | "custom-exe" | "installation";

export function GameBackupOptionsModal({
  open,
  appId,
  gameId,
  gameTitle,
  game,
  customExePath,
  userCollections,
  onClose,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  onSetCustomExe,
  onInstallationChanged,
}: BackupOptionsModalProps) {
  const { appearance } = useSettings();
  const modalRef = useRef<HTMLFormElement>(null);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isSavingCollections, setIsSavingCollections] = useState(false);
  const [confirmUninstallOpen, setConfirmUninstallOpen] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);
  const [moveTargetRoot, setMoveTargetRoot] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [customExeBusy, setCustomExeBusy] = useState(false);
  const [customExeError, setCustomExeError] = useState("");
  const [customExeMessage, setCustomExeMessage] = useState("");
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("organization");
  const language = appearance.language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);
  const currentCollectionIds = useMemo(
    () =>
      new Set(
        userCollections
          .filter((collection) => collection.gameIds.includes(gameId))
          .map((collection) => collection.id),
      ),
    [gameId, userCollections],
  );
  const collectionCount = currentCollectionIds.size;

  const installTask = useMemo<DownloadTask | null>(() => {
    if (!open || !appId) return null;
    return (
      readDownloadTasks().find(
        (task) => task.appId === appId && task.status === "completed",
      ) ?? null
    );
  }, [open, appId]);

  useEffect(() => {
    if (!open) return;
    setIsCollectionPickerOpen(false);
    setIsSavingCollections(false);
    setDraftCollectionIds(currentCollectionIds);
    setConfirmUninstallOpen(false);
    setUninstallBusy(false);
    setMoveConfirmOpen(false);
    setMoveTargetRoot(null);
    setMoveBusy(false);
    setActionError("");
    setActionMessage("");
    setCustomExeBusy(false);
    setCustomExeError("");
    setCustomExeMessage("");
    setActiveSection("organization");
  }, [currentCollectionIds, open]);

  const collectionSummary = !userCollections.length
    ? copy("Crie uma coleção primeiro.", "Create a collection first.")
    : collectionCount === 0
      ? copy(
          "Este jogo ainda não está em nenhuma coleção.",
          "This game is not in any collection yet.",
        )
      : collectionCount === 1
        ? copy("Em 1 coleção.", "In 1 collection.")
        : copy(
            `Em ${collectionCount} coleções.`,
            `In ${collectionCount} collections.`,
          );

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmUninstallOpen) {
        if (uninstallBusy) return;
        setConfirmUninstallOpen(false);
        return;
      }
      if (moveConfirmOpen) {
        if (moveBusy) return;
        setMoveConfirmOpen(false);
        setMoveTargetRoot(null);
        return;
      }
      if (isCollectionPickerOpen) {
        if (isSavingCollections) return;
        setIsCollectionPickerOpen(false);
        return;
      }
      onClose();
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (confirmUninstallOpen || moveConfirmOpen || isCollectionPickerOpen) {
        return;
      }
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [
    open,
    onClose,
    isCollectionPickerOpen,
    isSavingCollections,
    confirmUninstallOpen,
    uninstallBusy,
    moveConfirmOpen,
    moveBusy,
  ]);

  if (!open || typeof document === "undefined") return null;

  const startMove = async () => {
    setActionError("");
    setActionMessage("");
    try {
      const target = await ghostboxApi.selectDownloadsDir();
      if (typeof target !== "string" || !target.trim()) return;
      if (installTask && target.trim() === installTask.downloadsRoot.trim()) {
        setActionError(
          copy(
            "A nova pasta é a mesma da instalação atual.",
            "The selected folder is the same as the current installation folder.",
          ),
        );
        return;
      }
      setMoveTargetRoot(target);
      setMoveConfirmOpen(true);
    } catch {
      // user dismissed dialog
    }
  };

  const confirmMove = async () => {
    if (!installTask || !moveTargetRoot || moveBusy) return;
    setMoveBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const newOutput = await ghostboxApi.moveInstallDir(
        installTask.appId,
        installTask.downloadsRoot,
        installTask.outputDir,
        moveTargetRoot,
      );
      updateInstallPathsForApp(installTask.appId, moveTargetRoot, newOutput);
      setActionMessage(
        copy("Instalação movida.", "Installation moved."),
      );
      setMoveConfirmOpen(false);
      setMoveTargetRoot(null);
      onInstallationChanged?.();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : copy("Falha ao mover.", "Move failed."),
      );
    } finally {
      setMoveBusy(false);
    }
  };

  const confirmUninstall = async () => {
    if (!installTask || uninstallBusy) return;
    setUninstallBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      await ghostboxApi.deleteDownloadOutputDir(
        installTask.appId,
        installTask.downloadsRoot,
        installTask.outputDir,
      );
      removeDownloadTask(installTask.id);
      setActionMessage(copy("Jogo desinstalado.", "Game uninstalled."));
      setConfirmUninstallOpen(false);
      onInstallationChanged?.();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : copy("Falha ao desinstalar.", "Uninstall failed."),
      );
    } finally {
      setUninstallBusy(false);
    }
  };

  const chooseCustomExe = async () => {
    if (!game || customExeBusy || !onSetCustomExe) return;
    setCustomExeError("");
    setCustomExeMessage("");
    try {
      const picked = await ghostboxApi.selectExeFile();
      if (typeof picked !== "string" || !picked.trim()) return;
      setCustomExeBusy(true);
      await onSetCustomExe(picked);
      setCustomExeMessage(
        copy(
          "Executável personalizado definido. O jogo iniciará a partir dele.",
          "Custom executable set. The game will launch from it.",
        ),
      );
    } catch (error) {
      setCustomExeError(
        error instanceof Error
          ? error.message
          : copy("Falha ao definir executável.", "Could not set the executable."),
      );
    } finally {
      setCustomExeBusy(false);
    }
  };

  const clearCustomExe = async () => {
    if (!game || customExeBusy || !onSetCustomExe) return;
    setCustomExeError("");
    setCustomExeMessage("");
    setCustomExeBusy(true);
    try {
      await onSetCustomExe("");
      setCustomExeMessage(
        copy(
          "Override removido. O jogo volta a iniciar pela Steam.",
          "Override cleared. The game will launch via Steam again.",
        ),
      );
    } catch (error) {
      setCustomExeError(
        error instanceof Error
          ? error.message
          : copy("Falha ao remover override.", "Could not remove the override."),
      );
    } finally {
      setCustomExeBusy(false);
    }
  };

  return createPortal(
    <div className="backdrop backdrop--profile" onClick={onClose}>
      <form
        className="game-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-backup-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => event.preventDefault()}
        ref={modalRef}
      >
        <h2 id="game-backup-modal-title" className="sr-only">
          {appearance.language === "en"
            ? `Game settings for ${gameTitle}`
            : `Ajustes de ${gameTitle}`}
        </h2>

        <aside
          className="game-settings-modal__rail"
          aria-label={
            appearance.language === "en" ? "Game settings" : "Ajustes do jogo"
          }
        >
          <button
            type="button"
            className={`game-settings-modal__rail-button ${activeSection === "organization" ? "game-settings-modal__rail-button--active" : ""}`}
            onClick={() => setActiveSection("organization")}
            aria-label={appearance.language === "en" ? "Collections" : "Coleções"}
            aria-current={activeSection === "organization" ? "page" : undefined}
          >
            <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`game-settings-modal__rail-button ${activeSection === "custom-exe" ? "game-settings-modal__rail-button--active" : ""}`}
            onClick={() => setActiveSection("custom-exe")}
            aria-label={
              appearance.language === "en"
                ? "Custom executable"
                : "Executável personalizado"
            }
            aria-current={activeSection === "custom-exe" ? "page" : undefined}
          >
            <FolderInput size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`game-settings-modal__rail-button ${activeSection === "installation" ? "game-settings-modal__rail-button--active" : ""}`}
            onClick={() => setActiveSection("installation")}
            aria-label={appearance.language === "en" ? "Installation" : "Instalação"}
            aria-current={activeSection === "installation" ? "page" : undefined}
          >
            <ArrowDownToLine size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </aside>

        <div className="game-settings-modal__body">
          <div className="game-settings-modal__rows">
            {activeSection === "organization" && (
            <section
              className={`game-settings-modal__row ${!userCollections.length ? "game-settings-modal__row--disabled" : ""}`}
            >
              <div className="game-settings-modal__row-copy">
                <strong>
                  {appearance.language === "en" ? "Collections" : "Coleções"}
                </strong>
                <span>{collectionSummary}</span>
              </div>
              <button
                type="button"
                className="game-settings-modal__action-button"
                onClick={() => {
                  setDraftCollectionIds(currentCollectionIds);
                  setIsCollectionPickerOpen(true);
                }}
                disabled={!userCollections.length}
              >
                {appearance.language === "en" ? "Manage" : "Gerenciar"}
              </button>
            </section>
            )}

            {activeSection === "custom-exe" && (
            <section
              className={`game-settings-modal__row ${customExeBusy || !game || !onSetCustomExe ? "game-settings-modal__row--disabled" : ""}`}
            >
              <div className="game-settings-modal__row-copy">
                <strong>
                  {appearance.language === "en"
                    ? "Custom executable"
                    : "Executável personalizado"}
                </strong>
                <span
                  className="game-settings-modal__path"
                  title={customExePath || undefined}
                >
                  {customExePath
                    ? customExePath
                    : appearance.language === "en"
                      ? "Launching via Steam."
                      : "Iniciando pela Steam."}
                </span>
              </div>
              <div className="game-settings-modal__actions">
                <button
                  type="button"
                  className="game-settings-modal__action-button"
                  onClick={() => void chooseCustomExe()}
                  disabled={customExeBusy || !game || !onSetCustomExe}
                >
                  {customExeBusy && (
                    <Loader2 size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                  {appearance.language === "en"
                    ? customExePath
                      ? "Change"
                      : "Choose .exe"
                    : customExePath
                      ? "Trocar"
                      : "Escolher .exe"}
                </button>
                {customExePath && (
                  <button
                    type="button"
                    className="game-settings-modal__action-button game-settings-modal__action-button--danger"
                    onClick={() => void clearCustomExe()}
                    disabled={customExeBusy}
                  >
                    {appearance.language === "en" ? "Reset" : "Remover"}
                  </button>
                )}
              </div>
            </section>
            )}

            {activeSection === "installation" && (
            <section
              className={`game-settings-modal__row ${!installTask || moveBusy || uninstallBusy ? "game-settings-modal__row--disabled" : ""}`}
            >
              <div className="game-settings-modal__row-copy">
                <strong>
                  {appearance.language === "en"
                    ? "Installation"
                    : "Instalação"}
                </strong>
                <span
                  className="game-settings-modal__path"
                  title={installTask?.outputDir || undefined}
                >
                  {installTask?.outputDir ||
                    (appearance.language === "en"
                      ? "No local installation."
                      : "Nenhuma instalação local.")}
                </span>
              </div>
              <div className="game-settings-modal__actions">
                <button
                  type="button"
                  className="game-settings-modal__action-button"
                  onClick={() => void startMove()}
                  disabled={!installTask || moveBusy || uninstallBusy}
                >
                  <FolderInput size={14} strokeWidth={2} aria-hidden="true" />
                  {appearance.language === "en" ? "Move" : "Mover"}
                </button>
                <button
                  type="button"
                  className="game-settings-modal__action-button game-settings-modal__action-button--danger"
                  onClick={() => setConfirmUninstallOpen(true)}
                  disabled={!installTask || moveBusy || uninstallBusy}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                  {appearance.language === "en" ? "Uninstall" : "Desinstalar"}
                </button>
              </div>
            </section>
            )}
          </div>

          {((activeSection === "custom-exe" &&
            (customExeMessage || customExeError)) ||
            (activeSection === "installation" &&
              (actionMessage || actionError))) && (
            <div className="game-settings-modal__feedback" aria-live="polite">
              {activeSection === "custom-exe" && customExeMessage && (
                <span>{customExeMessage}</span>
              )}
              {activeSection === "custom-exe" && customExeError && (
                <span role="alert">{customExeError}</span>
              )}
              {activeSection === "installation" && actionMessage && (
                <span>{actionMessage}</span>
              )}
              {activeSection === "installation" && actionError && (
                <span role="alert">{actionError}</span>
              )}
            </div>
          )}

          {confirmUninstallOpen && (
            <section
              className="confirm-modal game-settings-modal__confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="game-uninstall-confirm-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="confirm-modal__header">
                <h3 id="game-uninstall-confirm-title">
                  {appearance.language === "en" ? "Uninstall game" : "Desinstalar jogo"}
                </h3>
              </header>
              <div className="confirm-modal__content">
                <p>
                  {copy(
                    `Excluir permanentemente os arquivos instalados de "${gameTitle}"? A entrada na biblioteca não é removida.`,
                    `Permanently delete the installed files for "${gameTitle}"? The library entry is not removed.`,
                  )}
                </p>
                {actionError && <p role="alert">{actionError}</p>}
              </div>
              <div className="confirm-modal__actions">
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => setConfirmUninstallOpen(false)}
                  disabled={uninstallBusy}
                  autoFocus
                >
                  {appearance.language === "en" ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type="button"
                  className="button game-settings-modal__confirm-danger"
                  onClick={() => void confirmUninstall()}
                  disabled={uninstallBusy}
                >
                  {appearance.language === "en" ? "Uninstall" : "Desinstalar"}
                </button>
              </div>
            </section>
          )}

          {moveConfirmOpen && installTask && (
            <section
              className="confirm-modal game-settings-modal__confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="game-move-confirm-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="confirm-modal__header">
                <h3 id="game-move-confirm-title">
                  {appearance.language === "en" ? "Move installation" : "Mover instalação"}
                </h3>
              </header>
              <div className="confirm-modal__content">
                <p>
                  {copy(
                    `Mover os arquivos de "${gameTitle}" para ${moveTargetRoot}? Movimentos entre discos diferentes copiam antes de apagar — pode demorar.`,
                    `Move "${gameTitle}" files to ${moveTargetRoot}? Cross-drive moves copy first then delete — it can take a while.`,
                  )}
                </p>
                {actionError && <p role="alert">{actionError}</p>}
              </div>
              <div className="confirm-modal__actions">
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => {
                    setMoveConfirmOpen(false);
                    setMoveTargetRoot(null);
                  }}
                  disabled={moveBusy}
                  autoFocus
                >
                  {appearance.language === "en" ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type="button"
                  className="button confirm-modal__confirm"
                  onClick={() => void confirmMove()}
                  disabled={moveBusy}
                >
                  {appearance.language === "en" ? "Move" : "Mover"}
                </button>
              </div>
            </section>
          )}
        </div>

        {isCollectionPickerOpen && (
          <div
            className="modal__collection-picker-backdrop"
            onClick={() => {
              if (isSavingCollections) return;
              setIsCollectionPickerOpen(false);
            }}
          >
            <div
              className="modal__collection-picker"
              role="dialog"
              aria-modal="true"
              aria-labelledby="game-collection-picker-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="modal__collection-picker-header">
                <div>
                  <h4 id="game-collection-picker-title">
                    {appearance.language === "en"
                      ? "Choose collections"
                      : "Escolher coleções"}
                  </h4>
                  <span>{gameTitle}</span>
                </div>
              </header>

              <div className="modal__collection-picker-list">
                {userCollections.map((collection) => {
                  const checked = draftCollectionIds.has(collection.id);
                  return (
                    <label
                      key={collection.id}
                      className="catalogue-filter-option modal__collection-picker-option"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSavingCollections}
                        onChange={() => {
                          setDraftCollectionIds((current) => {
                            const next = new Set(current);
                            if (next.has(collection.id))
                              next.delete(collection.id);
                            else next.add(collection.id);
                            return next;
                          });
                        }}
                      />
                      <span className="catalogue-filter-option__box">
                        {checked && <Check size={12} strokeWidth={2.0} />}
                      </span>
                      <span>{collection.name}</span>
                    </label>
                  );
                })}
              </div>

              <footer className="modal__collection-picker-actions">
                <button
                  type="button"
                  className="button button--outline"
                  disabled={isSavingCollections}
                  onClick={() => setIsCollectionPickerOpen(false)}
                >
                  {appearance.language === "en" ? "Cancel" : "Cancelar"}
                </button>
                <button
                  type="button"
                  className="button button--save"
                  disabled={isSavingCollections}
                  onClick={async () => {
                    const addedIds = [...draftCollectionIds].filter(
                      (collectionId) => !currentCollectionIds.has(collectionId),
                    );
                    const removedIds = [...currentCollectionIds].filter(
                      (collectionId) => !draftCollectionIds.has(collectionId),
                    );

                    setIsSavingCollections(true);
                    try {
                      for (const collectionId of removedIds) {
                        await onRemoveGameFromCollection(collectionId);
                      }
                      for (const collectionId of addedIds) {
                        await onAddGameToCollection(collectionId);
                      }
                      setIsCollectionPickerOpen(false);
                    } finally {
                      setIsSavingCollections(false);
                    }
                  }}
                >
                  {isSavingCollections && (
                    <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                  )}
                  {appearance.language === "en" ? "Save" : "Salvar"}
                </button>
              </footer>
            </div>
          </div>
        )}
      </form>
    </div>,
    document.body,
  );
}
