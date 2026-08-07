import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Cloud, Loader2, Pin, Trash2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { UserCollection } from "../../types";
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
  userCollections: UserCollection[];
  onClose: () => void;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
}

function formatBackupTimestamp(
  value: string | undefined,
  language: "pt" | "en",
) {
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

function formatSaveSize(sizeBytes: number) {
  // Most backups are a few KB (achievements + playtime), so rounding
  // everything up to "1 MB" hid how small they really are.
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function GameBackupOptionsModal({
  open,
  gameId,
  game,
  gameTitle,
  userCollections,
  onClose,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: BackupOptionsModalProps) {
  const { appearance } = useSettings();
  const { setSubscriptionModalOpen } = useOverlay();
  const modalRef = useRef<HTMLFormElement>(null);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isSavingCollections, setIsSavingCollections] = useState(false);
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [selectedCloudSaveId, setSelectedCloudSaveId] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudBusyAction, setCloudBusyAction] = useState<
    "restore" | "backup" | "manage" | null
  >(null);
  const [cloudError, setCloudError] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [hasCloudSession, setHasCloudSession] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [cloudStatusReady, setCloudStatusReady] = useState(false);
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
  const showCloudPanel = Boolean(game?.appId);

  useEffect(() => {
    if (!open) return;
    setIsCollectionPickerOpen(false);
    setIsSavingCollections(false);
    setDraftCollectionIds(currentCollectionIds);
  }, [currentCollectionIds, open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCloudError("");
    setCloudMessage("");
    setCloudStatusReady(false);
    setCloudBusyAction(null);

    if (!game?.appId) {
      setCloudLoading(false);
      setCloudSaves([]);
      setSelectedCloudSaveId("");
      setIsPremium(false);
      setHasCloudSession(false);
      setCloudStatusReady(true);
      return;
    }

    setCloudLoading(true);

    void Promise.all([
      ghostboxApi.getSubscriptionStatus(),
      ghostboxApi.getCloudSession(),
      ghostboxApi.listCloudSaves(game.appId),
    ])
      .then(([status, session, saves]) => {
        if (cancelled) return;
        setIsPremium(status?.subscription.isPremium === true);
        setHasCloudSession(Boolean(session?.token));
        setCloudSaves(saves);
        setSelectedCloudSaveId((current) => {
          if (current && saves.some((save) => save.id === current)) return current;
          return saves[0]?.id ?? "";
        });
        setCloudError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setCloudSaves([]);
        setSelectedCloudSaveId("");
        setCloudError(
          error instanceof Error
            ? error.message
            : copy(
                "Não foi possível carregar os backups em nuvem.",
                "Could not load cloud saves.",
              ),
        );
      })
      .finally(() => {
        if (cancelled) return;
        setCloudLoading(false);
        setCloudStatusReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [game?.appId, open]);

  const handleCloudBackup = async () => {
    if (!game || cloudBusyAction) return;
    if (!hasCloudSession) {
      setCloudError(
        copy(
          "Faça login novamente para fazer backup em nuvem neste dispositivo.",
          "Sign in again to back up to the cloud on this device.",
        ),
      );
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
      await ghostboxApi.backupGameToCloud(game);
      const saves = await ghostboxApi.listCloudSaves(game.appId);
      setCloudSaves(saves);
      setSelectedCloudSaveId(saves[0]?.id ?? "");
      setCloudMessage(copy("Backup em nuvem concluído.", "Cloud backup done."));
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : String(error) ||
              copy("Falha ao fazer backup em nuvem.", "Cloud backup failed."),
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const handleTogglePinned = async (save: CloudSave) => {
    if (!game || cloudBusyAction) return;
    setCloudError("");
    setCloudMessage("");
    setCloudBusyAction("manage");
    try {
      await ghostboxApi.setCloudSavePinned(save.id, !save.pinned);
      setCloudSaves(await ghostboxApi.listCloudSaves(game.appId));
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : copy("Falha ao fixar a versão.", "Could not pin the version."),
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const handleDeleteSave = async (save: CloudSave) => {
    if (!game || cloudBusyAction) return;

    const confirmed = window.confirm(
      copy(
        `Excluir permanentemente o backup de ${formatBackupTimestamp(save.updatedAt, language)}? Esta ação não pode ser desfeita.`,
        `Permanently delete the backup from ${formatBackupTimestamp(save.updatedAt, language)}? This cannot be undone.`,
      ),
    );
    if (!confirmed) return;

    setCloudError("");
    setCloudMessage("");
    setCloudBusyAction("manage");
    try {
      await ghostboxApi.deleteCloudSave(save.id);
      const saves = await ghostboxApi.listCloudSaves(game.appId);
      setCloudSaves(saves);
      setSelectedCloudSaveId((current) =>
        saves.some((item) => item.id === current) ? current : (saves[0]?.id ?? ""),
      );
      setCloudMessage(copy("Versão excluída.", "Version deleted."));
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : copy("Falha ao excluir a versão.", "Could not delete the version."),
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const handleCloudRestore = async () => {
    if (!game || !selectedCloudSaveId || cloudBusyAction) return;
    if (!hasCloudSession) {
      setCloudError(
        copy(
          "Faça login novamente para restaurar backups em nuvem neste dispositivo.",
          "Sign in again to restore cloud backups on this device.",
        ),
      );
      return;
    }
    if (!isPremium) {
      setSubscriptionModalOpen(true);
      return;
    }

    const confirmed = window.confirm(
      copy(
        "Restaurar este backup em nuvem substituirá saves, conquistas e tempo de jogo deste jogo neste PC. Continuar?",
        "Restoring this cloud backup will replace saves, achievements, and playtime for this game on this PC. Continue?",
      ),
    );
    if (!confirmed) return;

    setCloudError("");
    setCloudMessage("");
    setCloudBusyAction("restore");
    try {
      const result = await ghostboxApi.restoreCloudSave(
        game,
        selectedCloudSaveId,
      );
      if (!result?.success) {
        throw new Error(
          copy("Falha ao restaurar backup em nuvem.", "Cloud restore failed."),
        );
      }
      setCloudMessage(
        copy(
          "Backup em nuvem restaurado.",
          "Cloud backup restored.",
        ),
      );
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : copy(
              "Falha ao restaurar backup em nuvem.",
              "Cloud restore failed.",
            ),
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  // Cloud saves are keyed by the GhostBox account (user_id) on the worker, so
  // Steam is irrelevant here — it only feeds profile metrics and the personal
  // library. The requirements are an account session plus Premium.
  const cloudStatusText = !cloudStatusReady || cloudLoading
    ? copy("Carregando status do backup…", "Loading backup status…")
    : !isPremium
      ? copy(
          "Backup em nuvem está disponível para contas Premium.",
          "Cloud backup is available for Premium accounts.",
        )
      : !hasCloudSession
        ? copy(
            "Faça login novamente para ativar o backup em nuvem neste dispositivo.",
            "Sign in again to activate cloud backup on this device.",
          )
        : cloudSaves[0]
          ? copy(
              `Último backup: ${formatBackupTimestamp(cloudSaves[0].updatedAt, language)}`,
              `Latest backup: ${formatBackupTimestamp(cloudSaves[0].updatedAt, language)}`,
            )
          : copy(
              "Nenhum backup em nuvem ainda.",
              "No cloud backup yet.",
            );

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
      if (isCollectionPickerOpen) {
        setIsCollectionPickerOpen(false);
        return;
      }
      onClose();
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (isCollectionPickerOpen) return;
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
  }, [open, onClose, isCollectionPickerOpen]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--profile" onClick={onClose}>
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
              {appearance.language === "en" ? "Organization" : "Organização"}
            </h4>
            <div className="modal__backup-option modal__backup-option--static">
              <div className="modal__backup-option-copy">
                <strong>
                  {appearance.language === "en"
                    ? "Collections"
                    : "Coleções"}
                </strong>
                <span>{collectionSummary}</span>
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
                  ? "Manage"
                  : "Gerenciar"}
              </button>
            </div>
          </section>

          <section className="modal__backup-section">
            <h4>{copy("Proteção de saves", "Save protection")}</h4>

            <div className="modal__backup-option modal__backup-option--static modal__cloud-backup-card">
              <div className="modal__backup-option-copy">
                <strong>
                  <Cloud size={15} strokeWidth={2.15} aria-hidden="true" />
                  {copy("Backup em nuvem", "Cloud backup")}
                </strong>
                <span>{cloudStatusText}</span>
              </div>

              <div className="modal__cloud-backup-actions">
                <button
                  type="button"
                  className="button button--outline modal__backup-action-button"
                  onClick={() => void handleCloudBackup()}
                  disabled={
                    !cloudStatusReady ||
                    cloudLoading ||
                    cloudBusyAction !== null ||
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
                    !cloudStatusReady ||
                    cloudLoading ||
                    cloudBusyAction !== null ||
                    !selectedCloudSaveId ||
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

            {showCloudPanel && (
              <div className="modal__cloud-save-list" aria-live="polite">
                {cloudLoading || !cloudStatusReady ? (
                  <div className="modal__cloud-save-loading" role="status">
                    <Loader2 size={15} strokeWidth={2.15} aria-hidden="true" />
                    <span className="sr-only">
                      {copy("Carregando backups em nuvem", "Loading cloud backups")}
                    </span>
                  </div>
                ) : cloudSaves.length > 0 ? (
                  cloudSaves.map((save) => (
                    <div key={save.id} className="modal__cloud-save-version-row">
                      <button
                        type="button"
                        className={`modal__cloud-save-version ${selectedCloudSaveId === save.id ? "modal__cloud-save-version--active" : ""}`}
                        onClick={() => setSelectedCloudSaveId(save.id)}
                        aria-pressed={selectedCloudSaveId === save.id}
                      >
                        <strong>
                          {formatBackupTimestamp(save.updatedAt, language)}
                        </strong>
                        <span>
                          {`${formatSaveSize(save.sizeBytes)}${save.deviceName ? ` · ${save.deviceName}` : ""}`}
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`modal__cloud-save-icon-button ${save.pinned ? "modal__cloud-save-icon-button--active" : ""}`}
                        onClick={() => void handleTogglePinned(save)}
                        disabled={cloudBusyAction !== null}
                        aria-pressed={save.pinned}
                        title={
                          save.pinned
                            ? copy("Desafixar versão", "Unpin version")
                            : copy(
                                "Fixar versão (protege da limpeza automática)",
                                "Pin version (protects it from automatic cleanup)",
                              )
                        }
                      >
                        <Pin size={14} strokeWidth={2.15} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        className="modal__cloud-save-icon-button"
                        onClick={() => void handleDeleteSave(save)}
                        disabled={cloudBusyAction !== null}
                        title={copy("Excluir versão", "Delete version")}
                      >
                        <Trash2 size={14} strokeWidth={2.15} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : cloudError ? null : (
                  <div className="modal__cloud-save-empty">
                    {copy("Nenhuma versão disponível.", "No versions available.")}
                  </div>
                )}
                {cloudMessage && (
                  <p className="modal__cloud-backup-message">{cloudMessage}</p>
                )}
                {cloudError && (
                  <p className="modal__cloud-backup-error">{cloudError}</p>
                )}
              </div>
            )}
          </section>
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
