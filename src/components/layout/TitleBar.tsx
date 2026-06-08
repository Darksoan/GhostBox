import { Minus, X } from "lucide-react";
import { useCallback } from "react";
import { useSettings } from "../../context/settings";
import { pirateboxApi } from "../../lib/pirateboxApi";

export function TitleBar() {
  const { appearance } = useSettings();
  const handleMinimize = useCallback(() => void pirateboxApi.minimize(), []);
  const handleClose = useCallback(() => void pirateboxApi.close(), []);

  return (
    <div className="title-bar">
      <div className="title-bar__drag-zone" aria-hidden="true" />

      <div className="title-bar__brand">
        <span className="title-bar__logo" aria-hidden="true" />
        <span className="title-bar__title">PIRATEBOX</span>
      </div>

      <div className="title-bar__controls">
        <button type="button" aria-label={appearance.language === "en" ? "Minimize" : "Minimizar"} onClick={handleMinimize}>
          <Minus size={14} />
        </button>
        <button type="button" aria-label={appearance.language === "en" ? "Close" : "Fechar"} onClick={handleClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
