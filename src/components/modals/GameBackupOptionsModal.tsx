import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Cloud, Loader2 } from "lucide-react";
import type { GhostBoxGame } from "../../data";
import type { SteamProfile, UserCollection } from "../../types";
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
  const modalRef = useRef<HTMLFormElement>(null);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set()
  );
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [selectedCloudSaveId, setSelectedCloudSaveId] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudBusyAction, setCloudBusyAction] = useState<"backup" | "restore" | null>(null);
  const [cloudError, setCloudError] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [hasCloudSession, setHasCloudSession] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

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
    setIsPremium(false);
    setHasCloudSession(false);
    setCloudSaves([]);
    setSelectedCloudSaveId("");

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
              : appearance.language === "en"
                ? "Could not load cloud saves."
                : "Não foi possível carregar os backups em nuvem."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appearance.language, game?.appId, open, steamProfile?.steamId]);

  const refreshCloudSaves = async () => {
    if (!game?.appId) return;
    const saves = await ghostboxApi.listCloudSaves(game.appId);
    setCloudSaves(saves);
    setSelectedCloudSaveId((current) => current || saves[0]?.id || "");
  };

  const handleCloudBackup = async () => {
    if (!game || cloudBusyAction) return;
    if (!steamProfile?.steamId) {
      setCloudError(
        appearance.language === "en"
          ? "Sign in with Steam before using cloud backup."
          : "Entre com a Steam antes de usar backup em nuvem."
      );
      return;
    }
    if (!hasCloudSession) {
      setCloudError(
        appearance.language === "en"
          ? "Reconnect Steam to enable cloud backup on this device."
          : "Reconecte a Steam para ativar o backup em nuvem neste dispositivo."
      );
      return;
    }
    if (!isPremium) {
      setSubscriptionModalOpen(true);
      return;
    }

    setCloudError("");
    setCloudBusyAction("backup");
    try {
      const result = await ghostboxApi.backupGameToCloud(game);
      if (!result?.save) {
        throw new Error(
          appearance.language === "en"
            ? "Cloud backup failed."
            : "Falha ao fazer backup em nuvem."
        );
      }
      await refreshCloudSaves();
      setSelectedCloudSaveId(result.save.id);
      setCloudMessage(
        appearance.language === "en"
          ? "Cloud backup completed."
          : "Backup em nuvem concluído."
      );
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : appearance.language === "en"
            ? "Cloud backup failed."
            : "Falha ao fazer backup em nuvem."
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const handleCloudRestore = async () => {
    if (!game || !selectedCloudSaveId || cloudBusyAction) return;
    if (!hasCloudSession) {
      setCloudError(
        appearance.language === "en"
          ? "Reconnect Steam to restore cloud backups on this device."
          : "Reconecte a Steam para restaurar backups em nuvem neste dispositivo."
      );
      return;
    }
    if (!isPremium) {
      setSubscriptionModalOpen(true);
      return;
    }

    const confirmed = window.confirm(
      appearance.language === "en"
        ? "Restoring this cloud backup will replace the current save on this PC. Continue?"
        : "Restaurar este backup em nuvem substituirá o save atual neste PC. Continuar?"
    );
    if (!confirmed) return;

    setCloudError("");
    setCloudBusyAction("restore");
    try {
      const result = await ghostboxApi.restoreCloudSave(game, selectedCloudSaveId);
      if (!result?.success) {
        throw new Error(
          appearance.language === "en"
            ? "Cloud restore failed."
            : "Falha ao restaurar backup em nuvem."
        );
      }
      setCloudMessage(
        appearance.language === "en"
          ? "Cloud backup restored."
          : "Backup em nuvem restaurado."
      );
    } catch (error) {
      setCloudError(
        error instanceof Error
          ? error.message
          : appearance.language === "en"
            ? "Cloud restore failed."
            : "Falha ao restaurar backup em nuvem."
      );
    } finally {
      setCloudBusyAction(null);
    }
  };

  const cloudUnavailableReason = !steamProfile?.steamId
    ? appearance.language === "en"
      ? "Sign in with Steam to link cloud saves to your account."
      : "Entre com a Steam para vincular backups em nuvem à sua conta."
    : !isPremium
      ? appearance.language === "en"
        ? "Cloud backup is available for Premium accounts."
        : "Backup em nuvem está disponível para contas Premium."
      : !hasCloudSession
        ? appearance.language === "en"
          ? "Reconnect Steam to activate cloud backup on this device."
          : "Reconecte a Steam para ativar o backup em nuvem neste dispositivo."
      : "";

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
                {appearance.language === "en"
                  ? "Save protection"
                  : "Proteção de saves"}
              </h4>
              <div className="modal__backup-option modal__backup-option--static modal__cloud-backup-card">
                <div className="modal__backup-option-copy">
                  <strong>
                    <Cloud size={15} strokeWidth={2.15} aria-hidden="true" />
                    {appearance.language === "en"
                      ? "Cloud backup"
                      : "Backup em nuvem"}
                  </strong>
                  <span>
                    {cloudUnavailableReason ||
                      (cloudSaves[0]
                        ? appearance.language === "en"
                          ? `Latest backup: ${new Date(cloudSaves[0].updatedAt).toLocaleString()}`
                          : `Último backup: ${new Date(cloudSaves[0].updatedAt).toLocaleString()}`
                        : appearance.language === "en"
                          ? "No cloud backup yet."
                          : "Nenhum backup em nuvem ainda.")}
                  </span>
                </div>

                <div className="modal__cloud-backup-actions">
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={handleCloudBackup}
                    disabled={cloudLoading || cloudBusyAction !== null || !steamProfile?.steamId || !hasCloudSession}
                  >
                    {cloudBusyAction === "backup" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {appearance.language === "en" ? "Back up now" : "Fazer backup"}
                  </button>
                  <button
                    type="button"
                    className="button button--outline modal__backup-action-button"
                    onClick={handleCloudRestore}
                    disabled={cloudLoading || cloudBusyAction !== null || !selectedCloudSaveId || !steamProfile?.steamId || !hasCloudSession}
                  >
                    {cloudBusyAction === "restore" && (
                      <Loader2 size={14} strokeWidth={2.15} aria-hidden="true" />
                    )}
                    {appearance.language === "en" ? "Restore" : "Restaurar"}
                  </button>
                </div>
              </div>

              {(cloudLoading || cloudSaves.length > 0 || cloudError) && (
                <div className="modal__cloud-save-list">
                  {cloudLoading ? (
                    <span>
                      {appearance.language === "en"
                        ? "Loading cloud backups..."
                        : "Carregando backups em nuvem..."}
                    </span>
                  ) : (
                    cloudSaves.map((save) => (
                      <button
                        key={save.id}
                        type="button"
                        className={`modal__cloud-save-version ${selectedCloudSaveId === save.id ? "modal__cloud-save-version--active" : ""}`}
                        onClick={() => setSelectedCloudSaveId(save.id)}
                      >
                        <strong>{new Date(save.updatedAt).toLocaleString()}</strong>
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
