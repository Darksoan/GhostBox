import { Check, X } from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useSettings } from "../../context/settings";
import ghostIcon from "../../../Icons/ghost-solid.png";

type SubscriptionPlanId = "free" | "monthly" | "quarterly";

type SubscriptionPlansProps = {
  surface?: "modal" | "settings";
  enterDelay?: string;
};

const benefits: Record<SubscriptionPlanId, string[]> = {
  free: ["subscription.benefits.backupSync"],
  monthly: ["subscription.benefits.localAndCloudBackups", "subscription.benefits.sync", "subscription.benefits.automaticRestore"],
  quarterly: ["subscription.benefits.localAndCloudBackups", "subscription.benefits.sync", "subscription.benefits.automaticRestore"],
};

const details = [
  {
    title: "subscription.details.payments.title",
    items: [
      "subscription.details.payments.card",
      "subscription.details.payments.methods",
      "subscription.details.payments.security",
    ],
  },
  {
    title: "subscription.details.billing.title",
    items: [
      "subscription.details.billing.renewal",
      "subscription.details.billing.activation",
      "subscription.details.billing.receipt",
    ],
  },
  {
    title: "subscription.details.refunds.title",
    items: [
      "subscription.details.refunds.window",
      "subscription.details.refunds.prorated",
      "subscription.details.refunds.abuse",
    ],
  },
  {
    title: "subscription.details.cancel.title",
    items: [
      "subscription.details.cancel.anytime",
      "subscription.details.cancel.access",
      "subscription.details.cancel.data",
    ],
  },
];

const steps = [
  "subscription.steps.choose",
  "subscription.steps.checkout",
  "subscription.steps.sync",
];

export function SubscriptionPlans({
  surface = "settings",
  enterDelay,
}: SubscriptionPlansProps) {
  const { t } = useSettings();
  const { showToast } = useOverlay();

  const plans: Array<{
    id: SubscriptionPlanId;
    title: string;
    price: string;
    cadence: string;
    badge?: string;
    savings?: {
      label: string;
      value: string;
    };
    action: string;
    disabled?: boolean;
  }> = [
    {
      id: "free",
      title: t("subscription.plans.free.title"),
      price: t("subscription.plans.free.price"),
      cadence: t("subscription.plans.free.cadence"),
      action: t("subscription.plans.free.action"),
      disabled: true,
    },
    {
      id: "monthly",
      title: t("subscription.plans.monthly.title"),
      price: "R$ 6,99",
      cadence: t("subscription.plans.monthly.cadence"),
      action: t("subscription.actions.subscribe"),
    },
    {
      id: "quarterly",
      title: t("subscription.plans.quarterly.title"),
      price: "R$ 14,99",
      cadence: t("subscription.plans.quarterly.cadence"),
      badge: t("subscription.plans.quarterly.badge"),
      savings: {
        label: t("subscription.plans.quarterly.savingsLabel"),
        value: t("subscription.plans.quarterly.savingsValue"),
      },
      action: t("subscription.actions.subscribe"),
    },
  ];

  function handleSubscribe(planId: SubscriptionPlanId) {
    if (planId === "free") return;
    showToast(
      t("subscription.checkoutPending.title"),
      t("subscription.checkoutPending.message"),
      "success"
    );
  }

  return (
    <section
      className={`subscription-plans subscription-plans--${surface} settings-panel__animated-block`}
      style={enterDelay ? { ["--settings-enter-delay" as string]: enterDelay } : undefined}
      aria-label={t("subscription.title")}
    >
      <header className="subscription-plans__header">
        <span className="subscription-plans__eyebrow">
          <span
            className="subscription-plans__eyebrow-icon"
            style={{ ["--subscription-ghost-icon" as string]: `url(${ghostIcon})` }}
            aria-hidden="true"
          />
          {"GhostBox "}
          <strong className="subscription-plans__eyebrow-premium">Premium</strong>
        </span>
        <h3>{t("subscription.title")}</h3>
        <p>{t("subscription.description")}</p>
      </header>

      <div className="subscription-plans__grid">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={`subscription-plan-card${plan.disabled ? " subscription-plan-card--disabled" : ""}`}
          >
            {plan.badge && <div className="subscription-plan-card__badge">{plan.badge}</div>}

            <div className="subscription-plan-card__top">
              <h4>{plan.title}</h4>
              <div className="subscription-plan-card__price">{plan.price}</div>
              <span>{plan.cadence}</span>
            </div>

            <ul className="subscription-plan-card__benefits">
              {benefits[plan.id].map((benefitKey) => (
                <li
                  key={benefitKey}
                  className={plan.id === "free" ? "subscription-plan-card__benefit--disabled" : undefined}
                >
                  {plan.id === "free" ? (
                    <X size={15} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Check size={15} strokeWidth={2} aria-hidden="true" />
                  )}
                  <span>{t(benefitKey)}</span>
                </li>
              ))}
            </ul>

            {plan.savings && (
              <div className="subscription-plan-card__savings">
                <span>{plan.savings.label}</span>
                <strong>{plan.savings.value}</strong>
              </div>
            )}

            <button
              type="button"
              className="subscription-plan-card__action"
              disabled={plan.disabled}
              onClick={() => handleSubscribe(plan.id)}
            >
              {plan.action}
            </button>
          </article>
        ))}
      </div>

      <div className="subscription-plans__steps" aria-label={t("subscription.steps.title")}>
        {steps.map((stepKey, index) => (
          <div key={stepKey} className="subscription-plans__step">
            <span>{index + 1}</span>
            <strong>{t(stepKey)}</strong>
          </div>
        ))}
      </div>

      <div className="subscription-plans__details">
        {details.map((section) => (
          <article key={section.title} className="subscription-plans__detail-card">
            <h4>{t(section.title)}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <footer className="subscription-plans__policy-note">
        <strong>{t("subscription.policy.title")}</strong>
        <p>{t("subscription.policy.description")}</p>
      </footer>
    </section>
  );
}
