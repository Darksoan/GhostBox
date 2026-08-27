import { Plus } from "lucide-react";
import { staggerDelay } from "../hooks/useReveal";
import type { SiteContent } from "../content";
import "./FaqSection.scss";

export function FaqSection({ t }: { t: SiteContent }) {
  return (
    <section className="faq site-section" id="perguntas" aria-labelledby="faq-title">
      <div className="site-container faq__inner">
        <div className="faq__head reveal">
          <p className="site-eyebrow">{t.faq.eyebrow}</p>
          <h2 className="site-title" id="faq-title">
            {t.faq.title}
          </h2>
        </div>

        <ul className="faq__list">
          {t.faq.items.map((item, index) => (
            <li className="reveal" key={item.question} style={staggerDelay(index, 50)}>
              <details className="faq__item">
                <summary className="faq__question">
                  <span>{item.question}</span>
                  <Plus className="faq__icon" size={18} strokeWidth={1.5} aria-hidden="true" />
                </summary>
                <div className="faq__answer-wrap">
                  <p className="faq__answer">{item.answer}</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
