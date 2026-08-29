import { Flame, Search, Trophy } from "lucide-react";
import {
  bannerGame,
  games,
  previewGame,
  type SiteGame,
} from "../content/games.generated";
import type { CSSProperties } from "react";
import type { Language } from "../content/types";
import "./LauncherMockup.scss";

export type MockupVariant = "home" | "library" | "catalogue" | "achievements";

interface LauncherMockupProps {
  variant: MockupVariant;
  /** Nome acessível da figura. O interior é decorativo. */
  label: string;
  language: Language;
}

// Rótulos da própria interface do launcher, nos dois idiomas que o app suporta
// (mesmos textos de src/i18n.ts do launcher).
const UI = {
  pt: {
    searchLibrary: "Buscar na biblioteca",
    metrics: { games: "Jogos", achievements: "Conquistas", playtime: "Tempo total" },
    of: "de",
    played: "registradas",
    lastPlayed: "jogado pela última vez em",
    bigPlaytime: "1.848,1h",
  },
  en: {
    searchLibrary: "Search your library",
    metrics: { games: "Games", achievements: "Achievements", playtime: "Total playtime" },
    of: "of",
    played: "played",
    lastPlayed: "last played on",
    bigPlaytime: "1,848.1h",
  },
} satisfies Record<Language, unknown>;

type UiStrings = (typeof UI)["pt"];

// Números de exibição de uma biblioteca fictícia — não há usuário logado numa
// landing. Horas e datas têm formato por idioma, como o app formata.
const PROFILE_STATS = [
  {
    unlocked: 33,
    total: 37,
    hoursPt: "71,4h",
    hoursEn: "71.4h",
    lastPt: "25 de ago",
    lastEn: "Aug 25",
    more: 28,
    perfect: false,
  },
  {
    unlocked: 30,
    total: 51,
    hoursPt: "100,3h",
    hoursEn: "100.3h",
    lastPt: "19 de jul",
    lastEn: "Jul 19",
    more: 25,
    perfect: false,
  },
  {
    unlocked: 45,
    total: 45,
    hoursPt: "212h",
    hoursEn: "212h",
    lastPt: "12 de ago",
    lastEn: "Aug 12",
    more: 12,
    perfect: true,
  },
];

// Ordem de entrada de cada fragmento na cascata do painel.
function frag(index: number): CSSProperties {
  return { "--frag-i": index } as CSSProperties;
}

function Art({ game, portrait = false }: { game: SiteGame; portrait?: boolean }) {
  return (
    <img
      className="lm__art"
      src={portrait ? game.portrait : game.header}
      alt=""
      loading="lazy"
      decoding="async"
      width={portrait ? 300 : 460}
      height={portrait ? 450 : 215}
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

// Início: banner do jogo em destaque com a prateleira de mais jogados
// flutuando por cima da borda inferior.
function HomePanels() {
  const shelf = games.slice(1, 4);

  return (
    <>
      <figure className="lm__frag lm__banner" style={frag(0)}>
        <img
          className="lm__banner-art"
          src={bannerGame.hero ?? bannerGame.header}
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span className="lm__banner-scrim" aria-hidden="true" />
        <figcaption className="lm__banner-info">
          <strong className="lm__banner-title">{bannerGame.title}</strong>
          {bannerGame.description ? (
            <span className="lm__banner-description">{bannerGame.description}</span>
          ) : null}
        </figcaption>
        <span className="lm__banner-dots" aria-hidden="true">
          <span className="lm__banner-dot lm__banner-dot--active" />
          <span className="lm__banner-dot" />
          <span className="lm__banner-dot" />
          <span className="lm__banner-dot" />
        </span>
      </figure>

      <div className="lm__frag lm__strip" style={frag(1)}>
        {shelf.map((game) => (
          <span className="lm__strip-card" key={game.appId}>
            <span className="lm__strip-cover">
              <Art game={game} />
            </span>
            <span className="lm__strip-body">
              <span className="lm__strip-name">{game.title}</span>
              <Rating value={game.rating} />
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

// Biblioteca: busca flutuando sobre a grade de retratos.
function LibraryPanels({ t }: { t: UiStrings }) {
  const shelf = games.slice(0, 6);

  return (
    <>
      <span className="lm__frag lm__field" style={frag(0)}>
        <Search size={14} strokeWidth={1.5} />
        <span className="lm__placeholder">{t.searchLibrary}</span>
      </span>
      <div className="lm__frag lm__covers" style={frag(1)}>
        {shelf.map((game) => (
          <span className="lm__cover" key={game.appId}>
            <Art game={game} portrait />
          </span>
        ))}
      </div>
    </>
  );
}

// Catálogo: lista de linhas com a coluna de prévia flutuando por cima.
function CataloguePanels() {
  const list = games.slice(1, 4);
  const previewShot = previewGame.screenshots?.[0];

  return (
    <>
      <div className="lm__frag lm__rows" style={frag(0)}>
        {list.map((game) => (
          <span className="lm__row" key={game.appId}>
            <span className="lm__row-cover">
              <Art game={game} />
            </span>
            <span className="lm__row-body">
              <strong className="lm__row-title">{game.title}</strong>
              <span className="lm__chips">
                {game.tags.slice(0, 3).map((tag) => (
                  <span className="lm__chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </span>
            </span>
          </span>
        ))}
      </div>

      <figure className="lm__frag lm__preview" style={frag(1)}>
        <figcaption className="lm__preview-head">
          <strong className="lm__preview-title">{previewGame.title}</strong>
          <Rating value={previewGame.rating} />
        </figcaption>
        <span className="lm__preview-developer">{previewGame.developer}</span>
        {previewShot ? (
          <img
            className="lm__preview-shot"
            src={previewShot}
            alt=""
            loading="lazy"
            decoding="async"
            width={640}
            height={360}
          />
        ) : null}
      </figure>
    </>
  );
}

// Perfil: métricas da Steam, linhas de progresso e o toast de conquista
// 100% flutuando por cima — o momento que a seção conta.
function ProfilePanels({ t, language }: { t: UiStrings; language: Language }) {
  const rows = games.slice(0, 2);
  const toast = games[2];
  const toastStats = PROFILE_STATS[2];
  const toastHours = language === "pt" ? toastStats.hoursPt : toastStats.hoursEn;

  return (
    <>
      <div className="lm__frag lm__metricstrip" style={frag(0)}>
        <span className="lm__metric">
          <strong>135</strong>
          <span>{t.metrics.games}</span>
        </span>
        <span className="lm__metric">
          <strong>456</strong>
          <span>{t.metrics.achievements}</span>
        </span>
        <span className="lm__metric">
          <strong>{t.bigPlaytime}</strong>
          <span>{t.metrics.playtime}</span>
        </span>
      </div>

      <div className="lm__frag lm__rows" style={frag(1)}>
        {rows.map((game, index) => {
          const stats = PROFILE_STATS[index];
          const percent = Math.round((stats.unlocked / stats.total) * 100);
          const hours = language === "pt" ? stats.hoursPt : stats.hoursEn;
          const last = language === "pt" ? stats.lastPt : stats.lastEn;
          return (
            <span className="lm__row lm__row--activity" key={game.appId}>
              <span className="lm__row-cover">
                <Art game={game} />
              </span>
              <span className="lm__row-body">
                <span className="lm__row-main">
                  <strong className="lm__row-title">{game.title}</strong>
                  <span className="lm__row-when">
                    <strong className="lm__row-hours">
                      {hours} {t.played}
                    </strong>
                    <small className="lm__row-last">
                      {t.lastPlayed} {last}
                    </small>
                  </span>
                </span>
                <span className="lm__row-progress">
                  <Trophy
                    size={15}
                    strokeWidth={2}
                    className={stats.perfect ? "lm__cup lm__cup--perfect" : "lm__cup"}
                  />
                  <span className="lm__row-count">
                    {stats.unlocked} {t.of} {stats.total}
                  </span>
                  <span className="lm__track">
                    <span className="lm__track-fill" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="lm__row-more">+{stats.more}</span>
                </span>
              </span>
            </span>
          );
        })}
      </div>

      <figure className="lm__frag lm__toast" style={frag(2)}>
        <span className="lm__toast-icon" aria-hidden="true">
          <Trophy size={18} strokeWidth={2} />
        </span>
        <figcaption className="lm__toast-body">
          <strong className="lm__toast-title">{toast.title}</strong>
          <span className="lm__toast-line">
            {toastStats.unlocked} {t.of} {toastStats.total} · {toastHours} {t.played}
          </span>
        </figcaption>
      </figure>
    </>
  );
}

const PANELS: Record<
  MockupVariant,
  (props: { t: UiStrings; language: Language }) => JSX.Element
> = {
  home: HomePanels,
  library: LibraryPanels,
  catalogue: CataloguePanels,
  achievements: ProfilePanels,
};

/**
 * Recortes da interface do GhostBox flutuando sobre a página: cada variante
 * mostra só os elementos essenciais da aba citada pela seção — banner e
 * prateleira (Início), busca e grade (Biblioteca), linhas e prévia (Catálogo),
 * métricas, progresso e toast de conquista (Perfil). Arte, títulos, estúdios,
 * tags e notas vêm do catálogo real — ver `scripts/sync-games.mjs`.
 */
export function LauncherMockup({ variant, label, language }: LauncherMockupProps) {
  const Panels = PANELS[variant];
  const t = UI[language];

  return (
    <div className={`lm lm--${variant}`} role="img" aria-label={label}>
      <Panels t={t} language={language} />
    </div>
  );
}
