import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  CloudUpload,
  CreditCard,
  Download,
  ExternalLink,
  RotateCcw,
  ScreenShare,
  ShieldCheck,
  User,
} from "lucide-react";

import { useSettings } from "../../context/settings";
import { useSubscriptionCheckout } from "../../hooks/useSubscriptionCheckout";
import { ghostboxApi } from "../../lib/ghostboxApi";
import { planMonthlyPriceLabel, planPriceLabel } from "../../lib/subscriptionPricing";
import type {
  SubscriptionPlanId as PaidSubscriptionPlanId,
  SubscriptionStatusResult,
} from "../../lib/ghostboxApi.types";
import { SubscriptionBackdrop } from "../subscription/SubscriptionBackdrop";
import { ModalCloseIcon } from "../ui/ModalCloseIcon";
import ghostIcon from "../../../Icons/ghost-solid.png";
import stripeLogo from "../../../Icons/stripe-original.svg";

type SubscriptionModalProps = {
  open: boolean;
  onClose: () => void;
};

type Language = "pt" | "en";

const PLAN_ORDER: PaidSubscriptionPlanId[] = ["monthly", "quarterly"];

const BENEFIT_ICONS = [CloudUpload, ScreenShare, RotateCcw, User, Download] as const;

/**
 * Benefícios com uma linha de apoio: a lista antiga era só rótulo, e rótulo
 * sozinho não explica o que a assinatura faz enquanto o jogo está fechado.
 */
function benefitList(language: Language) {
  const pt = [
    ["Backup em nuvem automático", "Cada save vai para a nuvem assim que o jogo fecha."],
    ["Sincronização entre PCs", "Continue de onde parou em qualquer máquina com o GhostBox."],
    ["Restauração automática", "Instalou de novo? O save volta sozinho na primeira abertura."],
    ["Perfil personalizado", "Banner, avatar e vitrine de conquistas no seu perfil."],
    ["Downloads nativos", "Fila de download integrada, sem depender de outro cliente."],
  ];
  const en = [
    ["Automatic cloud backup", "Every save reaches the cloud the moment the game closes."],
    ["Sync across PCs", "Pick up where you left off on any machine running GhostBox."],
    ["Automatic restore", "Reinstalled? Your save comes back on the first launch."],
    ["Custom profile", "Banner, avatar, and an achievement showcase on your profile."],
    ["Native downloads", "Built-in download queue, no second client required."],
  ];
  return (language === "en" ? en : pt).map(([title, description], index) => ({
    title,
    description,
    Icon: BENEFIT_ICONS[index],
  }));
}

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
  const [selectedPlanId, setSelectedPlanId] = useState<PaidSubscriptionPlanId>("quarterly");
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResult | null>(null);
  const { checkoutPlan, startCheckout, portalFlow, openBillingPortal } = useSubscriptionCheckout();
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
  const benefits = benefitList(language);
  const selectedPrice = planPriceLabel(selectedPlanId, language);
  const selectedCadence = t(`subscription.plans.${selectedPlanId}.cadence`);
  const checkoutBusy = checkoutPlan === selectedPlanId;

  return createPortal(
    <div
      className={`premium-modal__scrim${closingClass}`}
      onClick={open ? onClose : undefined}
    >
      <div className="premium-modal__drag" data-tauri-drag-region aria-hidden="true" />
      <SubscriptionBackdrop />

      <section
        className={`premium-modal${closingClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("subscription.title")}
        style={{ ["--subscription-ghost-icon" as string]: `url(${ghostIcon})` }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="premium-modal__close"
          onClick={onClose}
          aria-label={copy("Fechar", "Close")}
        >
          <ModalCloseIcon />
        </button>

        <div className="premium-modal__pitch">
          <span className="premium-modal__eyebrow">
            <span className="premium-modal__eyebrow-icon" aria-hidden="true" />
            {"GhostBox "}
            <strong>Premium</strong>
          </span>

          <h2 className="premium-modal__title">
            {copy("Seus saves em qualquer PC, sem você pensar nisso.", "Your saves on any PC, without thinking about it.")}
          </h2>

          <ul className="premium-modal__benefits">
            {benefits.map(({ title, description, Icon }) => (
              <li key={title}>
                <span className="premium-modal__benefit-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {isPremium ? (
          <aside className="premium-modal__checkout premium-modal__checkout--active">
            <span className="premium-modal__active-badge">
              <Check size={14} strokeWidth={2.4} aria-hidden="true" />
              {copy("Assinatura ativa", "Subscription active")}
            </span>

            <p className="premium-modal__active-copy">
              {copy(
                "Tudo ligado: seus saves sobem sozinhos e voltam em qualquer PC.",
                "Everything is on: your saves upload on their own and return on any PC."
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
        ) : (
          <aside className="premium-modal__checkout">
            {/* Os dois planos ficam visíveis ao mesmo tempo, com o preço mensal
                equivalente: a economia do trimestral só é argumento quando dá
                para comparar sem trocar de aba. */}
            <div
              className="premium-modal__plans"
              role="radiogroup"
              aria-label={copy("Escolha o período da assinatura", "Choose billing period")}
            >
              {PLAN_ORDER.map((planId) => {
                const selected = planId === selectedPlanId;
                return (
                  <button
                    key={planId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`premium-modal__plan${selected ? " is-selected" : ""}`}
                    onClick={() => setSelectedPlanId(planId)}
                  >
                    <span className="premium-modal__plan-mark" aria-hidden="true">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className="premium-modal__plan-name">
                      {t(`subscription.plans.${planId}.title`)}
                      {planId === "quarterly" && (
                        <em>{`−${t("subscription.plans.quarterly.savingsValue")}`}</em>
                      )}
                    </span>
                    <span className="premium-modal__plan-price">
                      <strong>{planPriceLabel(planId, language)}</strong>
                      <span>
                        {planId === "quarterly"
                          ? `${planMonthlyPriceLabel(planId, language)} ${t("subscription.plans.monthly.cadence")}`
                          : t("subscription.plans.monthly.cadence")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="premium-modal__total">
              <strong>{selectedPrice}</strong>
              <span>{selectedCadence}</span>
            </p>

            <button
              type="button"
              className="premium-modal__cta"
              ref={ctaRef}
              disabled={checkoutBusy}
              onClick={() => void startCheckout(selectedPlanId)}
            >
              {checkoutBusy ? copy("Abrindo…", "Opening…") : t("subscription.actions.subscribe")}
            </button>

            <p className="premium-modal__note">
              <ShieldCheck size={18} strokeWidth={2} aria-hidden="true" />
              <span>
                {copy("Pagamento processado pela ", "Payment processed by ")}
                <img className="premium-modal__stripe" src={stripeLogo} alt="Stripe" />
                {copy(". Cancele quando quiser.", ". Cancel anytime.")}
              </span>
            </p>
          </aside>
        )}
      </section>
    </div>,
    document.body
  );
}
