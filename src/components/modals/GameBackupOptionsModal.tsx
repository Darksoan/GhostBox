import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Cloud, HardDrive, Loader2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { SteamProfile, UserCollection } from "../../types";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import { useOverlay } from "../../context/OverlayContext";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { CloudSave } from "../../lib/ghostboxApi.types";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface BackupOptionsModalProps {
  open: boolean;
  gameId: string;
  game: GhostBoxGame | null;
  gameTitle: string;
  steamProfile: SteamProfile | null;
  customExecutablePath: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onSelectGameExecutable: () => void | Promise<void>;
  onRemoveGameExecutable: () => void | Promise<void>;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
}

function formatBackupTimestamp(value: string | undefined, language: "pt" | "en") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(language === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function GameBackupOptionsModal({
  open,
  gameId,
  game,
  gameTitle,
  steamProfile,
  customExecutablePath,
  userCollections,
  onClose,
  onSelectGameExecutable,
  onRemoveGameExecutable,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: BackupOptionsModalProps) {
  const { appearance } = useSettings();
  const { setSubscriptionModalOpen } = useOverlay();
  const {
    backupSettings,
    backupRootStatus,
    handleToggleAutomaticBackup,
    handleOpenBackupFolder,
    setBackupSettings,
    refreshBackupRootStatus,
  } = useAppData();
  const modalRef = useRef<HTMLFormElement>(null);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set()
  );
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [selectedCloudSaveId, setSelectedCloudSaveId] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [localBusyAction, setLocalBusyAction] = useState<"backup" | "restore" | null>(null);
  const [cloudBusyAction, setCloudBusyAction] = useState<"backup" | "restore" | null>(null);
  const [localError, setLocalError] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [hasCloudSession, setHasCloudSession] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const language = appearance.language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);
  const appId = game?.appId || "";
  const backupRecord = appId ? backupSettings?.backupRecords[appId] : undefined;
  const localEntries = backupRecord?.entries?.length
    ? backupRecord.entries
    : backupRecord?.lastBackupSuccess && backupRecord.lastBackupPath
      ? [{ path: backupRecord.lastBackupPath, backupAt: backupRecord.lastBackupAt, sizeBytes: backupRecord.lastBackupSizeBytes }]
      : [];
  const latestLocalEntry = localEntries[0];
  const automaticEnabled = Boolean(
    backupSettings?.automaticBackupsForLibrary ||
      (appId && backupSettings?.automaticBackups[appId])
  );
  const rootOk = backupRootStatus?.status === "ok";

  const currentCollectionIds = useMemo(
    () =>
      new Set(
        userCollections
          .filter((collection) => collection.gameIds.includes(gameId))
          .map((collection) => collection.id)
      ),
    [gameId, userCollections]
  );

  useEffect(() => {
    if (!open) return;
    setIsCollectionPickerOpen(false);
    setDraftCollectionIds(currentCollectionIds);
  }, [currentCollectionIds, open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCloudError("");
    setCloudMessage("");
    setLocalError("");
    setLocalMessage("");
    setIsPremium(false);
    setHasCloudSession(false);
    setCloudSaves([]);
    setSelectedCloudSaveId("");
    void refreshBackupRootStatus();

    if (!steamProfile?.steamId || !game?.appId) return;

    setCloudLoading(true);
    void Promise.all([
      ghostboxApi.getSubscriptionStatus(steamProfile.steamId),
      ghostboxApi.getCloudSession(),
      ghostboxApi.listCloudSaves(game.appId),
    ])
      .then(([status, session, saves]) => {
        if (cancelled) return;
        setIsPremium(status?.subscription.isPremium === true);
        setHasCloudSession(session?.user.steamId === steamProfile.steamId && Boolean(session.token));
        setCloudSaves(saves);
        setSelectedCloudSaveId(saves[0]?.id ?? "");
      })
      .catch((error) => {
        if (!cancelled) {
          setCloudError(
            error instanceof Error
              ? error.message
              : copy("Não foi possível carregar os backups em nuvem.", "Could not load cloud saves.")
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [game?.appId, open, refreshBackupRootStatus, steamProfile?.steamId]);

  const refreshCloudSaves = async () => {
    if (!game?.appId) return;
    const saves = await ghostboxApi.listCloudSaves(game.appId);
    setCloudSaves(saves);
    setSelectedCloudSaveId((current) => current || saves[0]?.id || "");
  };

  const handleToggleAutomatic = async () => {
    if (!game) return;
    await handleToggleAutomaticBackup(game, !automaticEnabled);
  };

  const handleLocalBackup = async () => {
    if (!game || localBusyAction) return;
    setLocalError("");
    setLocalMessage("");
    setLocalBusyAction("backup");
    try {
      if (!rootOk) {
        await refreshBackupRootStatus();
      }
      const result = await ghostboxApi.runGameLocalBackup(game);
      if (result?.settings) setBackupSettings(result.settings);
      if (!result?.success) {
        throw new Error(
          result?.error ||
            copy("Falha ao fazer backup local.", "Local backup failed.")
        );
      }
      setLocalMessage(
        copy(
          "Backup local concluído (saves, conquistas e tempo de jogo).",
          "Local backup completed (saves, achievements, and playtime)."
        )
      );
      await refreshBackupRootStatus();
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : copy("Falha ao fazer backup local.", "Local backup failed.")
      );
    } finally {
      setLocalBusyAction(null);
    }
  };

  const handleLocalRestore = async () => {
    if (!game || !latestLocalEntry?.path || localBusyAction) return;
    const confirmed = window.confirm(
      copy(
        "Restaurar este backup local substituirá saves, conquistas e tempo de jogo deste jogo neste PC. Continuar?",
        "Restoring this local backup will replace saves, achievements, and playtime for this game on this PC. Continue?"
      )
    );
    if (!confirmed) return;

    setLocalError("");
    setLocalMessage("");
    setLocalBusyAction("restore");
    try {
      const result = await ghostboxApi.restoreGameLocalBackup(game, latestLocalEntry.path);
      if (result?.settings) setBackupSettings(result.settings);
      if (!result?.success) {
        throw new Error(
          result?.error ||
            copy("Falha ao restaurar backup local.", "Local restore failed.")
        );
      }
      setLocalMessage(
        copy(
          "Backup local restaurado (saves, conquistas e tempo de jogo).",
          "Local backup restored (saves, achievements, and playtime)."
        )
      );
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : copy("Falha ao restaurar backup local.", "Local restore failed.")
      );
    } finally {
      setLocalBusyAction(null);
    }
  };

  const handleCloudBackup = async () => {
    if (!game || cloudBusyAction) return;
    if (!steamProfile?.steamId) {
      setCloudError(copy("Entre com a Steam antes de usar backup em nuvem.", "Sign in with Steam before using cloud backup."));
      return;
    }
    if (!hasCloudSession) {
      setCloudError(copy("Reconecte a Steam para ativar o backup em nuvem neste dispositivo.", "Reconnect Steam to enable cloud backup on this device."));
      return;
    }
    if (!isPremium) {
      setSubscriptionModalOpen(true);
      return;
    }

    setCloudError("");
    setCloudMessage("");
    setCloudBusyAction("backup");
    try {
      const result = await ghostboxApi.backupGameToCloud(game);
      if (!result?.save) {
        throw new Error(copy("Falha ao fazer backup em nuvem.", "Cloud backup failed."));
      }
      await refreshCloudSaves();
      setSelectedCloudSaveId(result.save.id);
      setCloudMessage(
        copy(
          "Backup em nuvem concluído (saves, conquistas e tempo de jogo).",
          "Cloud backup completed (saves, achievements, and playtime)."
        )
      );
      await refreshBackupRootStatus();
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : copy("Falha ao fazer backup em nuvem.", "Cloud backup failed.")
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const handleCloudRestore = async () => {
    if (!game || !selectedCloudSaveId || cloudBusyAction) return;
    if (!hasCloudSession) {
      setCloudError(copy("Reconecte a Steam para restaurar backups em nuvem neste dispositivo.", "Reconnect Steam to restore cloud backups on this device."));
      return;
    }
    if (!isPremium) {
      setSubscriptionModalOpen(true);
      return;
    }

    const confirmed = window.confirm(
      copy(
        "Restaurar este backup em nuvem substituirá saves, conquistas e tempo de jogo deste jogo neste PC. Continuar?",
        "Restoring this cloud backup will replace saves, achievements, and playtime for this game on this PC. Continue?"
      )
    );
    if (!confirmed) return;

    setCloudError("");
    setCloudMessage("");
    setCloudBusyAction("restore");
    try {
      const result = await ghostboxApi.restoreCloudSave(game, selectedCloudSaveId);
      if (!result?.success) {
        throw new Error(copy("Falha ao restaurar backup em nuvem.", "Cloud restore failed."));
      }
      setCloudMessage(
        copy(
          "Backup em nuvem restaurado (saves, conquistas e tempo de jogo).",
          "Cloud backup restored (saves, achievements, and playtime)."
        )
      );
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : copy("Falha ao restaurar backup em nuvem.", "Cloud restore failed.")
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const cloudUnavailableReason = !steamProfile?.steamId
    ? copy("Entre com a Steam para vincular backups em nuvem à sua conta.", "Sign in with Steam to link cloud saves to your account.")
    : !isPremium
      ? copy("Backup em nuvem está disponível para contas Premium.", "Cloud backup is available for Premium accounts.")
      : !hasCloudSession
        ? copy("Reconecte a Steam para ativar o backup em nuvem neste dispositivo.", "Reconnect Steam to activate cloud backup on this device.")
      : "";

  const localStatusText = !rootOk
    ? backupRootStatus?.message ||
      copy("Configure a pasta de backups nas opções do sistema.", "Set up the backup folder first.")
    : latestLocalEntry
      ? copy(
          `Último backup local: ${formatBackupTimestamp(latestLocalEntry.backupAt, language)}`,
          `Latest local backup: ${formatBackupTimestamp(latestLocalEntry.backupAt, language)}`
        )
      : backupRecord?.lastBackupSuccess === false
        ? backupRecord.lastBackupError || copy("Último backup local falhou.", "Latest local backup failed.")
        : copy("Nenhum backup local ainda.", "No local backup yet.");

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const handlePointerDown = (event: MouseEvent) => {
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
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="backdrop backdrop--profile"
      onClick={onClose}
    >
      <form
        className="collection-modal edit-profile-modal modal__backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-backup-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => event.preventDefault()}
        ref={modalRef}
      >
          <header className="collection-modal__header">
            <div>
              <h3 id="game-backup-modal-title">
                {appearance.language === "en"
                  ? `Options for ${gameTitle}`
                  : `Opções para ${gameTitle}`}
              </h3>
            </div>

            <button
              type="button"
              className="collection-modal__close"
              onClick={onClose}
              aria-label={appearance.language === "en" ? "Close" : "Fechar"}
            >
              <ModalCloseIcon />
            </button>
          </header>

          <div className="collection-modal__content modal__backup-modal-content">
            <section className="modal__backup-section">
              <h4>
                {appearance.language === "en"
                  ? "Organization"
                  : "Organização"}
              </h4>
              <div className="modal__backup-option modal__backup-option--static modal__backup-option--dropdown">
                <div className="modal__backup-option-copy">
                  <strong>
                    {appearance.language === "en"
                      ? "Add to collection"
                      : "Adicionar à coleção"}
                  </strong>
                  <span>
                    {userCollections.length
                      ? appearance.language === "en"
                        ? "Choose one of your collections for this game."
                        : "Escolha uma das suas coleções para este jogo."
                      : appearance.language === "en"
                        ? "Create a collection first."
                        : "Crie uma coleção primeiro."}
                  </span>
                </div>

                <button
                  type="button"
                  className="button button--outline modal__backup-action-button"
                  onClick={() => {
                    setDraftCollectionIds(currentCollectionIds);
                    setIsCollectionPickerOpen(true);
                  }}
                  disabled={!userCollections.length}
                >
                  {appearance.language === "en"
                    ? "Choose collection"
                    : "Escolher coleção"}
                </button>
              </div>
            </section>

            <section className="modal__backup-section">
              <h4>
                {appearance.language === "en" ? "Launch" : "Inicialização"}
              </h4>
              <div className="modal__backup-option modal__backup-option--static">
                <div className="modal__backup-option-copy">
                  <strong>
                    {appearance.language === "en"
                      ? "Custom executable"
                      : "Executável personalizado"}
                  </strong>
                  <span>
                    {customExecutablePath ||
                      (appearance.language === "en"
                        ? "Choose a non-Steam game .exe for the Play button."
                        : "Escolha um .exe de jogo não Steam para o botão Jogar.")}
                  </span>
                </div>

                <div className="modal__backup-option-actions">
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={onSelectGameExecutable}
                  >
                    {appearance.language === "en" ? "Choose" : "Escolher"}
                  </button>
                  {customExecutablePath && (
                    <button
                      type="button"
                      className="button button--outline modal__backup-action-button modal__backup-action-button--danger"
                      onClick={onRemoveGameExecutable}
                    >
                      {appearance.language === "en" ? "Remove" : "Remover"}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="modal__backup-section">
              <h4>
                {copy("Proteção de saves", "Save protection")}
              </h4>

              <div className="modal__backup-option modal__backup-option--static">
                <div className="modal__backup-option-copy">
                  <strong>
                    {copy("Backup automático local", "Automatic local backup")}
                  </strong>
                  <span>
                    {copy(
                      "Ao fechar o jogo, salva automaticamente uma cópia local dos saves.",
                      "When you close the game, automatically saves a local copy of your saves."
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={`settings-switch ${automaticEnabled ? "settings-switch--on" : ""}`}
                  aria-pressed={automaticEnabled}
                  onClick={() => void handleToggleAutomatic()}
                  disabled={!game}
                >
                  <span />
                </button>
              </div>

              <div className="modal__backup-option modal__backup-option--static modal__cloud-backup-card">
                <div className="modal__backup-option-copy">
                  <strong>
                    <HardDrive size={15} strokeWidth={2.15} aria-hidden="true" />
                    {copy("Backup local", "Local backup")}
                  </strong>
                  <span>{localStatusText}</span>
                </div>

                <div className="modal__cloud-backup-actions">
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => void handleLocalBackup()}
                    disabled={!game || localBusyAction !== null || cloudBusyAction !== null}
                  >
                    {localBusyAction === "backup" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {copy("Fazer backup", "Back up now")}
                  </button>
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => void handleLocalRestore()}
                    disabled={!latestLocalEntry?.path || localBusyAction !== null || cloudBusyAction !== null}
                  >
                    {localBusyAction === "restore" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {copy("Restaurar", "Restore")}
                  </button>
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => {
                      if (!appId) return;
                      void handleOpenBackupFolder(appId, latestLocalEntry?.path);
                    }}
                    disabled={!latestLocalEntry?.path}
                  >
                    {copy("Abrir pasta", "Open folder")}
                  </button>
                </div>
              </div>

              {(localMessage || localError) && (
                <div className="modal__cloud-save-list">
                  {localMessage && <p className="modal__cloud-backup-message">{localMessage}</p>}
                  {localError && <p className="modal__cloud-backup-error">{localError}</p>}
                </div>
              )}

              <div className="modal__backup-option modal__backup-option--static modal__cloud-backup-card">
                <div className="modal__backup-option-copy">
                  <strong>
                    <Cloud size={15} strokeWidth={2.15} aria-hidden="true" />
                    {copy("Backup em nuvem", "Cloud backup")}
                  </strong>
                  <span>
                    {cloudUnavailableReason ||
                      (cloudSaves[0]
                        ? copy(
                            `Último backup: ${formatBackupTimestamp(cloudSaves[0].updatedAt, language)}`,
                            `Latest backup: ${formatBackupTimestamp(cloudSaves[0].updatedAt, language)}`
                          )
                        : copy("Nenhum backup em nuvem ainda.", "No cloud backup yet."))}
                  </span>
                </div>

                <div className="modal__cloud-backup-actions">
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => void handleCloudBackup()}
                    disabled={
                      cloudLoading ||
                      cloudBusyAction !== null ||
                      localBusyAction !== null ||
                      !steamProfile?.steamId ||
                      !hasCloudSession
                    }
                  >
                    {cloudBusyAction === "backup" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {copy("Fazer backup", "Back up now")}
                  </button>
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={() => void handleCloudRestore()}
                    disabled={
                      cloudLoading ||
                      cloudBusyAction !== null ||
                      localBusyAction !== null ||
                      !selectedCloudSaveId ||
                      !steamProfile?.steamId ||
                      !hasCloudSession
                    }
                  >
                    {cloudBusyAction === "restore" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {copy("Restaurar", "Restore")}
                  </button>
                </div>
              </div>

              {(cloudLoading || cloudSaves.length > 0 || cloudError || cloudMessage) && (
                <div className="modal__cloud-save-list">
                  {cloudLoading ? (
                    <span>
                      {copy("Carregando backups em nuvem...", "Loading cloud backups...")}
                    </span>
                  ) : (
                    cloudSaves.map((save) => (
                      <button
                        key={save.id}
                        type="button"
                        className={`modal__cloud-save-version ${selectedCloudSaveId === save.id ? "modal__cloud-save-version--active" : ""}`}
                        onClick={() => setSelectedCloudSaveId(save.id)}
                      >
                        <strong>{formatBackupTimestamp(save.updatedAt, language)}</strong>
                        <span>
                          {`${Math.max(1, Math.round(save.sizeBytes / 1024 / 1024))} MB${save.deviceName ? ` · ${save.deviceName}` : ""}`}
                        </span>
                      </button>
                    ))
                  )}
                  {cloudMessage && <p className="modal__cloud-backup-message">{cloudMessage}</p>}
                  {cloudError && <p className="modal__cloud-backup-error">{cloudError}</p>}
                </div>
              )}

            </section>
          </div>

          {isCollectionPickerOpen && (
            <div
              className="modal__collection-picker-backdrop"
              onClick={() => setIsCollectionPickerOpen(false)}
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
                    onClick={() => setIsCollectionPickerOpen(false)}
                  >
                    {appearance.language === "en" ? "Cancel" : "Cancelar"}
                  </button>
                  <button
                    type="button"
                    className="button button--save"
                    onClick={async () => {
                      const addedIds = [...draftCollectionIds].filter(
                        (collectionId) =>
                          !currentCollectionIds.has(collectionId)
                      );
                      const removedIds = [...currentCollectionIds].filter(
                        (collectionId) =>
                          !draftCollectionIds.has(collectionId)
                      );

                      for (const collectionId of removedIds) {
                        await onRemoveGameFromCollection(collectionId);
                      }

                      for (const collectionId of addedIds) {
                        await onAddGameToCollection(collectionId);
                      }

                      setIsCollectionPickerOpen(false);
                    }}
                  >
                    {appearance.language === "en" ? "Save" : "Salvar"}
                  </button>
                </footer>
              </div>
            </div>
          )}
      </form>
    </div>,
    document.body
  );
}
