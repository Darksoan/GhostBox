import { CloudUpload, RefreshCw, ShieldCheck } from "lucide-react";
import { staggerDelay } from "../hooks/useReveal";
import type { SiteContent } from "../content";
import "./SyncSection.scss";

const POINT_ICONS = [CloudUpload, RefreshCw, ShieldCheck];

export function SyncSection({ t }: { t: SiteContent }) {
  return (
    <section className="sync site-section" aria-labelledby="sync-title">
      <div className="site-container sync__panel">
        <div className="sync__head reveal">
          <p className="site-eyebrow">{t.sync.eyebrow}</p>
          <h2 className="site-title" id="sync-title">
            {t.sync.title}
          </h2>
          <p className="site-lead">{t.sync.body}</p>
        </div>

        <ul className="sync__points">
          {t.sync.points.map((point, index) => {
            const Icon = POINT_ICONS[index] ?? ShieldCheck;
            return (
              <li className="sync__point reveal" key={point.title} style={staggerDelay(index)}>
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="sync__point-title">{point.title}</h3>
                <p className="sync__point-body">{point.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
