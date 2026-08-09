import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import type { UserCollection } from "../../types";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface BackupOptionsModalProps {
  open: boolean;
  gameId: string;
  gameTitle: string;
  userCollections: UserCollection[];
  onClose: () => void;
  onAddGameToCollection: (collectionId: string) => void | Promise<void>;
  onRemoveGameFromCollection: (collectionId: string) => void | Promise<void>;
}

export function GameBackupOptionsModal({
  open,
  gameId,
  gameTitle,
  userCollections,
  onClose,
  onAddGameToCollection,
  onRemoveGameFromCollection,
}: BackupOptionsModalProps) {
  const { appearance } = useSettings();
  const modalRef = useRef<HTMLFormElement>(null);
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [draftCollectionIds, setDraftCollectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isSavingCollections, setIsSavingCollections] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    setIsCollectionPickerOpen(false);
    setIsSavingCollections(false);
    setDraftCollectionIds(currentCollectionIds);
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