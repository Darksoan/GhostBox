import { Bell, Compass, Download, LibraryBig, Star, Trophy } from "lucide-react";
import { staggerDelay } from "../hooks/useReveal";
import type { FeatureItem, SiteContent } from "../content/types";
import "./FeaturesSection.scss";

const ICONS: Record<FeatureItem["icon"], typeof Bell> = {
  LibraryBig,
  Compass,
  Star,
  Trophy,
  Download,
  Bell,
};

export function FeaturesSection({ t }: { t: SiteContent }) {
  return (
    <section className="features site-section" id="recursos" aria-labelledby="features-title">
      <div className="site-container">
        <div className="features__head reveal">
          <p className="site-eyebrow">{t.features.eyebrow}</p>
          <h2 className="site-title" id="features-title">
            {t.features.title}
          </h2>
          <p className="site-lead">{t.features.lead}</p>
        </div>

        <ul className="features__grid">
          {t.features.items.map((item, index) => {
            const Icon = ICONS[item.icon];
            return (
              <li className="features__card reveal" key={item.title} style={staggerDelay(index)}>
                <span className="features__icon">
                  <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <h3 className="features__card-title">{item.title}</h3>
                <p className="features__card-body">{item.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
