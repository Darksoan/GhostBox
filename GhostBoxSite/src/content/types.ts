export type Language = "pt" | "en";

export interface LinkItem {
  label: string;
  href: string;
}

export interface NavContent {
  brand: string;
  links: LinkItem[];
  cta: string;
  menuOpen: string;
  menuClose: string;
  languageLabel: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  lead: string;
  ctaPrimary: string;
  ctaSecondary: string;
  note: string;
  mockupLabel: string;
}

/** Bloco de prova: texto + um recorte da interface renderizado em DOM. */
export interface ShowcaseItem {
  id: "library" | "catalogue" | "achievements";
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}

export interface FeatureItem {
  /** Nome do ícone em lucide-react, resolvido em FeaturesSection. */
  icon:
    | "LibraryBig"
    | "Compass"
    | "Star"
    | "Trophy"
    | "Download"
    | "Bell";
  title: string;
  body: string;
}

export interface SyncContent {
  eyebrow: string;
  title: string;
  body: string;
  points: { title: string; body: string }[];
}

export interface PlanContent {
  id: "monthly" | "quarterly";
  name: string;
  cadence: string;
  /** Rótulo do preço normalizado por mês; vazio no plano mensal. */
  perMonth: string;
  highlight?: string;
  benefits: string[];
}

export interface PremiumContent {
  eyebrow: string;
  title: string;
  lead: string;
  plans: PlanContent[];
  cta: string;
  ctaNote: string;
}

export interface InstallContent {
  eyebrow: string;
  title: string;
  steps: { title: string; body: string }[];
  cta: string;
  requirements: string;
}

export interface FaqContent {
  eyebrow: string;
  title: string;
  items: { question: string; answer: string }[];
}

export interface FooterContent {
  tagline: string;
  legal: LinkItem[];
  social: { label: string; href: string; icon: "discord" }[];
  rights: string;
}

export interface PolicyContent {
  slug: "terms" | "privacy" | "refund";
  eyebrow: string;
  title: string;
  paragraphs: string[];
  back: string;
}

export interface SiteContent {
  htmlLang: string;
  meta: { title: string; description: string };
  skipToContent: string;
  nav: NavContent;
  hero: HeroContent;
  showcase: { title: string; items: ShowcaseItem[] };
  features: { eyebrow: string; title: string; lead: string; items: FeatureItem[] };
  sync: SyncContent;
  premium: PremiumContent;
  install: InstallContent;
  faq: FaqContent;
  footer: FooterContent;
  policies: Record<PolicyContent["slug"], PolicyContent>;
}
