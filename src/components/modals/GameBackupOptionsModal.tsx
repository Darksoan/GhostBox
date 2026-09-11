import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ExternalLink,
  FolderInput,
  FolderOpen,
  HardDrive,
  Loader2,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { formatBytes } from "../../utils/formatBytes";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import type { GameExecutableCandidate } from "../../lib/ghostboxApi.types";
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
  onSetCustomExe?: (
    customExePath: string,
    launchArguments?: string,
    options?: { showSuccessToast?: boolean },
  ) => Promise<GhostBoxGame | null>;
  onInstallationChanged?: () => void;
}

type SettingsSection = "launch" | "installation" | "organization";

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
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const modalRef = useRef<HTMLFormElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resetKeyRef = useRef("");
  const executableScanRequestRef = useRef(0);
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
  const [activeSection, setActiveSection] = useState<SettingsSection>("launch");
  const [launchMethod, setLaunchMethod] = useState<"steam" | "executable">(
    customExePath ? "executable" : "steam",
  );
  const [draftExePath, setDraftExePath] = useState(customExePath);
  const [draftLaunchArguments, setDraftLaunchArguments] = useState(
    game?.launchArguments ?? "",
  );
  const [executableCandidates, setExecutableCandidates] = useState<
    GameExecutableCandidate[]
  >([]);
  const [candidateState, setCandidateState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [shortcutBusy, setShortcutBusy] = useState(false);
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
  const executableInstallPaths = useMemo(() => {
    const seen = new Set<string>();
    return [installTask?.outputDir, game?.installPath].reduce<string[]>(
      (paths, rawPath) => {
        const path = rawPath?.trim();
        if (!path) return paths;
        const key = path.replaceAll("\\", "/").toLowerCase();
        if (seen.has(key)) return paths;
        seen.add(key);
        paths.push(path);
        return paths;
      },
      [],
    );
  }, [game?.installPath, installTask?.outputDir]);

  useEffect(() => {
    const requestId = ++executableScanRequestRef.current;
    if (
      !open ||
      activeSection !== "launch" ||
      launchMethod !== "executable"
    ) {
      return;
    }
    let cancelled = false;
    setExecutableCandidates([]);
    if (executableInstallPaths.length === 0) {
      setCandidateState("error");
      return;
    }
    setCandidateState("loading");
    void (async () => {
      let hasReadablePath = false;

      for (const installPath of executableInstallPaths) {
        if (cancelled || requestId !== executableScanRequestRef.current) return;
        try {
          const candidates = await ghostboxApi.listGameExecutables(
            installPath,
            gameTitle,
          );
          hasReadablePath = true;
          if (candidates.length === 0) continue;
          if (cancelled || requestId !== executableScanRequestRef.current) return;
          setExecutableCandidates(candidates);
          setCandidateState("ready");
          return;
        } catch {
          // Try the next known installation path before showing the inline error.
        }
      }

      if (cancelled || requestId !== executableScanRequestRef.current) return;
      setExecutableCandidates([]);
      setCandidateState(hasReadablePath ? "ready" : "error");
    })();
    return () => {
      cancelled = true;
      if (executableScanRequestRef.current === requestId) {
        executableScanRequestRef.current += 1;
      }
    };
  }, [
    activeSection,
    executableInstallPaths,
    gameTitle,
    launchMethod,
    open,
  ]);

  useEffect(() => {
    if (!open) {
      resetKeyRef.current = "";
      return;
    }
    if (resetKeyRef.current === gameId) return;
    resetKeyRef.current = gameId;
    setIsCollectionPickerOpen(false);
    setIsSavingCollections(false);
    setDraftCollectionIds(currentCollectionIds);
    setConfirmUninstallOpen(false);
    setUninstallBusy(false);
    setMoveConfirmOpen(false);
    setMoveTargetRoot(null);
    setMoveBusy(false);
    setActiveSection("launch");
    setLaunchMethod(customExePath ? "executable" : "steam");
    setDraftExePath(customExePath);
    setDraftLaunchArguments(game?.launchArguments ?? "");
    setExecutableCandidates([]);
    setCandidateState("idle");
    setLaunchBusy(false);
    setShortcutBusy(false);
  }, [currentCollectionIds, customExePath, game?.launchArguments, gameId, open]);

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
    launch: t("gameSettings.launch.description"),
    organization: copy(
      "Onde este jogo aparece na sua biblioteca.",
      "Where this game shows up in your library.",
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

  const startMove = async () => {
    try {
      const target = await ghostboxApi.selectDownloadsDir();
      if (typeof target !== "string" || !target.trim()) return;
      if (installTask && target.trim() === installTask.downloadsRoot.trim()) {
        showToast(
          t("gameSettings.sections.installation"),
          copy(
            "A nova pasta é a mesma da instalação atual.",
            "The selected folder is the same as the current installation folder.",
          ),
          "error",
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
    try {
      const newOutput = await ghostboxApi.moveInstallDir(
        installTask.appId,
        installTask.downloadsRoot,
        installTask.outputDir,
        moveTargetRoot,
      );
      updateInstallPathsForApp(installTask.appId, moveTargetRoot, newOutput);
      showToast(
        t("gameSettings.sections.installation"),
        copy("Instalação movida.", "Installation moved."),
        "success",
      );
      setMoveConfirmOpen(false);
      setMoveTargetRoot(null);
      onInstallationChanged?.();
    } catch (error) {
      showToast(
        t("gameSettings.sections.installation"),
        error instanceof Error
          ? error.message
          : copy("Falha ao mover.", "Move failed."),
        "error",
      );
    } finally {
      setMoveBusy(false);
    }
  };

  const confirmUninstall = async () => {
    if (!installTask || uninstallBusy) return;
    setUninstallBusy(true);
    try {
      await ghostboxApi.deleteDownloadOutputDir(
        installTask.appId,
        installTask.downloadsRoot,
        installTask.outputDir,
      );
      removeDownloadTask(installTask.id);
      showToast(
        t("gameSettings.sections.installation"),
        copy("Jogo desinstalado.", "Game uninstalled."),
        "success",
      );
      setConfirmUninstallOpen(false);
      onInstallationChanged?.();
    } catch (error) {
      showToast(
        t("gameSettings.sections.installation"),
        error instanceof Error
          ? error.message
          : copy("Falha ao desinstalar.", "Uninstall failed."),
        "error",
      );
    } finally {
      setUninstallBusy(false);
    }
  };

  const chooseCustomExe = async () => {
    if (!game || !onSetCustomExe) return;
    try {
      const picked = await ghostboxApi.selectExeFile();
      if (typeof picked !== "string" || !picked.trim()) return;
      executableScanRequestRef.current += 1;
      setExecutableCandidates([]);
      setCandidateState("ready");
      setDraftExePath(picked);
      setLaunchMethod("executable");
    } catch (error) {
      showToast(
        t("gameSettings.sections.launch"),
        error instanceof Error
          ? error.message
          : t("gameSettings.launch.saveError"),
        "error",
      );
    }
  };

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      navRef.current
        ?.querySelector<HTMLButtonElement>("[aria-current='page']")
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  const handleNavKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(currentIndex + delta + buttons.length) % buttons.length]?.focus();
  };

  const saveLaunchSettings = async (
    options?: { showSuccessToast?: boolean },
  ): Promise<GhostBoxGame | null> => {
    if (!game || launchBusy || !onSetCustomExe) return null;
    if (launchMethod === "executable" && !draftExePath.trim()) {
      showToast(
        t("gameSettings.sections.launch"),
        t("gameSettings.launch.executableRequired"),
        "error",
      );
      return null;
    }
    setLaunchBusy(true);
    try {
      const updated = await onSetCustomExe(
        launchMethod === "executable" ? draftExePath.trim() : "",
        draftLaunchArguments.trim(),
        options,
      );
      if (!updated) return null;
      return updated;
    } catch (error) {
      showToast(
        t("gameSettings.sections.launch"),
        error instanceof Error
          ? error.message
          : t("gameSettings.launch.saveError"),
        "error",
      );
      return null;
    } finally {
      setLaunchBusy(false);
    }
  };

  const createDesktopShortcut = async () => {
    if (shortcutBusy || launchBusy) return;
    setShortcutBusy(true);
    try {
      const updated = await saveLaunchSettings({ showSuccessToast: false });
      if (!updated) return;
      await ghostboxApi.createGameShortcut(updated, "desktop");
      showToast(
        t("gameSettings.launch.shortcutsTitle"),
        t("gameSettings.launch.desktopShortcutCreated"),
        "success",
      );
    } catch (error) {
      showToast(
        t("gameSettings.launch.shortcutsTitle"),
        error instanceof Error
          ? error.message
          : t("gameSettings.launch.shortcutError"),
        "error",
      );
    } finally {
      setShortcutBusy(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

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

        <div className="game-settings-modal__body">
          <aside className="game-settings-modal__sidebar">
            <nav
              className="game-settings-modal__nav"
              aria-label={copy("Seção de ajustes", "Settings section")}
              ref={navRef}
              onKeyDown={handleNavKeyDown}
            >
              <button
                type="button"
                className={`game-settings-modal__nav-button ${activeSection === "launch" ? "game-settings-modal__nav-button--active" : ""}`}
                onClick={() => setActiveSection("launch")}
                aria-current={activeSection === "launch" ? "page" : undefined}
              >
                <Rocket size={18} strokeWidth={1.9} aria-hidden="true" />
                {t("gameSettings.sections.launch")}
              </button>
              <button
                type="button"
                className={`game-settings-modal__nav-button ${activeSection === "installation" ? "game-settings-modal__nav-button--active" : ""}`}
                onClick={() => setActiveSection("installation")}
                aria-current={activeSection === "installation" ? "page" : undefined}
              >
                <HardDrive size={18} strokeWidth={1.9} aria-hidden="true" />
                {t("gameSettings.sections.installation")}
              </button>
              <button
                type="button"
                className={`game-settings-modal__nav-button ${activeSection === "organization" ? "game-settings-modal__nav-button--active" : ""}`}
                onClick={() => setActiveSection("organization")}
                aria-current={activeSection === "organization" ? "page" : undefined}
              >
                <FolderOpen size={18} strokeWidth={1.9} aria-hidden="true" />
                {t("gameSettings.sections.collections")}
                {collectionCount > 0 && (
                  <span className="game-settings-modal__nav-count">
                    {collectionCount}
                  </span>
                )}
              </button>
            </nav>
          </aside>

          <main className="game-settings-modal__content">
            <button
              type="button"
              className="game-settings-modal__close"
              onClick={onClose}
              aria-label={copy("Fechar", "Close")}
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>

            <div className="game-settings-modal__section-view" key={activeSection}>
              <header className="game-settings-modal__section-header">
                <h4>{t(`gameSettings.sections.${activeSection === "organization" ? "collections" : activeSection}`)}</h4>
                <p>{sectionDescription[activeSection]}</p>
              </header>

              <div
                className={`game-settings-modal__rows ${activeSection === "launch" ? "game-settings-modal__rows--launch" : ""}`}
              >
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

            {activeSection === "launch" && (
              <>
                <section className="game-settings-modal__card">
                  <div className="game-settings-modal__card-copy">
                    <strong>{t("gameSettings.launch.methodTitle")}</strong>
                    <span>{t("gameSettings.launch.methodDescription")}</span>
                  </div>
                  <div
                    className="game-settings-modal__choice-grid"
                    role="radiogroup"
                    aria-label={t("gameSettings.launch.methodTitle")}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={launchMethod === "steam"}
                      className={`game-settings-modal__choice ${launchMethod === "steam" ? "game-settings-modal__choice--active" : ""}`}
                      onClick={() => setLaunchMethod("steam")}
                    >
                      <span>{t("gameSettings.launch.steam")}</span>
                      <small>{t("gameSettings.launch.steamDescription")}</small>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={launchMethod === "executable"}
                      className={`game-settings-modal__choice ${launchMethod === "executable" ? "game-settings-modal__choice--active" : ""}`}
                      onClick={() => setLaunchMethod("executable")}
                    >
                      <span>{t("gameSettings.launch.customExecutable")}</span>
                      <small>{t("gameSettings.launch.customExecutableDescription")}</small>
                    </button>
                  </div>
                </section>

                {launchMethod === "executable" && (
                  <section className="game-settings-modal__card">
                    <div className="game-settings-modal__card-head">
                      <div className="game-settings-modal__card-copy">
                        <strong>{t("gameSettings.launch.executableTitle")}</strong>
                        <span>{t("gameSettings.launch.executableDescription")}</span>
                      </div>
                      <button
                        type="button"
                        className="game-settings-modal__action-button game-settings-modal__icon-button"
                        onClick={() => void chooseCustomExe()}
                        disabled={!game || !onSetCustomExe}
                        aria-label={t("gameSettings.launch.browse")}
                      >
                        <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>

                    {candidateState === "loading" && (
                      <div className="game-settings-modal__loading-row">
                        <Loader2 size={15} strokeWidth={2} aria-hidden="true" />
                        {t("gameSettings.launch.scanning")}
                      </div>
                    )}
                    {candidateState === "ready" && executableCandidates.length > 0 && (
                      <div className="game-settings-modal__candidate-list">
                        {executableCandidates.slice(0, 6).map((candidate) => (
                          <button
                            type="button"
                            key={candidate.path}
                            className={`game-settings-modal__candidate ${draftExePath === candidate.path ? "game-settings-modal__candidate--active" : ""}`}
                            onClick={() => setDraftExePath(candidate.path)}
                          >
                            <span>
                              {candidate.fileName}
                              {candidate.recommended && (
                                <small>{t("gameSettings.launch.recommended")}</small>
                              )}
                            </span>
                            <small>{candidate.relativePath}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    {candidateState === "ready" && executableCandidates.length === 0 && (
                      <p className="game-settings-modal__empty-note">
                        {t("gameSettings.launch.noExecutables")}
                      </p>
                    )}
                    {candidateState === "error" && (
                      <p className="game-settings-modal__empty-note" role="alert">
                        {t("gameSettings.launch.scanError")}
                      </p>
                    )}

                    {draftExePath && (
                      <p className="game-settings-modal__path">{draftExePath}</p>
                    )}
                  </section>
                )}

                <section className="game-settings-modal__card">
                  <label className="game-settings-modal__field">
                    <span>{t("gameSettings.launch.argumentsTitle")}</span>
                    <small>{t("gameSettings.launch.argumentsDescription")}</small>
                    <input
                      className="settings-input"
                      value={draftLaunchArguments}
                      onChange={(event) => setDraftLaunchArguments(event.target.value)}
                      placeholder={t("gameSettings.launch.argumentsPlaceholder")}
                      spellCheck={false}
                    />
                  </label>
                </section>

                <section className="game-settings-modal__card">
                  <div className="game-settings-modal__card-head">
                    <div className="game-settings-modal__card-copy">
                      <strong>{t("gameSettings.launch.shortcutsTitle")}</strong>
                      <span>{t("gameSettings.launch.shortcutsDescription")}</span>
                    </div>
                    <div className="game-settings-modal__actions">
                      <button
                        type="button"
                        className="button game-settings-modal__shortcut-button"
                        onClick={() => void createDesktopShortcut()}
                        disabled={shortcutBusy || launchBusy}
                        aria-label={t("gameSettings.launch.desktop")}
                        aria-busy={shortcutBusy}
                      >
                        {shortcutBusy ? (
                          <span
                            className="modal__add-spinner modal__add-spinner--light"
                            aria-hidden="true"
                          />
                        ) : (
                          <ExternalLink
                            size={16}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                <div className="game-settings-modal__launch-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void saveLaunchSettings()}
                    disabled={launchBusy || shortcutBusy}
                  >
                    {t("gameSettings.launch.save")}
                  </button>
                </div>
              </>
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
                    onClick={() => {
                      if (!installTask?.outputDir) return;
                      void ghostboxApi
                        .revealDownloadFolder(installTask.outputDir)
                        .catch(() =>
                          showToast(
                            t("downloads.openFolder"),
                            t("downloads.openFolderError"),
                            "error",
                          ),
                        );
                    }}
                    disabled={!installTask?.outputDir || moveBusy || uninstallBusy}
                  >
                    <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
                    {t("downloads.openFolder")}
                  </button>
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
                <p className="game-settings-modal__path">
                  {installTask.outputDir}
                </p>
              )}
            </section>
            )}
              </div>

            </div>

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
          </main>
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
