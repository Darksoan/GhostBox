import { Check } from "lucide-react";
import { AppShot } from "../components/AppShot";
import { staggerDelay } from "../hooks/useReveal";
import type { SiteContent } from "../content";
import "./ShowcaseSection.scss";

export function ShowcaseSection({ t }: { t: SiteContent }) {
  return (
    <section className="showcase site-section" aria-labelledby="showcase-title">
      <div className="site-container">
        <h2 className="site-title reveal" id="showcase-title">
          {t.showcase.title}
        </h2>

        <div className="showcase__items">
          {t.showcase.items.map((item) => (
            <article className="showcase__item" key={item.id}>
              <div className="showcase__copy reveal">
                <p className="site-eyebrow">{item.eyebrow}</p>
                <h3 className="showcase__item-title">{item.title}</h3>
                <p className="site-lead">{item.body}</p>
                <ul className="showcase__bullets">
                  {item.bullets.map((bullet) => (
                    <li className="showcase__bullet" key={bullet}>
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="showcase__visual reveal" style={staggerDelay(1)}>
                <AppShot variant={item.id} label={item.title} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
