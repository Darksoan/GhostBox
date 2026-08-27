import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  CreditCard,
  ExternalLink,
} from "lucide-react";

import { useSettings } from "../../context/settings";
import { useSubscriptionCheckout } from "../../hooks/useSubscriptionCheckout";
import { ghostboxApi } from "../../lib/ghostboxApi";
import type { SubscriptionStatusResult } from "../../lib/ghostboxApi.types";
import { PremiumOffer } from "../subscription/PremiumOffer";
import { SubscriptionBackdrop } from "../subscription/SubscriptionBackdrop";
import ghostIcon from "../../../Icons/ghost-solid.png";

type SubscriptionModalProps = {
  open: boolean;
  onClose: () => void;
};

type Language = "pt" | "en";

function formatBillingDate(value: string | null | undefined, language: Language) {
  if (!value) return language === "en" ? "Not available" : "Indisponível";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", {
    dateStyle: "medium",
  }).format(timestamp);
}

export function SubscriptionModal({ open, onClose }: SubscriptionModalProps) {
  const { appearance, t } = useSettings();
  const language = appearance.language as Language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);

  const [shouldRender, setShouldRender] = useState(open);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResult | null>(null);
  const { portalFlow, openBillingPortal } = useSubscriptionCheckout();
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }

    const closeTimer = window.setTimeout(() => setShouldRender(false), 140);

    return () => window.clearTimeout(closeTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void ghostboxApi.getSubscriptionStatus()
      .then((status) => {
        // Uma consulta que falha não pode apagar o painel: sem status, a oferta
        // continua sendo a tela correta para quem abriu o modal.
        if (!cancelled && status) setSubscriptionStatus(status);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    ctaRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!shouldRender || typeof document === "undefined") return null;

  const isPremium = subscriptionStatus?.subscription.isPremium === true;
  const closingClass = open ? "" : " premium-modal--closing";

  return createPortal(
    <div
      className={`premium-modal__scrim${closingClass}`}
      onClick={open ? onClose : undefined}
    >
      <div className="premium-modal__drag" data-tauri-drag-region aria-hidden="true" />
      <SubscriptionBackdrop />

      <section
        className={`premium-modal premium-offer${closingClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("subscription.title")}
        style={{ ["--subscription-ghost-icon" as string]: `url(${ghostIcon})` }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Sem botão de fechar: o clique fora do diálogo e o Esc já fecham, e o
            "X" era o único elemento de chrome numa superfície que é toda
            argumento. */}
        <PremiumOffer
          ctaRef={ctaRef}
          checkout={isPremium ? (
          <aside className="premium-modal__checkout premium-modal__checkout--active">
            <span className="premium-modal__active-badge">
              <Check size={14} strokeWidth={2.4} aria-hidden="true" />
              {copy("Assinatura ativa", "Subscription active")}
            </span>

            <p className="premium-modal__active-copy">
              {copy(
                "Seus saves sobem e voltam sozinhos.",
                "Your saves upload and return on their own."
              )}
            </p>

            <div className="premium-modal__active-row">
              <CalendarClock size={16} strokeWidth={2} aria-hidden="true" />
              <span>
                {subscriptionStatus?.subscription.cancelAtPeriodEnd
                  ? copy("Acesso até", "Access until")
                  : copy("Próxima cobrança", "Next billing")}
              </span>
              <strong>{formatBillingDate(subscriptionStatus?.subscription.currentPeriodEnd, language)}</strong>
            </div>

            <button
              type="button"
              className="premium-modal__cta"
              ref={ctaRef}
              disabled={Boolean(portalFlow)}
              onClick={() => void openBillingPortal("manage")}
            >
              {portalFlow === "manage"
                ? copy("Abrindo…", "Opening…")
                : copy("Gerenciar assinatura", "Manage subscription")}
              <ExternalLink size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="premium-modal__secondary"
              disabled={Boolean(portalFlow)}
              onClick={() => void openBillingPortal("payment_method_update")}
            >
              <CreditCard size={15} strokeWidth={2} aria-hidden="true" />
              {portalFlow === "payment_method_update"
                ? copy("Abrindo…", "Opening…")
                : copy("Alterar método de pagamento", "Change payment method")}
            </button>
          </aside>
          ) : undefined}
        />
      </section>
    </div>,
    document.body
  );
}
