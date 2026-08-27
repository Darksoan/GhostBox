import type { SiteContent } from "../content";
import "./SiteFooter.scss";

export function SiteFooter({ t }: { t: SiteContent }) {
  return (
    <footer className="site-footer">
      <div className="site-container site-footer__inner">
        <div className="site-footer__brand">
          <img src="/ghost-solid.png" alt="" width={28} height={28} />
          <p className="site-footer__tagline">{t.footer.tagline}</p>
          <p className="site-footer__rights">{t.footer.rights}</p>
        </div>

        <nav className="site-footer__links" aria-label={t.footer.tagline}>
          {t.footer.legal.map((link) => (
            <a className="site-footer__link" key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          {t.footer.social.map((link) => (
            <a
              className="site-footer__link"
              key={link.href}
              href={link.href}
              rel="noreferrer noopener"
              target="_blank"
            >
              <img className="site-footer__icon" src="/discord.svg" alt="" width={16} height={16} />
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
