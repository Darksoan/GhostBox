import { Download, LoaderCircle, Minus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ghostSolidIcon from "../../../Icons/ghost-solid.png";
import packageJson from "../../../package.json";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { UpdateCheckResult } from "../../lib/ghostboxApi.types";

const displayVersion = packageJson.version.replace(/\.0$/, "");

export function TitleBar() {
  const { appearance } = useSettings();
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleMinimize = useCallback(() => void ghostboxApi.minimize(), []);
  const handleClose = useCallback(() => void ghostboxApi.close(), []);

  useEffect(() => {
    let cancelled = false;

    const checkForUpdates = () => {
      void ghostboxApi.checkForUpdates().then((result) => {
        if (!cancelled) setUpdate(result?.updateAvailable ? result : null);
      });
    };

    checkForUpdates();
    const interval = window.setInterval(checkForUpdates, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const handleInstallUpdate = useCallback(() => {
    if (!update?.installerUrl || isUpdating) return;

    setIsUpdating(true);
    void ghostboxApi.installUpdate(update.installerUrl).finally(() => {
      setIsUpdating(false);
    });
  }, [isUpdating, update?.installerUrl]);

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
        {update && (
          <button
            type="button"
            className="title-bar__update-button"
            aria-label={
              appearance.language === "en"
                ? `Download GhostBox ${update.latestVersion}`
                : `Baixar GhostBox ${update.latestVersion}`
            }
            title={
              appearance.language === "en"
                ? `Download GhostBox ${update.latestVersion}`
                : `Baixar GhostBox ${update.latestVersion}`
            }
            onClick={handleInstallUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? <LoaderCircle className="title-bar__update-spinner" size={13} /> : <Download size={13} />}
          </button>
        )}
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
