import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Compass,
  Crown,
  FolderHeart,
  Menu,
  Play,
  Search,
  Trophy,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  faqItems,
  features,
  heroCopy,
  plans,
  type BillingCycle,
  type FeatureId,
} from "./content";
import "./landing.scss";

const featureIcons: Record<FeatureId, LucideIcon> = {
  library: BookOpen,
  catalogue: Compass,
  collections: FolderHeart,
  achievements: Trophy,
  notifications: Bell,
  profile: UserRound,
};

const navItems = [
  { href: "#recursos", label: "Recursos" },
  { href: "#perfil", label: "Perfil" },
  { href: "#planos", label: "Planos" },
  { href: "#faq", label: "FAQ" },
];

const heroGames = [
  { title: "Hades II", tag: "Em andamento", accent: "violet" },
  { title: "Outer Wilds", tag: "Favorito", accent: "sand" },
  { title: "The Alters", tag: "Na fila", accent: "blue" },
];

const profileCollections = ["Para zerar", "Co-op", "Noite chuvosa"];

const formatPrice = (priceInCents: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(priceInCents / 100);

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`site-brand${compact ? " site-brand--compact" : ""}`} href="#top" aria-label="GhostBox, voltar ao início">
      <span className="site-brand__icon">
        <img src="/ghost-solid.png" alt="" aria-hidden="true" />
      </span>
      <span className="site-brand__name">GhostBox</span>
    </a>
  );
}

function SectionLabel({ children, tone = "violet" }: { children: ReactNode; tone?: "violet" | "gold" | "blue" }) {
  return (
    <p className={`section-label section-label--${tone}`}>
      <span className="section-label__dot" aria-hidden="true" />
      {children}
    </p>
  );
}

function HeroDashboard() {
  return (
    <div className="hero-dashboard" aria-label="Prévia da biblioteca GhostBox">
      <div className="hero-dashboard__glow" aria-hidden="true" />
      <div className="mockup-window mockup-window--hero">
        <div className="mockup-window__bar">
          <div className="mockup-window__traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="mockup-window__title">Biblioteca</span>
          <span className="mockup-window__status">
            <span className="status-dot status-dot--green" aria-hidden="true" />
            Steam sincronizada
          </span>
        </div>
        <div className="hero-dashboard__body">
          <aside className="mockup-sidebar" aria-hidden="true">
            <div className="mockup-sidebar__profile">
              <span className="mock-avatar mock-avatar--small">A</span>
              <span>
                <strong>alexf</strong>
                <small>Online agora</small>
              </span>
            </div>
            <div className="mockup-sidebar__section-label">Navegar</div>
            <div className="mockup-sidebar__item mockup-sidebar__item--active"><BookOpen size={13} /> Biblioteca</div>
            <div className="mockup-sidebar__item"><Compass size={13} /> Catálogo</div>
            <div className="mockup-sidebar__item"><Trophy size={13} /> Conquistas</div>
            <div className="mockup-sidebar__section-label">Seu espaço</div>
            <div className="mockup-sidebar__item"><FolderHeart size={13} /> Coleções</div>
            <div className="mockup-sidebar__item"><Bell size={13} /> Notificações</div>
          </aside>
          <div className="hero-dashboard__content">
            <div className="mockup-heading-row">
              <div>
                <span className="mockup-overline">QUARTA, 03 DE AGOSTO</span>
                <h3>Boa noite, Alex.</h3>
              </div>
              <button className="mockup-icon-button" type="button" aria-label="Buscar jogo"><Search size={14} /></button>
            </div>
            <div className="mockup-hero-card">
              <div className="mockup-hero-card__copy">
                <span className="mockup-overline">CONTINUE DE ONDE PAROU</span>
                <strong>Hades II</strong>
                <small>Última sessão há 2 dias · 34,5 horas</small>
                <div className="mock-progress"><span style={{ width: "68%" }} /></div>
              </div>
              <span className="mockup-hero-card__sigil" aria-hidden="true">II</span>
            </div>
            <div className="mockup-subheading-row">
              <span>Suas escolhas</span>
              <span className="mockup-link">Ver biblioteca <ChevronRight size={12} /></span>
            </div>
            <div className="mockup-game-grid">
              {heroGames.map((game) => (
                <div className={`mockup-game-card mockup-game-card--${game.accent}`} key={game.title}>
                  <span className="mockup-game-card__shine" aria-hidden="true" />
                  <strong>{game.title}</strong>
                  <small>{game.tag}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="hero-dashboard__float hero-dashboard__float--stats">
        <span className="float-card__icon"><Trophy size={14} /></span>
        <span><strong>+3 conquistas</strong><small>nesta semana</small></span>
      </div>
      <div className="hero-dashboard__float hero-dashboard__float--sync">
        <Cloud size={14} /> Backup atualizado
      </div>
    </div>
  );
}

function CatalogueMockup() {
  return (
    <div className="catalogue-mockup" aria-label="Prévia do catálogo GhostBox">
      <div className="catalogue-mockup__chrome">
        <div className="catalogue-mockup__tabs"><span className="catalogue-mockup__tab catalogue-mockup__tab--active">Descobrir</span><span className="catalogue-mockup__tab">Mais jogados</span><span className="catalogue-mockup__tab">Chegando</span></div>
        <div className="catalogue-mockup__search"><Search size={13} /> buscar no catálogo</div>
      </div>
      <div className="catalogue-mockup__body">
        <aside className="catalogue-mockup__filters">
          <span className="catalogue-mockup__filter-heading">FILTRAR POR</span>
          <span className="catalogue-mockup__filter catalogue-mockup__filter--active">Todos os jogos <b>12.840</b></span>
          <span className="catalogue-mockup__filter">Indie <b>2.192</b></span>
          <span className="catalogue-mockup__filter">RPG <b>1.084</b></span>
          <span className="catalogue-mockup__filter">Co-op <b>764</b></span>
          <span className="catalogue-mockup__filter">Estratégia <b>486</b></span>
        </aside>
        <div className="catalogue-mockup__results">
          <div className="catalogue-mockup__result-heading"><span>Descobertas para você</span><small>Ordenar: Popular</small></div>
          <div className="catalogue-mockup__result-grid">
            <div className="catalogue-result catalogue-result--one"><span>BLUE PRINCE</span><small>Quebra-cabeça · Indie</small></div>
            <div className="catalogue-result catalogue-result--two"><span>HOLLOW KNIGHT</span><small>Aventura · Metroidvania</small></div>
            <div className="catalogue-result catalogue-result--three"><span>FROSTPUNK 2</span><small>Estratégia · Gestão</small></div>
            <div className="catalogue-result catalogue-result--four"><span>NO REST FOR THE WICKED</span><small>RPG · Ação</small></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileMockup() {
  return (
    <div className="profile-mockup" aria-label="Prévia de um perfil personalizável">
      <div className="profile-mockup__cover">
        <span className="profile-mockup__cover-noise" aria-hidden="true" />
        <span className="profile-mockup__cover-position">Posição da capa <span>↔</span></span>
      </div>
      <div className="profile-mockup__body">
        <div className="profile-mockup__identity">
          <span className="mock-avatar mock-avatar--large">A</span>
          <div><strong>alexf</strong><small>colecionando histórias desde 2019</small></div>
          <button className="mockup-edit-button" type="button">Editar perfil <ArrowUpRight size={12} /></button>
        </div>
        <div className="profile-mockup__metrics">
          <span><strong>248</strong><small>jogos</small></span>
          <span><strong>1.932</strong><small>conquistas</small></span>
          <span><strong>1.240h</strong><small>jogadas</small></span>
          <span><strong>76%</strong><small>completude</small></span>
        </div>
        <div className="profile-mockup__collections">
          <span className="profile-mockup__collections-label">Coleções em destaque</span>
          <div>
            {profileCollections.map((collection, index) => (
              <span className={`collection-pill collection-pill--${index + 1}`} key={collection}>{collection}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [openFaqId, setOpenFaqId] = useState<string | null>("steam");

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  return (
    <div className="site-page" id="top">
      <div className="site-noise" aria-hidden="true" />
      <header className="site-nav">
        <div className="site-container site-nav__inner">
          <BrandMark />
          <nav id="site-menu" className={`site-nav__links${isMenuOpen ? " site-nav__links--open" : ""}`} aria-label="Navegação principal">
            {navItems.map((item) => (
              <a href={item.href} key={item.href} onClick={() => setIsMenuOpen(false)}>{item.label}</a>
            ))}
          </nav>
          <div className="site-nav__actions">
            <a className="site-nav__login" href="#faq">Já usa o GhostBox?</a>
            <a className="button button--nav" href="#planos">Começar <ArrowUpRight size={14} /></a>
            <button className="site-menu-toggle" type="button" aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={isMenuOpen} aria-controls="site-menu" onClick={() => setIsMenuOpen((open) => !open)}>
              {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="site-hero" aria-labelledby="hero-title">
          <div className="site-hero__atmosphere" aria-hidden="true"><span /><span /><span /></div>
          <div className="site-container site-hero__inner">
            <div className="site-hero__copy">
              <SectionLabel>{heroCopy.eyebrow}</SectionLabel>
              <h1 id="hero-title">{heroCopy.title}</h1>
              <p className="site-hero__description">{heroCopy.description}</p>
              <div className="site-hero__actions">
                <a className="button button--primary" href="#recursos">Explorar recursos <ArrowUpRight size={16} /></a>
                <a className="button button--ghost" href="#perfil"><span className="button__play"><Play size={11} fill="currentColor" /></span> Ver como funciona</a>
              </div>
              <div className="site-hero__meta"><span><span className="status-dot status-dot--green" aria-hidden="true" /> sincroniza com a Steam</span><span className="site-hero__meta-divider" aria-hidden="true" /> <span>feito para quem joga no PC</span></div>
            </div>
            <HeroDashboard />
          </div>
          <div className="site-container site-hero__scroll-hint"><span>Role para explorar</span><span className="scroll-line" aria-hidden="true" /></div>
        </section>

        <section className="site-manifesto">
          <div className="site-container site-manifesto__inner">
            <SectionLabel tone="gold">A biblioteca é sua</SectionLabel>
            <p className="site-manifesto__statement">Você não precisa de mais uma lista de jogos.<br /><em>Precisa de um lugar que entenda a sua.</em></p>
            <p className="site-manifesto__support">GhostBox reúne o que estava espalhado e devolve a sensação de ter uma biblioteca que acompanha seu jeito de jogar.</p>
          </div>
        </section>

        <section className="site-section site-section--features" id="recursos" aria-labelledby="features-title">
          <div className="site-container">
            <div className="section-heading section-heading--split">
              <div><SectionLabel>O que você encontra</SectionLabel><h2 id="features-title">Uma interface para<br /><span>o seu ritmo.</span></h2></div>
              <p>Do primeiro download à centésima conquista, GhostBox mantém sua coleção perto, clara e pronta para a próxima sessão.</p>
            </div>
            <div className="feature-grid">
              {features.map((feature, index) => {
                const Icon = featureIcons[feature.id];
                return (
                  <article className={`feature-card feature-card--${index + 1}`} key={feature.id}>
                    <div className="feature-card__top"><span className="feature-card__icon"><Icon size={18} strokeWidth={1.7} /></span><span className="feature-card__index">0{index + 1}</span></div>
                    <div className="feature-card__copy"><span className="feature-card__eyebrow">{feature.eyebrow}</span><h3>{feature.title}</h3><p>{feature.description}</p></div>
                    <div className="feature-card__metric"><strong>{feature.metric}</strong><span>{feature.metricLabel}</span></div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="site-section site-section--catalogue" aria-labelledby="catalogue-title">
          <div className="site-container showcase-grid">
            <div className="showcase-copy"><SectionLabel tone="blue">Descubra com contexto</SectionLabel><h2 id="catalogue-title">Menos tempo procurando.<br /><span>Mais tempo jogando.</span></h2><p>O catálogo GhostBox reúne descoberta, filtros e detalhes em uma experiência que parece sua desde o primeiro clique.</p><a className="text-link" href="#planos">Conhecer os recursos <ArrowUpRight size={14} /></a></div>
            <CatalogueMockup />
          </div>
        </section>

        <section className="site-section site-section--profile" id="perfil" aria-labelledby="profile-title">
          <div className="site-container profile-section__inner">
            <div className="profile-section__heading"><SectionLabel tone="gold">Seu espaço, suas regras</SectionLabel><h2 id="profile-title">Um perfil que parece<br /><span>você.</span></h2><p>Avatar, capa, coleções e métricas. Escolha o que aparece e transforme atividade em identidade.</p></div>
            <ProfileMockup />
            <div className="profile-section__aside"><div className="profile-section__aside-line" aria-hidden="true" /><span>01</span><p>Personalize a moldura.<br /><strong>Deixe a história aparecer.</strong></p></div>
          </div>
        </section>

        <section className="site-section site-section--plans" id="planos" aria-labelledby="plans-title">
          <div className="site-container">
            <div className="section-heading section-heading--center"><SectionLabel tone="gold">Escolha seu próximo passo</SectionLabel><h2 id="plans-title">Feito para começar.<br /><span>Pronto para continuar.</span></h2><p>Comece com o essencial e adicione continuidade quando sua biblioteca pedir.</p></div>
            <div className="billing-toggle" role="group" aria-label="Escolha o período de cobrança">
              <button type="button" className={billingCycle === "monthly" ? "billing-toggle__button billing-toggle__button--active" : "billing-toggle__button"} aria-pressed={billingCycle === "monthly"} onClick={() => setBillingCycle("monthly")}>Mensal</button>
              <button type="button" className={billingCycle === "quarterly" ? "billing-toggle__button billing-toggle__button--active" : "billing-toggle__button"} aria-pressed={billingCycle === "quarterly"} onClick={() => setBillingCycle("quarterly")}>Trimestral <span>melhor valor</span></button>
            </div>
            <div className="plans-grid">
              {plans.map((plan) => {
                const price = plan.prices ? formatPrice(plan.prices[billingCycle]) : "Grátis";
                const cadence = plan.prices ? billingCycle === "monthly" ? "/ mês" : "/ trimestre" : "para sempre";
                return (
                  <article className={`plan-card${plan.highlighted ? " plan-card--highlighted" : ""}`} key={plan.id}>
                    {plan.highlighted ? <div className="plan-card__badge"><Crown size={13} fill="currentColor" /> mais escolhido</div> : null}
                    <div className="plan-card__top"><div><span className="plan-card__eyebrow">{plan.id === "premium" ? "Para ir além" : "Para começar"}</span><h3>{plan.name}</h3></div><span className={`plan-card__orb plan-card__orb--${plan.id}`} aria-hidden="true" /></div>
                    <p className="plan-card__description">{plan.description}</p>
                    <div className="plan-card__price"><strong>{price}</strong><span>{cadence}</span></div>
                    <ul className="plan-card__features">{plan.features.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
                    <a className={`button ${plan.highlighted ? "button--premium" : "button--outline"}`} href="#faq">{plan.action} <ArrowUpRight size={15} /></a>
                  </article>
                );
              })}
            </div>
            <p className="plans-note"><Cloud size={14} /> Recursos de nuvem fazem parte do GhostBox Premium. Os termos completos aparecem antes do pagamento.</p>
          </div>
        </section>

        <section className="site-section site-section--faq" id="faq" aria-labelledby="faq-title">
          <div className="site-container faq-grid">
            <div className="faq-heading"><SectionLabel>Ficou alguma pergunta?</SectionLabel><h2 id="faq-title">Tudo bem.<br /><span>A gente explica.</span></h2><p>Se ainda quiser conversar, mande um oi para <a href="mailto:ghostbox@mail.com">ghostbox@mail.com</a>.</p></div>
            <div className="faq-list">
              {faqItems.map((item) => {
                const isOpen = openFaqId === item.id;
                return (
                  <div className={`faq-item${isOpen ? " faq-item--open" : ""}`} key={item.id}>
                    <button className="faq-item__trigger" type="button" aria-expanded={isOpen} aria-controls={`faq-answer-${item.id}`} onClick={() => setOpenFaqId(isOpen ? null : item.id)}><span>{item.question}</span><ChevronDown size={17} /></button>
                    <div className="faq-item__answer" id={`faq-answer-${item.id}`} hidden={!isOpen}><p>{item.answer}</p></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="site-cta" aria-labelledby="cta-title">
          <div className="site-cta__sky" aria-hidden="true"><span /><span /></div>
          <div className="site-container site-cta__inner"><SectionLabel tone="gold">A próxima sessão começa aqui</SectionLabel><h2 id="cta-title">Abra espaço para<br /><span>o que você joga.</span></h2><div className="site-cta__actions"><a className="button button--primary" href="#top">Voltar ao início <ArrowUpRight size={16} /></a><a className="button button--ghost" href="#planos">Ver planos</a></div></div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-container site-footer__top"><BrandMark compact /><span className="site-footer__tagline">Uma casa para a sua biblioteca Steam.</span><div className="site-footer__links"><a href="#recursos">Recursos</a><a href="#perfil">Perfil</a><a href="#planos">Planos</a><a href="mailto:ghostbox@mail.com">Contato</a></div></div>
        <div className="site-container site-footer__bottom"><span>© 2026 GhostBox. Feito para quem joga.</span><span>Steam é uma marca da Valve Corporation.</span><span className="site-footer__wordmark" aria-hidden="true">GhostBox</span></div>
      </footer>
    </div>
  );
}

export default LandingPage;
