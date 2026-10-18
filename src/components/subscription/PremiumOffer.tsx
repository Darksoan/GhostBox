import { useState, type ReactNode, type Ref } from "react";
import {
  Check,
  ChevronDown,
  CloudUpload,
  RotateCcw,
  ScreenShare,
  ShieldCheck,
  User,
} from "lucide-react";

import { useSettings } from "../../context/settings";
import { useSubscriptionCheckout } from "../../hooks/useSubscriptionCheckout";
import { planMonthlyPriceLabel, planPriceLabel } from "../../lib/subscriptionPricing";
import type { SubscriptionPlanId as PaidSubscriptionPlanId } from "../../lib/ghostboxApi.types";
import stripeLogo from "../../../Icons/stripe-original.svg";

type Language = "pt" | "en";

const PLAN_ORDER: PaidSubscriptionPlanId[] = ["monthly", "quarterly"];

const BENEFIT_ICONS = [CloudUpload, ScreenShare, RotateCcw, User] as const;

/**
 * A lista fechada é só rótulo — cinco linhas, nenhum parágrafo. O detalhe vive
 * atrás do dropdown, então volta a ser frase inteira: texto escondido não
 * compete por atenção, e quem abre está pedindo a explicação completa.
 */
function benefitList(language: Language) {
  const pt = [
    ["Backup em nuvem", "Cada save vai para a nuvem assim que o jogo fecha, sem você abrir nada."],
    ["Sincronização entre PCs", "Continue de onde parou em qualquer máquina com o GhostBox instalado."],
    ["Restauração automática", "Instalou de novo? O save volta sozinho na primeira abertura do jogo."],
    ["Perfil personalizado", "Banner, avatar e vitrine de conquistas no seu perfil público."],
  ];
  const en = [
    ["Cloud backup", "Every save reaches the cloud the moment the game closes, with nothing to open."],
    ["Sync across PCs", "Pick up where you left off on any machine running GhostBox."],
    ["Automatic restore", "Reinstalled? Your save comes back on its own the first time the game launches."],
    ["Custom profile", "Banner, avatar and an achievement showcase on your public profile."],
  ];
  return (language === "en" ? en : pt).map(([title, description], index) => ({
    title,
    description,
    Icon: BENEFIT_ICONS[index],
  }));
}

type PremiumOfferProps = {
  /** O modal foca o botão principal ao abrir; a aba de Ajustes não precisa. */
  ctaRef?: Ref<HTMLButtonElement>;
  /**
   * Substitui a coluna de decisão. Quem já assina não escolhe plano, mas
   * continua vendo o mesmo argumento à esquerda — é o slot que evita duplicar a
   * coluna do pitch só para trocar o que fica à direita.
   */
  checkout?: ReactNode;
};

/**
 * A oferta Premium — argumento à esquerda, decisão à direita.
 *
 * Devolve as duas colunas como fragmento, sem container próprio: quem usa é que
 * fornece a grade (`.premium-offer`). É o que permite o modal e a aba
 * Ajustes › Assinatura mostrarem exatamente a mesma tela sem duplicar markup.
 *
 * O estado do acordeão mora aqui, e não em quem chama, porque o modal desmonta
 * a árvore ao fechar: reabrir devolve a lista recolhida de graça.
 */
export function PremiumOffer({ ctaRef, checkout }: PremiumOfferProps) {
  const { appearance, t } = useSettings();
  const language = appearance.language as Language;
  const copy = (pt: string, en: string) => (language === "en" ? en : pt);

  const [selectedPlanId, setSelectedPlanId] = useState<PaidSubscriptionPlanId>("quarterly");
  // Um detalhe por vez: é o que mantém o crescimento da lista limitado a uma
  // reserva de altura fixa, e com ela a superfície não muda de tamanho.
  const [openBenefit, setOpenBenefit] = useState<string | null>(null);
  const { checkoutPlan, startCheckout } = useSubscriptionCheckout();

  const benefits = benefitList(language);
  const selectedPrice = planPriceLabel(selectedPlanId, language);
  const selectedCadence = t(`subscription.plans.${selectedPlanId}.cadence`);
  const checkoutBusy = checkoutPlan === selectedPlanId;

  return (
    <>
      <div className="premium-modal__pitch">
        <span className="premium-modal__eyebrow">
          <span className="premium-modal__eyebrow-icon" aria-hidden="true" />
          {"GhostBox "}
          <strong>Premium</strong>
        </span>

        <h2 className="premium-modal__title">
          {copy("Seus saves em qualquer PC.", "Your saves on any PC.")}
        </h2>

        <ul className="premium-modal__benefits">
          {benefits.map(({ title, description, Icon }, index) => {
            const isOpen = openBenefit === title;
            const panelId = `premium-benefit-panel-${index}`;

            return (
              <li
                key={title}
                className={`premium-modal__benefit${isOpen ? " is-open" : ""}`}
              >
                <button
                  type="button"
                  className="premium-modal__benefit-toggle"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpenBenefit((current) => (current === title ? null : title))
                  }
                >
                  <span className="premium-modal__benefit-icon" aria-hidden="true">
                    <Icon size={24} strokeWidth={1.25} />
                  </span>
                  <strong>{title}</strong>
                  <ChevronDown
                    size={20}
                    strokeWidth={2}
                    className="premium-modal__benefit-chevron"
                    aria-hidden="true"
                  />
                </button>

                {/* Sem `hidden`: o painel fica no DOM para a altura poder
                    animar. `visibility` no filho é o que o tira da árvore de
                    acessibilidade e do foco enquanto está fechado. */}
                <div id={panelId} className="premium-modal__benefit-panel">
                  <p>{description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {checkout ?? (
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
                  <Check size={20} strokeWidth={2} />
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
          <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
          <span>
            {copy("Pagamento via ", "Payment via ")}
            <img className="premium-modal__stripe" src={stripeLogo} alt="Stripe" />
            {copy(" · Cancele quando quiser", " · Cancel anytime")}
          </span>
        </p>
      </aside>
      )}
    </>
  );
}
