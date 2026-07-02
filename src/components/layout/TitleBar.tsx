import { Minus, X } from "lucide-react";
import { useCallback } from "react";
import ghostSolidIcon from "../../../Icons/ghost-solid.png";
import packageJson from "../../../package.json";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";

const displayVersion = packageJson.version.replace(/\.0$/, "");

export function TitleBar() {
  const { appearance } = useSettings();
  const handleMinimize = useCallback(() => void ghostboxApi.minimize(), []);
  const handleClose = useCallback(() => void ghostboxApi.close(), []);

  return (
    <div className="title-bar">
      <div className="title-bar__drag-zone" aria-hidden="true" />

      <div className="title-bar__brand">
        <img
          className="title-bar__logo"
          src={ghostSolidIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span className="title-bar__title">GHOSTBOX</span>
      </div>

      <div className="title-bar__controls">
        <span className="title-bar__version">v{displayVersion}</span>
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
