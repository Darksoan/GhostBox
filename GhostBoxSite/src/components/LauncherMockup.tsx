import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Download,
  Flame,
  Folder,
  Heart,
  House,
  Layers,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Settings,
  Trophy,
  X,
} from "lucide-react";
import {
  bannerGame,
  games,
  previewGame,
  type SiteGame,
} from "../content/games.generated";
import { useScaleToFit } from "../hooks/useScaleToFit";
import type { Language } from "../content";
import "./LauncherMockup.scss";

export type MockupVariant = "home" | "library" | "catalogue" | "achievements";

// Geometria real da janela do launcher. Tudo dentro é desenhado nesses pixels e
// depois reduzido em bloco — é o que mantém titlebar, sidebar e capas fiéis.
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

interface LauncherMockupProps {
  variant: MockupVariant;
  /** Nome acessível da figura. O interior é decorativo. */
  label: string;
  language: Language;
}

// Rótulos da própria interface do launcher, nos dois idiomas que o app suporta.
const UI = {
  pt: {
    home: "Início",
    catalogue: "Catálogo",
    library: "Biblioteca",
    downloads: "Downloads",
    settings: "Ajustes",
    collections: "Coleções",
    subscription: "Assinatura",
    search: "Buscar jogos",
    searchLibrary: "Buscar na biblioteca",
    mostPlayed: "Mais jogados",
    exploreByCategory: "Explorar por categoria",
    favorites: "Favoritos",
    toFinish: "Para zerar",
    coop: "Co-op",
    filters: ["Gêneros", "Tags", "Desenvolvedoras", "Publicadoras", "Ano"],
    sort: "Mais populares",
    sortAchievements: "Mais conquistas",
    metrics: { games: "Jogos", achievements: "Conquistas", playtime: "Tempo total" },
    of: "de",
    played: "registradas",
  },
  en: {
    home: "Home",
    catalogue: "Catalogue",
    library: "Library",
    downloads: "Downloads",
    settings: "Settings",
    collections: "Collections",
    subscription: "Subscription",
    search: "Search games",
    searchLibrary: "Search your library",
    mostPlayed: "Most played",
    exploreByCategory: "Explore by category",
    favorites: "Favorites",
    toFinish: "To finish",
    coop: "Co-op",
    filters: ["Genres", "Tags", "Developers", "Publishers", "Year"],
    sort: "Most popular",
    sortAchievements: "Most achievements",
    metrics: { games: "Games", achievements: "Achievements", playtime: "Total playtime" },
    of: "of",
    played: "played",
  },
} satisfies Record<Language, unknown>;

type UiStrings = (typeof UI)["pt"];

// Números de exibição: arte, títulos, estúdios, tags e notas vêm do catálogo
// real; conquistas e horas são de uma biblioteca fictícia — não há usuário aqui.
const LIBRARY_STATS = [
  { unlocked: 45, total: 63, hours: "128h" },
  { unlocked: 12, total: 40, hours: "32h" },
  { unlocked: 63, total: 63, hours: "94h" },
  { unlocked: 8, total: 51, hours: "11h" },
  { unlocked: 27, total: 27, hours: "212h" },
  { unlocked: 19, total: 44, hours: "56h" },
  { unlocked: 4, total: 33, hours: "6h" },
  { unlocked: 38, total: 38, hours: "141h" },
];

const ACTIVITY_STATS = [
  { unlocked: 63, total: 63, hours: "94h" },
  { unlocked: 45, total: 63, hours: "128h" },
  { unlocked: 19, total: 44, hours: "56h" },
  { unlocked: 8, total: 51, hours: "11h" },
];

function Art({ game, className = "" }: { game: SiteGame; className?: string }) {
  return (
    <img
      className={`lm__art ${className}`.trim()}
      src={game.header}
      alt=""
      loading="lazy"
      decoding="async"
      width={460}
      height={215}
    />
  );
}

function Rating({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className="lm__rating">
      <Flame size={14} strokeWidth={1.5} fill="currentColor" />
      {value}
    </span>
  );
}

function Titlebar({ t }: { t: UiStrings }) {
  return (
    <div className="lm__titlebar">
      <div className="lm__nav-controls">
        <span className="lm__icon-button lm__icon-button--disabled">
          <ChevronLeft size={17} strokeWidth={2} />
        </span>
        <span className="lm__icon-button">
          <ChevronRight size={17} strokeWidth={2} />
        </span>
      </div>

      <div className="lm__titlebar-actions">
        <span className="lm__icon-button">
          <MessageSquare size={18} strokeWidth={1.5} />
        </span>
        <span className="lm__icon-button">
          <img src="/discord.svg" alt="" width={18} height={18} />
        </span>
        <span className="lm__premium">
          <Crown size={16} strokeWidth={1.5} />
          {t.subscription}
          <ChevronLeft size={13} strokeWidth={2} className="lm__premium-chevron" />
        </span>
        <span className="lm__icon-button">
          <Bell size={18} strokeWidth={1.5} />
        </span>
        <span className="lm__search">
          <Search size={16} strokeWidth={1.5} />
          <span className="lm__search-placeholder">{t.search}</span>
        </span>
        <span className="lm__window-controls">
          <span className="lm__window-button">
            <Minus size={15} strokeWidth={1.5} />
          </span>
          <span className="lm__window-button">
            <Maximize2 size={14} strokeWidth={1.5} />
          </span>
          <span className="lm__window-button">
            <X size={15} strokeWidth={1.5} />
          </span>
        </span>
      </div>
    </div>
  );
}

function Sidebar({ variant, t }: { variant: MockupVariant; t: UiStrings }) {
  const activeNav = variant === "achievements" ? "library" : variant;
  const items = [
    { icon: House, label: t.home, key: "home" },
    { icon: LayoutGrid, label: t.catalogue, key: "catalogue" },
    { icon: Layers, label: t.library, key: "library" },
    { icon: Download, label: t.downloads, key: null },
    { icon: Settings, label: t.settings, key: null },
  ];

  return (
    <nav className="lm__sidebar">
      <div className="lm__account">
        <span className="lm__avatar" />
        <span className="lm__account-name">Haya</span>
        <span className="lm__account-badge">13</span>
      </div>

      <ul className="lm__menu">
        {items.map((item) => (
          <li key={item.label}>
            <span className="lm__menu-item" data-active={item.key === activeNav || undefined}>
              <item.icon size={18} strokeWidth={1.5} />
              <span className="lm__menu-label">{item.label}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="lm__section-header">
        <ChevronRight size={14} strokeWidth={2} />
        <small className="lm__section-title">{t.collections}</small>
        <span className="lm__section-add">
          <Plus size={16} strokeWidth={1.5} />
        </span>
      </div>
    </nav>
  );
}

function HomeView({ t }: { t: UiStrings }) {
  const shelf = games.slice(1, 4);
  const explore = games.slice(4, 7);

  return (
    <div className="lm__page">
      <div className="lm__banner">
        <img
          className="lm__banner-art"
          src={bannerGame.hero ?? bannerGame.header}
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span className="lm__banner-scrim" />
        <div className="lm__banner-info">
          <strong className="lm__banner-title">{bannerGame.title}</strong>
          {bannerGame.description ? (
            <span className="lm__banner-description">{bannerGame.description}</span>
          ) : null}
        </div>
        <span className="lm__banner-dots">
          <span className="lm__banner-dot lm__banner-dot--active" />
          <span className="lm__banner-dot" />
          <span className="lm__banner-dot" />
          <span className="lm__banner-dot" />
          <span className="lm__banner-dot" />
        </span>
      </div>

      <section className="lm__shelf">
        <h3 className="lm__shelf-title">{t.mostPlayed}</h3>
        <div className="lm__shelf-rail">
          <div className="lm__shelf-track">
            {shelf.map((game) => (
              <article className="lm__shelf-card" key={game.appId}>
                <span className="lm__shelf-cover">
                  <Art game={game} />
                </span>
                <span className="lm__shelf-body">
                  <span className="lm__shelf-name">{game.title}</span>
                  <Rating value={game.rating} />
                </span>
              </article>
            ))}
          </div>
          <span className="lm__rail-arrow">
            <ChevronRight size={18} strokeWidth={2} />
          </span>
        </div>
      </section>

      <section className="lm__shelf">
        <h3 className="lm__shelf-title">{t.exploreByCategory}</h3>
        <div className="lm__shelf-track">
          {explore.map((game) => (
            <article className="lm__shelf-card" key={game.appId}>
              <span className="lm__shelf-cover">
                <Art game={game} />
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function LibraryView({ t }: { t: UiStrings }) {
  const shelf = games.slice(0, 12);

  return (
    <div className="lm__page lm__page--padded">
      <div className="lm__toolbar">
        <span className="lm__field">
          <Search size={14} strokeWidth={1.5} />
          <span className="lm__search-placeholder">{t.searchLibrary}</span>
        </span>
        <span className="lm__chips">
          <span className="lm__chip lm__chip--active">
            <Heart size={13} strokeWidth={2} />
            {t.favorites}
          </span>
          <span className="lm__chip">
            <Folder size={13} strokeWidth={2} />
            {t.toFinish}
          </span>
          <span className="lm__chip">
            <Folder size={13} strokeWidth={2} />
            {t.coop}
          </span>
        </span>
      </div>

      <div className="lm__grid">
        {shelf.map((game, index) => {
          const stats = LIBRARY_STATS[index % LIBRARY_STATS.length];
          return (
            <article className="lm__card" key={game.appId}>
              <img
                className="lm__art"
                src={game.portrait}
                alt=""
                loading="lazy"
                decoding="async"
                width={300}
                height={450}
              />
              <span className="lm__card-badges">
                <span className="lm__card-metric">
                  <Trophy size={13} strokeWidth={2} />
                  {stats.unlocked} / {stats.total}
                </span>
                <span className="lm__card-metric">
                  <Clock size={13} strokeWidth={2} />
                  {stats.hours}
                </span>
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CatalogueView({ t }: { t: UiStrings }) {
  const list = games.slice(0, 8);

  return (
    <div className="lm__page lm__page--padded">
      <div className="lm__toolbar">
        <span className="lm__chips">
          {t.filters.map((filter) => (
            <span className="lm__filter" key={filter}>
              {filter}
              <ChevronDown size={13} strokeWidth={2} />
            </span>
          ))}
        </span>
        <span className="lm__sort">
          {t.sort}
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </div>

      <div className="lm__catalogue">
        <div className="lm__list">
          {list.map((game) => (
            <article className="lm__row" key={game.appId}>
              <span className="lm__row-cover">
                <Art game={game} />
              </span>
              <span className="lm__row-content">
                <strong className="lm__row-title">{game.title}</strong>
                <span className="lm__chips">
                  {game.tags.map((tag) => (
                    <span className="lm__chip lm__chip--sm" key={tag}>
                      {tag}
                    </span>
                  ))}
                </span>
              </span>
            </article>
          ))}
        </div>

        <aside className="lm__preview">
          <span className="lm__preview-head">
            <strong className="lm__preview-title">{previewGame.title}</strong>
            <Rating value={previewGame.rating} />
          </span>
          <span className="lm__preview-developer">{previewGame.developer}</span>
          {(previewGame.screenshots ?? []).map((shot) => (
            <img
              className="lm__preview-shot"
              key={shot}
              src={shot}
              alt=""
              loading="lazy"
              decoding="async"
              width={640}
              height={360}
            />
          ))}
        </aside>
      </div>
    </div>
  );
}

function AchievementsView({ t }: { t: UiStrings }) {
  const list = games.slice(0, 6);

  return (
    <div className="lm__page lm__page--padded">
      <div className="lm__metrics">
        <span className="lm__metric">
          <strong>142</strong>
          <span>{t.metrics.games}</span>
        </span>
        <span className="lm__metric">
          <strong>3.842</strong>
          <span>{t.metrics.achievements}</span>
        </span>
        <span className="lm__metric">
          <strong>1.284h</strong>
          <span>{t.metrics.playtime}</span>
        </span>
        <span className="lm__sort lm__sort--end">
          {t.sortAchievements}
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </div>

      <div className="lm__activity">
        {list.map((game, index) => {
          const stats = ACTIVITY_STATS[index % ACTIVITY_STATS.length];
          const percent = Math.round((stats.unlocked / stats.total) * 100);
          const perfect = stats.unlocked >= stats.total;
          return (
            <article className="lm__activity-card" key={game.appId}>
              <span className="lm__activity-cover">
                <Art game={game} />
              </span>
              <span className="lm__activity-main">
                <strong className="lm__activity-title">{game.title}</strong>
                <span className="lm__activity-hours">
                  {stats.hours} {t.played}
                </span>
              </span>
              <span className="lm__activity-progress">
                <Trophy
                  size={16}
                  strokeWidth={2}
                  className={perfect ? "lm__cup lm__cup--perfect" : "lm__cup"}
                />
                <span className="lm__activity-count">
                  {stats.unlocked} {t.of} {stats.total}
                </span>
                <span className="lm__track">
                  <span className="lm__track-fill" style={{ width: `${percent}%` }} />
                </span>
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}

const VIEWS: Record<MockupVariant, (props: { t: UiStrings }) => JSX.Element> = {
  home: HomeView,
  library: LibraryView,
  catalogue: CatalogueView,
  achievements: AchievementsView,
};

/**
 * A janela do GhostBox reconstruída em DOM com a geometria real do app
 * (titlebar de 52px, sidebar de 280px, grade de 200px, capa 460×215, retrato
 * 600×900), desenhada em pixels de verdade e reduzida em bloco. Arte, títulos,
 * estúdios, tags e notas vêm do catálogo real — ver `scripts/sync-games.mjs`.
 */
export function LauncherMockup({ variant, label, language }: LauncherMockupProps) {
  const View = VIEWS[variant];
  const t = UI[language];
  const scalerRef = useScaleToFit<HTMLDivElement>(WINDOW_WIDTH, WINDOW_HEIGHT);

  return (
    <figure className="lm" role="img" aria-label={label} data-variant={variant}>
      <div className="lm__scaler" ref={scalerRef}>
        <div className="lm__window" aria-hidden="true">
          <div className="lm__body">
            <Sidebar variant={variant} t={t} />
            <div className="lm__stage">
              <Titlebar t={t} />
              <div className="lm__content">
                <View t={t} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
