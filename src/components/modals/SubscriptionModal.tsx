import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useSettings } from "../../context/settings";
import { SubscriptionPlans } from "../subscription/SubscriptionPlans";

type SubscriptionModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SubscriptionModal({ open, onClose }: SubscriptionModalProps) {
  const { appearance, t } = useSettings();
  const [shouldRender, setShouldRender] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }

    const closeTimer = window.setTimeout(() => setShouldRender(false), 180);

    return () => window.clearTimeout(closeTimer);
  }, [open]);

  if (!shouldRender || typeof document === "undefined") return null;

  const closingClass = open ? "" : " backdrop--subscription-closing";
  const modalClosingClass = open ? "" : " subscription-modal--closing";

  return createPortal(
    <div className={`backdrop backdrop--subscription${closingClass}`} onClick={open ? onClose : undefined}>
      <button
        type="button"
        className="subscription-modal__close"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={appearance.language === "en" ? "Close" : "Fechar"}
      >
        <X size={18} strokeWidth={1.7} />
      </button>

      <section
        className={`subscription-modal${modalClosingClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("subscription.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <SubscriptionPlans surface="modal" />
      </section>
    </div>,
    document.body
  );
}
