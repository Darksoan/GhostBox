import { ArrowLeft } from "lucide-react";
import type { PolicyContent } from "../content/types";
import "./PolicyPage.scss";

export function PolicyPage({ policy }: { policy: PolicyContent }) {
  return (
    <article className="policy site-container">
      <p className="site-eyebrow">{policy.eyebrow}</p>
      <h1 className="policy__title">{policy.title}</h1>
      <div className="policy__body">
        {policy.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </div>
      <a className="site-button site-button--secondary policy__back" href="/">
        <ArrowLeft size={16} strokeWidth={2} />
        {policy.back}
      </a>
    </article>
  );
}
