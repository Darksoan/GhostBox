import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  FolderInput,
  FolderOpen,
  HardDrive,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { formatBytes } from "../../utils/formatBytes";
import {
  gameHeaderOnlySources,
  highDensityHeaderSources,
  layeredImageStyle,
} from "../../utils/image";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";
import {
  useCachedImageSources,
  useLoadableImageCover,
} from "../../hooks/useCachedImageSources";
import {
  readDownloadTasks,
  removeDownloadTask,
  updateInstallPathsForApp,
  type DownloadTask,
} from "../../lib/downloadManager";
import { ghostboxApi } from "../../lib/ghostboxApi";

const emptyImageSources: string[] = [];

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
  // O `header_2x` vem primeiro: `gameHeaderOnlySources` começa no `header.jpg`
  // de 460px, que seria ampliado no hero de 560px.
  const headerSources = useMemo(
    () =>
      game
        ? [...highDensityHeaderSources(appId), ...gameHeaderOnlySources(game)]
        : emptyImageSources,
    [appId, game],
  );
  const cachedHeaderSources = useCachedImageSources(headerSources);
  const { source: heroSource, loaded: heroLoaded } = useLoadableImageCover(
    cachedHeaderSources,
    { preferOrder: true },
  );
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

  const activeCollections = userCollections.filter((collection) =>
    currentCollectionIds.has(collection.id),
  );

  // Linha de apoio da instalação: tamanho e data só entram quando a task tem o
  // dado; sem eles a frase vira um fato neutro em vez de "0 B · Invalid Date".
  const installFacts = [
    installTask?.bytesTotal ? formatBytes(installTask.bytesTotal) : "",
    installTask?.finishedAt
      ? new Date(installTask.finishedAt).toLocaleDateString(
          language === "en" ? "en-US" : "pt-BR",
          { day: "2-digit", month: "short", year: "numeric" },
        )
      : "",
  ].filter(Boolean);
  const installSummary = installFacts.length
    ? installFacts.join(" · ")
    : copy("Arquivos prontos no disco.", "Files ready on disk.");

  const sectionDescription: Record<SettingsSection, string> = {
    organization: copy(
      "Onde este jogo aparece na sua biblioteca.",
      "Where this game shows up in your library.",
    ),
    "custom-exe": copy(
      "Escolha o arquivo que o botão Jogar abre.",
      "Pick the file the Play button opens.",
    ),
    installation: copy(
      "Onde os arquivos ficam no disco.",
      "Where the files live on disk.",
    ),
  };

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
        className="game-settings-modal game-settings-modal--widgets"
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

        <header className="game-settings-modal__hero">
          <span
            className={`game-settings-modal__hero-image${heroLoaded && heroSource ? " game-settings-modal__hero-image--loaded" : ""}`}
            style={layeredImageStyle(
              heroLoaded && heroSource ? [heroSource] : emptyImageSources,
              "",
            )}
            aria-hidden="true"
          />
          <span className="game-settings-modal__hero-shade" aria-hidden="true" />
          <button
            type="button"
            className="game-settings-modal__close"
            onClick={onClose}
            aria-label={copy("Fechar", "Close")}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <h3 className="game-settings-modal__hero-title">{gameTitle}</h3>
        </header>

        <div className="game-settings-modal__body">
          <nav
            className="game-settings-modal__nav"
            aria-label={copy("Seção de ajustes", "Settings section")}
          >
            <button
              type="button"
              className={`game-settings-modal__nav-button ${activeSection === "organization" ? "game-settings-modal__nav-button--active" : ""}`}
              onClick={() => setActiveSection("organization")}
              aria-current={activeSection === "organization" ? "page" : undefined}
            >
              <FolderOpen size={15} strokeWidth={1.8} aria-hidden="true" />
              {copy("Coleções", "Collections")}
              {collectionCount > 0 && (
                <span className="game-settings-modal__nav-count">
                  {collectionCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`game-settings-modal__nav-button ${activeSection === "custom-exe" ? "game-settings-modal__nav-button--active" : ""}`}
              onClick={() => setActiveSection("custom-exe")}
              aria-current={activeSection === "custom-exe" ? "page" : undefined}
            >
              <FolderInput size={15} strokeWidth={1.8} aria-hidden="true" />
              {copy("Executável", "Executable")}
            </button>
            <button
              type="button"
              className={`game-settings-modal__nav-button ${activeSection === "installation" ? "game-settings-modal__nav-button--active" : ""}`}
              onClick={() => setActiveSection("installation")}
              aria-current={activeSection === "installation" ? "page" : undefined}
            >
              <HardDrive size={15} strokeWidth={1.8} aria-hidden="true" />
              {copy("Instalação", "Installation")}
            </button>
          </nav>

          <p className="game-settings-modal__section-description">
            {sectionDescription[activeSection]}
          </p>

          <div className="game-settings-modal__rows">
            {activeSection === "organization" && (
            <section
              className={`game-settings-modal__card ${!userCollections.length ? "game-settings-modal__card--disabled" : ""}`}
            >
              <div className="game-settings-modal__card-head">
                <div className="game-settings-modal__card-copy">
                  <strong>
                    {userCollections.length
                      ? collectionSummary
                      : copy("Nenhuma coleção criada", "No collections yet")}
                  </strong>
                  <span>
                    {userCollections.length
                      ? copy(
                          "Um jogo pode estar em várias coleções ao mesmo tempo.",
                          "A game can sit in several collections at once.",
                        )
                      : copy(
                          "Crie uma na barra lateral para organizar a biblioteca.",
                          "Create one in the sidebar to organize your library.",
                        )}
                  </span>
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
                  {copy("Gerenciar", "Manage")}
                </button>
              </div>

              {activeCollections.length > 0 && (
                <ul className="game-settings-modal__chips">
                  {activeCollections.map((collection) => (
                    <li
                      key={collection.id}
                      className="game-settings-modal__chip"
                    >
                      {collection.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            )}

            {activeSection === "custom-exe" && (
            <section
              className={`game-settings-modal__card ${customExeBusy || !game || !onSetCustomExe ? "game-settings-modal__card--disabled" : ""}`}
            >
              <div className="game-settings-modal__card-head">
                <div className="game-settings-modal__card-copy">
                  <strong>
                    {customExePath
                      ? copy("Executável personalizado", "Custom executable")
                      : copy("Iniciando pela Steam", "Launching via Steam")}
                  </strong>
                  <span>
                    {customExePath
                      ? copy(
                          "O botão Jogar abre este arquivo.",
                          "The Play button opens this file.",
                        )
                      : copy(
                          "O botão Jogar entrega a inicialização para a Steam.",
                          "The Play button hands off to Steam.",
                        )}
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
                    {customExePath
                      ? copy("Trocar", "Change")
                      : copy("Escolher .exe", "Choose .exe")}
                  </button>
                  {customExePath && (
                    <button
                      type="button"
                      className="game-settings-modal__action-button game-settings-modal__action-button--danger"
                      onClick={() => void clearCustomExe()}
                      disabled={customExeBusy}
                    >
                      {copy("Remover", "Reset")}
                    </button>
                  )}
                </div>
              </div>

              {customExePath && (
                <p
                  className="game-settings-modal__path"
                  title={customExePath}
                >
                  {customExePath}
                </p>
              )}
            </section>
            )}

            {activeSection === "installation" && (
            <section
              className={`game-settings-modal__card ${!installTask || moveBusy || uninstallBusy ? "game-settings-modal__card--disabled" : ""}`}
            >
              <div className="game-settings-modal__card-head">
                <div className="game-settings-modal__card-copy">
                  <strong>
                    {installTask
                      ? copy("Instalado neste PC", "Installed on this PC")
                      : copy(
                          "Nenhuma instalação local",
                          "No local installation",
                        )}
                  </strong>
                  <span>
                    {installTask
                      ? installSummary
                      : copy(
                          "Baixe o jogo para mover ou desinstalar por aqui.",
                          "Download the game to move or uninstall it here.",
                        )}
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
                    {copy("Mover", "Move")}
                  </button>
                  <button
                    type="button"
                    className="game-settings-modal__action-button game-settings-modal__action-button--danger"
                    onClick={() => setConfirmUninstallOpen(true)}
                    disabled={!installTask || moveBusy || uninstallBusy}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                    {copy("Desinstalar", "Uninstall")}
                  </button>
                </div>
              </div>

              {installTask?.outputDir && (
                <p
                  className="game-settings-modal__path"
                  title={installTask.outputDir}
                >
                  {installTask.outputDir}
                </p>
              )}
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
