import { Check } from "lucide-react";
import { planMonthlyPriceLabel, planPriceLabel } from "../../../src/lib/subscriptionPricing";
import { AnimatedPrice } from "../components/AnimatedPrice";
import { fill, type Language, type SiteContent } from "../content";
import { staggerDelay } from "../hooks/useReveal";
import "./PremiumSection.scss";

interface PremiumSectionProps {
  t: SiteContent;
  language: Language;
}

export function PremiumSection({ t, language }: PremiumSectionProps) {
  return (
    <section className="premium site-section" id="premium" aria-labelledby="premium-title">
      <div className="site-container">
        <div className="premium__head reveal">
          <p className="site-eyebrow">{t.premium.eyebrow}</p>
          <h2 className="site-title" id="premium-title">
            {t.premium.title}
          </h2>
          <p className="site-lead">{t.premium.lead}</p>
        </div>

        <ul className="premium__plans">
          {t.premium.plans.map((plan, index) => (
            <li
              className="premium__plan reveal"
              key={plan.id}
              data-highlight={Boolean(plan.highlight)}
              style={staggerDelay(index, 90)}
            >
              <div className="premium__plan-head">
                <h3 className="premium__plan-name">{plan.name}</h3>
                {plan.highlight && <span className="premium__badge">{plan.highlight}</span>}
              </div>

              <p className="premium__price">
                <span className="premium__price-value">
                  <AnimatedPrice label={planPriceLabel(plan.id, language)} />
                </span>
                <span className="premium__price-cadence">{plan.cadence}</span>
              </p>

              {plan.perMonth && (
                <p className="premium__per-month">
                  {fill(plan.perMonth, { price: planMonthlyPriceLabel(plan.id, language) })}
                </p>
              )}

              <ul className="premium__benefits">
                {plan.benefits.map((benefit) => (
                  <li className="premium__benefit" key={benefit}>
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <div className="premium__cta reveal">
          <a className="site-button site-button--gold" href="#instalacao">
            {t.premium.cta}
          </a>
          <p className="premium__cta-note">{t.premium.ctaNote}</p>
        </div>
      </div>
    </section>
  );
}
