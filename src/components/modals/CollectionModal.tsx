import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";

interface CollectionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function CollectionModal({
  open,
  onClose,
  onSubmit,
}: CollectionModalProps) {
  const { appearance } = useSettings();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) return;
      onSubmit(trimmedName);
    },
    [name, onSubmit]
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="backdrop backdrop--collection"
      onClick={onClose}
    >
      <form
        className="collection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
            <header className="collection-modal__header">
              <div>
                <h3 id="collection-modal-title">{appearance.language === "en" ? "Create collection" : "Criar coleção"}</h3>
                <p>{appearance.language === "en" ? "Create a new collection to organize your games" : "Crie uma nova coleção para organizar seus jogos"}</p>
              </div>

              <button type="button" className="collection-modal__close" onClick={onClose} aria-label={appearance.language === "en" ? "Close" : "Fechar"}>
                <X size={20} strokeWidth={1.7} />
              </button>
            </header>

            <div className="collection-modal__content">
              <label className="collection-modal__field">
                <span>{appearance.language === "en" ? "Collection name" : "Nome da coleção"}</span>
                <input
                  value={name}
                  onChange={handleChange}
                  placeholder={appearance.language === "en" ? "Enter collection name" : "Insira o nome da coleção"}
                  autoFocus
                />
              </label>

              <div className="collection-modal__actions">
                <button type="button" className="button button--outline" onClick={onClose}>
                  {appearance.language === "en" ? "Cancel" : "Cancelar"}
                </button>
                <button type="submit" className="button button--primary" disabled={!name.trim()}>
                  {appearance.language === "en" ? "Create" : "Criar"}
                </button>
              </div>
            </div>
      </form>
    </div>,
    document.body
  );
}
