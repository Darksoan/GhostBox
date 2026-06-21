import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";

interface BackupOptionsModalProps {
  open: boolean;
  gameId: string;
  gameTitle: string;
  automaticBackupEnabled: boolean;
  backupAvailable: boolean;
  backupOutputPath: string;
  customExecutablePath: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onToggleAutomaticBackup: (enabled: boolean) => void | Promise<void>;
  onSelectBackupOutputPath: () => void;
  onSelectGameExecutable: () => void | Promise<void>;
  onRemoveGameExecutable: () => void | Promise<void>;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
}

export function GameBackupOptionsModal({
  open,
  gameId,
  gameTitle,
  automaticBackupEnabled,
  backupAvailable,
  backupOutputPath,
  customExecutablePath,
  userCollections,
  onClose,
  onToggleAutomaticBackup,
  onSelectBackupOutputPath,
  onSelectGameExecutable,
  onRemoveGameExecutable,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: BackupOptionsModalProps) {
  const { appearance } = useSettings();
  const modalRef = useRef<HTMLFormElement>(null);
  const [draftAutomaticBackupEnabled, setDraftAutomaticBackupEnabled] =
    useState(automaticBackupEnabled);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set()
  );

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
    setDraftAutomaticBackupEnabled(automaticBackupEnabled);
    setIsCollectionPickerOpen(false);
    setDraftCollectionIds(currentCollectionIds);
  }, [automaticBackupEnabled, currentCollectionIds, open]);

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
              <X size={20} strokeWidth={1.7} />
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
              <button
                type="button"
                className={`modal__backup-option ${!backupAvailable ? "modal__backup-option--disabled" : ""}`}
                onClick={() => {
                  if (!backupAvailable) return;
                  setDraftAutomaticBackupEnabled((current) => !current);
                }}
                aria-pressed={
                  backupAvailable ? draftAutomaticBackupEnabled : undefined
                }
                disabled={!backupAvailable}
              >
                <div className="modal__backup-option-copy">
                  <strong>
                    {appearance.language === "en"
                      ? "Automatic local backup"
                      : "Backup local automático"}
                  </strong>
                  <span>
                    {!backupAvailable
                      ? appearance.language === "en"
                        ? "Available after adding this game to your library or selecting a custom executable."
                        : "Disponível após adicionar este jogo à sua biblioteca ou selecionar um executável personalizado."
                      : appearance.language === "en"
                        ? "Create a local backup automatically when this game closes."
                        : "Cria um backup local automaticamente quando este jogo for fechado."}
                  </span>
                </div>

                <span
                  className={`settings-switch ${draftAutomaticBackupEnabled ? "settings-switch--on" : ""}`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              </button>

              <div className="modal__backup-option modal__backup-option--static">
                <div className="modal__backup-option-copy">
                  <strong>
                    {appearance.language === "en"
                      ? "Backup location"
                      : "Local dos backups"}
                  </strong>
                  <span>
                    {backupOutputPath ||
                      (appearance.language === "en"
                        ? "Choose where local backups will be saved."
                        : "Escolha onde os backups locais serão salvos.")}
                  </span>
                </div>

                <button
                  type="button"
                  className="button button--outline modal__backup-action-button"
                  onClick={onSelectBackupOutputPath}
                >
                  {appearance.language === "en" ? "Choose" : "Escolher"}
                </button>
              </div>
            </section>

            <div className="collection-modal__actions modal__backup-modal-actions">
              <button
                type="button"
                className="button button--save"
                onClick={() => {
                  if (
                    backupAvailable &&
                    draftAutomaticBackupEnabled !== automaticBackupEnabled
                  ) {
                    onToggleAutomaticBackup(draftAutomaticBackupEnabled);
                  }
                  onClose();
                }}
              >
                {appearance.language === "en" ? "Save" : "Salvar"}
              </button>
            </div>
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
                          {checked && <Check size={12} strokeWidth={3} />}
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
