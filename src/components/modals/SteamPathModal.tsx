import { useCallback } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../../context/settings";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

interface SteamPathModalProps {
  open: boolean;
  value: string;
  checkedPaths: string[];
  loading: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export function SteamPathModal({
  open,
  value,
  checkedPaths,
  loading,
  onChange,
  onClose,
  onSubmit,
}: SteamPathModalProps) {
  const { appearance } = useSettings();
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange(event.target.value),
    [onChange]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSubmit(value);
    },
    [onSubmit, value]
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="backdrop backdrop--steam-path"
      onClick={onClose}
    >
      <form
        className="steam-path-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="steam-path-modal-title"
        aria-describedby="steam-path-modal-description"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="steam-path-modal__header">
          <div>
            <span className="eyebrow">Steam</span>
            <h3 id="steam-path-modal-title">{appearance.language === "en" ? "Locate library" : "Localizar biblioteca"}</h3>
            <p id="steam-path-modal-description">
              {appearance.language === "en"
                ? "I couldn't find the Steam installation in "
                : "Não encontrei a instalação da Steam em "}
              <strong>C:\Program Files (x86)\Steam</strong>
              {appearance.language === "en"
                ? ". Paste below the Steam folder or steamapps path."
                : ". Cole abaixo o caminho da pasta Steam ou da pasta steamapps."}
            </p>
          </div>
          <button type="button" className="steam-path-modal__close" onClick={onClose} aria-label={appearance.language === "en" ? "Close" : "Fechar"}>
            <ModalCloseIcon />
          </button>
        </header>

        <div className="steam-path-modal__content">
          {checkedPaths.length > 0 && (
            <div className="steam-path-modal__checked">
              <span>{appearance.language === "en" ? "Checked paths:" : "Caminhos verificados:"}</span>
              {checkedPaths.slice(0, 4).map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          )}

          <label className="steam-path-modal__field">
            <span>{appearance.language === "en" ? "Steam path" : "Caminho da Steam"}</span>
            <input
              value={value}
              onChange={handleChange}
              placeholder="C:\Program Files (x86)\Steam"
              autoFocus
            />
          </label>
        </div>

        <footer className="steam-path-modal__actions">
          <button type="button" className="button button--outline" onClick={onClose}>
            {appearance.language === "en" ? "Cancel" : "Cancelar"}
          </button>
          <button type="submit" className="button button--primary" disabled={loading || !value.trim()}>
            {loading
              ? appearance.language === "en" ? "Scanning..." : "Escaneando..."
              : appearance.language === "en" ? "Scan library" : "Escanear biblioteca"}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
