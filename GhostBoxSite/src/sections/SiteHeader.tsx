import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LanguageToggle } from "../components/LanguageToggle";
import { DOWNLOAD_URL } from "../content/links";
import type { Language, SiteContent } from "../content";
import "./SiteHeader.scss";

interface SiteHeaderProps {
  t: SiteContent;
  language: Language;
  onLanguageChange: (next: Language) => void;
  /** Nas páginas de política o menu de âncoras não se aplica. */
  compact?: boolean;
}

export function SiteHeader({ t, language, onLanguageChange, compact = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="site-header">
      <div className="site-header__bar site-container">
        <a className="site-header__brand" href="/">
          <img src="/ghost-solid.png" alt="" width={24} height={24} />
          <span>{t.nav.brand}</span>
        </a>

        {!compact && (
          <nav className="site-header__nav" aria-label={t.nav.brand}>
            {t.nav.links.map((link) => (
              <a key={link.href} className="site-header__link" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <div className="site-header__actions">
          <LanguageToggle
            language={language}
            onChange={onLanguageChange}
            label={t.nav.languageLabel}
          />
          <a className="site-button site-button--primary site-header__cta" href={DOWNLOAD_URL}>
            {t.nav.cta}
          </a>
          {!compact && (
            <button
              ref={toggleRef}
              type="button"
              className="site-header__menu-toggle"
              aria-expanded={open}
              aria-controls="site-header-menu"
              aria-label={open ? t.nav.menuClose : t.nav.menuOpen}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>

      {!compact && (
        <div className="site-header__menu" id="site-header-menu" hidden={!open}>
          <nav className="site-container site-header__menu-nav" aria-label={t.nav.brand}>
            {t.nav.links.map((link) => (
              <a
                key={link.href}
                className="site-header__menu-link"
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
