import { useId, useState } from "react";
import { Alert } from "reicon-react";

export function GameDrmNotice({ notice, language }: { notice: string; language: string }) {
  const tooltipId = useId();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const isEnglish = language === "en";

  return (
    <span
      className="modal__drm-notice"
      onMouseEnter={() => setIsTooltipOpen(true)}
      onMouseLeave={() => setIsTooltipOpen(false)}
    >
      <span
        className="modal__drm-badge"
        tabIndex={0}
        aria-describedby={tooltipId}
        onFocus={() => setIsTooltipOpen(true)}
        onBlur={() => setIsTooltipOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isTooltipOpen) {
            event.stopPropagation();
            setIsTooltipOpen(false);
          }
        }}
      >
        <Alert size={18} aria-hidden="true" />
        <span>{isEnglish ? "This game contains DRM" : "Este jogo contém DRM"}</span>
      </span>
      <span
        id={tooltipId}
        className="modal__drm-tooltip"
        role="tooltip"
        hidden={!isTooltipOpen}
      >
        <strong>{isEnglish ? "DRM reported by Steam" : "DRM informado pela Steam"}</strong>
        <span>{notice}</span>
        <span>
          {isEnglish
            ? "Activation may require an internet connection or a linked account, depending on the game's requirements."
            : "A ativação pode exigir conexão com a internet ou uma conta vinculada, conforme os requisitos do jogo."}
        </span>
      </span>
    </span>
  );
}
