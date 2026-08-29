import { useLanguage } from "./hooks/useLanguage";
import { useReveal } from "./hooks/useReveal";
import { PolicyPage } from "./pages/PolicyPage";
import { FaqSection } from "./sections/FaqSection";
import { FeaturesSection } from "./sections/FeaturesSection";
import { HeroSection } from "./sections/HeroSection";
import { InstallSection } from "./sections/InstallSection";
import { PremiumSection } from "./sections/PremiumSection";
import { ShowcaseSection } from "./sections/ShowcaseSection";
import { SiteFooter } from "./sections/SiteFooter";
import { SiteHeader } from "./sections/SiteHeader";
import { SyncSection } from "./sections/SyncSection";
import type { PolicyContent } from "./content/types";

/** As políticas são páginas estáticas próprias (/terms, /privacy, /refund). */
function policySlug(): PolicyContent["slug"] | null {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/terms") return "terms";
  if (path === "/privacy") return "privacy";
  if (path === "/refund") return "refund";
  return null;
}

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const slug = policySlug();
  useReveal(!slug, language);

  return (
    <div className="site-shell">
      <a className="site-skip-link" href="#conteudo">
        {t.skipToContent}
      </a>
      <SiteHeader
        t={t}
        language={language}
        onLanguageChange={setLanguage}
        compact={Boolean(slug)}
      />

      {/* A troca de idioma remonta o conteúdo: o crossfade evita que a página
          inteira pisque texto novo sem transição. */}
      <main id="conteudo" className="site-main" key={language}>
        {slug ? (
          <PolicyPage policy={t.policies[slug]} />
        ) : (
          <>
            <HeroSection t={t} language={language} />
            <ShowcaseSection t={t} language={language} />
            <FeaturesSection t={t} />
            <SyncSection t={t} />
            <PremiumSection t={t} language={language} />
            <InstallSection t={t} />
            <FaqSection t={t} />
          </>
        )}
      </main>

      <SiteFooter t={t} />
    </div>
  );
}
