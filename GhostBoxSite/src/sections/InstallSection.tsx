import { Download } from "lucide-react";
import { DOWNLOAD_URL } from "../content/links";
import { staggerDelay } from "../hooks/useReveal";
import type { SiteContent } from "../content";
import "./InstallSection.scss";

export function InstallSection({ t }: { t: SiteContent }) {
  return (
    <section className="install site-section" id="instalacao" aria-labelledby="install-title">
      <div className="site-container">
        <div className="install__head reveal">
          <p className="site-eyebrow">{t.install.eyebrow}</p>
          <h2 className="site-title" id="install-title">
            {t.install.title}
          </h2>
        </div>

        <ol className="install__steps">
          {t.install.steps.map((step, index) => (
            <li className="install__step reveal" key={step.title} style={staggerDelay(index)}>
              <span className="install__number">{index + 1}</span>
              <h3 className="install__step-title">{step.title}</h3>
              <p className="install__step-body">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="install__cta reveal">
          <a className="site-button site-button--primary" href={DOWNLOAD_URL}>
            <Download size={16} strokeWidth={2} />
            {t.install.cta}
          </a>
          <p className="install__requirements">{t.install.requirements}</p>
        </div>
      </div>
    </section>
  );
}
