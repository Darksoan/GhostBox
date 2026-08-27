import { ArrowRight, Download } from "lucide-react";
import { AppShot } from "../components/AppShot";
import { DOWNLOAD_URL } from "../content/links";
import { useParallax } from "../hooks/useParallax";
import type { SiteContent } from "../content";
import "./HeroSection.scss";

/** Cascata do hero: 90ms por degrau, teto de 360ms para o bloco inteiro. */
function heroDelay(step: number): React.CSSProperties {
  return { animationDelay: `${Math.min(step * 90, 360)}ms` };
}

export function HeroSection({ t }: { t: SiteContent }) {
  const mockupRef = useParallax<HTMLDivElement>(40);

  return (
    <section className="hero">
      <div className="hero__ambient" aria-hidden="true" />
      <div className="site-container hero__inner">
        <div className="hero__copy">
          <p className="site-eyebrow hero__eyebrow hero__enter" style={heroDelay(0)}>
            {t.hero.eyebrow}
          </p>
          <h1 className="hero__title hero__enter" style={heroDelay(1)}>
            {t.hero.title}
          </h1>
          <p className="site-lead hero__lead hero__enter" style={heroDelay(2)}>
            {t.hero.lead}
          </p>
          <div className="hero__actions hero__enter" style={heroDelay(3)}>
            <a className="site-button site-button--primary" href={DOWNLOAD_URL}>
              <Download size={16} strokeWidth={2} />
              {t.hero.ctaPrimary}
            </a>
            <a className="site-button site-button--secondary" href="#premium">
              {t.hero.ctaSecondary}
              <ArrowRight size={16} strokeWidth={2} />
            </a>
          </div>
          <p className="hero__note hero__enter" style={heroDelay(4)}>
            {t.hero.note}
          </p>
        </div>

        <div className="hero__mockup hero__enter" style={heroDelay(2)} ref={mockupRef}>
          <AppShot variant="home" label={t.hero.mockupLabel} />
        </div>
      </div>
    </section>
  );
}
