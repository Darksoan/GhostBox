import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { SteamProfile } from "../../types";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";

type FeedbackModalProps = {
  open: boolean;
  steamProfile: SteamProfile | null;
  onClose: () => void;
};

const maxFeedbackLength = 1800;

export function FeedbackModal({ open, steamProfile, onClose }: FeedbackModalProps) {
  const { appearance, t } = useSettings();
  const { showToast } = useOverlay();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const trimmedMessage = message.trim();
  const canSubmit = trimmedMessage.length > 0 && !isSending;

  const handleClose = useCallback(() => {
    if (!isSending) onClose();
  }, [isSending, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setIsSending(true);

    try {
      const result = await ghostboxApi.sendFeedback({
        message: trimmedMessage,
        language: appearance.language,
        steamId: steamProfile?.steamId,
        userName: steamProfile?.displayName,
      });

      if (!result.success) {
        showToast(
          t("feedback.errorTitle"),
          t("feedback.errorMessage"),
          "error"
        );
        return;
      }

      setMessage("");
      onClose();
      showToast(
        t("feedback.successTitle"),
        t("feedback.successMessage"),
        "success"
      );
    } catch {
      showToast(t("feedback.errorTitle"), t("feedback.errorMessage"), "error");
    } finally {
      setIsSending(false);
    }
  }, [
    appearance.language,
    canSubmit,
    onClose,
    showToast,
    steamProfile?.displayName,
    steamProfile?.steamId,
    t,
    trimmedMessage,
  ]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="backdrop backdrop--feedback" onClick={handleClose}>
      <section
        className="collection-modal feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="collection-modal__header">
          <div>
            <h3 id="feedback-modal-title">{t("feedback.title")}</h3>
            <p>{t("feedback.subtitle")}</p>
          </div>

          <button
            type="button"
            className="collection-modal__close"
            onClick={handleClose}
            aria-label={appearance.language === "en" ? "Close" : "Fechar"}
            disabled={isSending}
          >
            <ModalCloseIcon />
          </button>
        </header>

        <div className="collection-modal__content">
          <label className="feedback-modal__field" htmlFor="feedback-message">
            <span>{t("feedback.messageLabel")}</span>
          </label>
          <div className="feedback-modal__input-shell">
            <textarea
              id="feedback-message"
              value={message}
              maxLength={maxFeedbackLength}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t("feedback.placeholder")}
              disabled={isSending}
              autoFocus
            />
          </div>
        </div>

        <footer className="feedback-modal__actions">
          <button
            type="button"
            className="button button--outline"
            onClick={handleClose}
            disabled={isSending}
          >
            {t("feedback.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSending ? t("feedback.sending") : t("feedback.send")}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
