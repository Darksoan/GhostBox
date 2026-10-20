import { ChevronDown, Heart, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { useHomeShelves } from "../../hooks/useHomeShelves";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useGamesQuery, useGameStoreDetailsQuery } from "../../queries/games";
import { emptyCatalogueFilters } from "../../constants/catalogue";
import type { CatalogueSort } from "../../types";
import { filterOutSteamDemos } from "../../utils/steamAppType";
import { gameHeroSources, gamePortraitPreviewSources, getGameAppId } from "../../utils/image";
import { normalizeGameSearchText } from "../../utils/gameSearch";
import { ConsoleArt, ConsoleCard, ConsolePageTitle, ConsoleRail, consoleGameByElement } from "./ConsoleParts";

type ViewProps = { onOpen: (game: GhostBoxGame) => void };

const PAGE_SIZE = 60;
const COLUMNS = 6;
const SLIDE_COUNT = 5;
const SLIDE_MS = 8000;

export function useConsoleGameFlags() {
  const appData = useAppData();
  const { t } = useSettings();
  return useMemo(() => ({
    isFavourite: (game: GhostBoxGame) => appData.favoriteGameIds.has(game.id),
    badge: (game: GhostBoxGame) => {
      const appId = getGameAppId(game);
      if (appData.playableGameAppIds.has(appId)) return t("console.installed");
      return appData.availableLibraryGameAppIds.has(appId) ? t("console.inLibrary") : undefined;
    },
  }), [appData.availableLibraryGameAppIds, appData.favoriteGameIds, appData.playableGameAppIds, t]);
}

function useGameSummary(game: GhostBoxGame | undefined) {
  const { data } = useGameStoreDetailsQuery(game?.id ?? "", { enabled: Boolean(game) });
  const resolved = data ?? game;
  return {
    genres: (resolved?.genres ?? []).slice(0, 3).join(" · "),
    summary: (resolved?.shortDescription ?? "").trim(),
  };
}

/** Avanço automático dos destaques; segurar (foco na lista) pausa e retoma de onde parou. */
function useSlides(count: number) {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (held || count < 2) return undefined;
    const id = window.setTimeout(() => {
      setActive((index) => (index + 1) % count);
      setCycle((value) => value + 1);
    }, SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [active, count, cycle, held]);
  const select = useCallback((index: number) => { setActive(index); setCycle((value) => value + 1); }, []);
  return { active: Math.min(active, Math.max(0, count - 1)), select, hold: setHeld };
}

function Spotlight({ slides, onOpen }: { slides: GhostBoxGame[] } & ViewProps) {
  const appData = useAppData();
  const { t } = useSettings();
  const { active, select, hold } = useSlides(slides.length);
  const game = slides[active];
  const heroSources = useMemo(() => (game ? gameHeroSources(game) : []), [game]);
  const { genres, summary } = useGameSummary(game);
  const cta = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (game && cta.current) consoleGameByElement.set(cta.current, game); }, [game]);
  if (!game) return null;
  const favourite = appData.favoriteGameIds.has(game.id);

  return (
    <div className="console-spotlight">
      <div className="console-spotlight__stage">
        <ConsoleArt key={game.id} sources={heroSources} className="console-spotlight__art" />
        <span className="console-spotlight__scrim" aria-hidden="true" />
        <div className="console-spotlight__copy">
          <div className="console-spotlight__blurb" key={game.id}>
            <h1 className="console-logo console-logo--text console-spotlight__title">{game.title}</h1>
            {genres && <p className="console-spotlight__genres">{genres}</p>}
            {summary && <p className="console-spotlight__summary">{summary}</p>}
          </div>
          <div className="console-spotlight__actions">
            <button ref={cta} type="button" className="console-button console-button--primary console-button--lg" data-console-focus data-console-cta
              onClick={() => onOpen(game)}>
              {t("console.viewGame")}
            </button>
            <button type="button" className="console-button console-button--outline console-button--lg console-button--no-hover-border" data-console-focus aria-pressed={favourite}
              onClick={() => appData.toggleFavoriteGame(game)}>
              <Heart aria-hidden="true" fill={favourite ? "currentColor" : "none"} />
              {t(favourite ? "console.favourited" : "console.addToFavourites")}
            </button>
          </div>
        </div>
      </div>
      <div className="console-spotlight__list">
        {slides.map((slide, index) => (
          <SpotlightItem key={slide.id} game={slide} active={index === active}
            onFocus={() => { select(index); hold(true); }} onBlur={() => hold(false)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function SpotlightItem({ game, active, onFocus, onBlur, onOpen }: {
  game: GhostBoxGame;
  active: boolean;
  onFocus: () => void;
  onBlur: () => void;
} & ViewProps) {
  const sources = useMemo(() => gamePortraitPreviewSources(game), [game]);
  return (
    <button type="button" className={`console-spotlight__item${active ? " is-active" : ""}`} data-console-focus aria-current={active || undefined}
      ref={(element) => { if (element) consoleGameByElement.set(element, game); }}
      onFocus={onFocus} onBlur={onBlur} onMouseEnter={onFocus} onMouseLeave={onBlur} onClick={() => onOpen(game)}>
      <ConsoleArt sources={sources} className="console-spotlight__thumb" />
      <span className="console-spotlight__item-title">{game.title}</span>
    </button>
  );
}

export function ConsoleDiscover({ onOpen, onSeeAll }: ViewProps & { onSeeAll: () => void }) {
  const appData = useAppData();
  const { appearance, t } = useSettings();
  const flags = useConsoleGameFlags();
  const { shelves } = useHomeShelves({
    language: appearance.language,
    libraryGameAppIds: appData.availableLibraryGameAppIds,
    libraryGames: appData.addedLibraryGames,
    favoriteGames: appData.favoriteGames,
    historyGames: appData.profileHistoryGames,
    steamId: appData.steamProfile?.steamId,
  });
  const slides = useMemo(() => {
    const seen = new Set<string>();
    return [...shelves.recommended.games, ...shelves.topSellers.games, ...shelves.newReleases.games]
      .filter((game) => !seen.has(game.id) && seen.add(game.id))
      .slice(0, SLIDE_COUNT);
  }, [shelves.newReleases.games, shelves.recommended.games, shelves.topSellers.games]);
  const rails = [
    { key: "popular", title: t("console.popularNow"), games: shelves.topSellers.games, seeAll: true },
    { key: "continue", title: t("console.continuePlaying"), games: appData.profileHistoryGames.slice(0, 15) },
    { key: "new", title: t("console.newOnGhostBox"), games: shelves.newReleases.games },
    { key: "top", title: t("console.topRated"), games: shelves.topRated.games },
  ].filter((rail) => rail.games.length > 0);

  if (slides.length === 0 && rails.length === 0) return <div className="console-empty">{t("console.loading")}</div>;

  return (
    <div className="console-discover">
      <Spotlight slides={slides} onOpen={onOpen} />
      {rails.map((rail) => (
        <ConsoleRail key={rail.key} title={rail.title} onSeeAll={rail.seeAll ? onSeeAll : undefined}
          seeAllLabel={t("console.seeAll")} previousLabel={t("console.previous")} nextLabel={t("console.next")}>
          {rail.games.map((game) => (
            <ConsoleCard key={`${rail.key}-${game.id}`} game={game} onOpen={onOpen}
              favourite={flags.isFavourite(game)} badge={flags.badge(game)} />
          ))}
        </ConsoleRail>
      ))}
    </div>
  );
}

const sortOptions: { value: CatalogueSort; key: string }[] = [
  { value: "popular", key: "console.sortPopular" },
  { value: "recentlyAdded", key: "console.sortRecent" },
  { value: "playingNow", key: "console.sortPlaying" },
];

function ConsoleGrid({ games, onOpen, onNearEnd, empty }: ViewProps & {
  games: GhostBoxGame[];
  onNearEnd?: () => void;
  empty: string;
}) {
  const flags = useConsoleGameFlags();
  if (games.length === 0) return <div className="console-empty">{empty}</div>;
  return (
    <div className="console-grid">
      {games.map((game, index) => (
        <ConsoleCard key={game.id} game={game} onOpen={onOpen} favourite={flags.isFavourite(game)} badge={flags.badge(game)}
          onFocusGame={index >= games.length - COLUMNS * 2 ? onNearEnd : undefined} />
      ))}
    </div>
  );
}

export function ConsoleBrowse({ onOpen, initialGenre }: ViewProps & { initialGenre?: string }) {
  const { t } = useSettings();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [sort, setSort] = useState<CatalogueSort>("popular");
  const [genre, setGenre] = useState(initialGenre ?? "");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const searchInput = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizeGameSearchText(debouncedQuery);

  useEffect(() => { setLimit(PAGE_SIZE); }, [normalizedQuery, sort, genre]);

  const catalogue = useGamesQuery({
    query: normalizedQuery, limit, offset: 0, sort,
    filters: { ...emptyCatalogueFilters, genres: genre ? [genre] : [] },
  });
  const facets = useGamesQuery({
    query: "", limit: 1, offset: 0, filters: emptyCatalogueFilters, sort: "popular", includeFacets: true, facetsOnly: true,
  });
  const genres = useMemo(() => ["", ...(facets.data?.facets?.genres ?? []).slice(0, 24)], [facets.data]);
  const games = useMemo(() => filterOutSteamDemos(catalogue.data?.games ?? []), [catalogue.data]);
  const total = catalogue.data?.matched ?? catalogue.data?.total ?? games.length;
  const canLoadMore = (catalogue.data?.matched ?? 0) > games.length && !catalogue.isFetching;
  const sortIndex = sortOptions.findIndex((option) => option.value === sort);

  return (
    <div className="console-page">
      <ConsolePageTitle title={t("console.browse")} meta={t("console.games", { count: total.toLocaleString() })} />
      <div className="console-toolbar">
        <button type="button" className="console-pill" data-console-focus onClick={() => setGenre(genres[(genres.indexOf(genre) + 1) % genres.length] ?? "")}>
          <SlidersHorizontal aria-hidden="true" />
          <span className="console-pill__label">{t("console.filters")}</span>
          <span>{genre || t("console.allGenres")}</span>
        </button>
        <button type="button" className="console-pill" data-console-focus onClick={() => setSort(sortOptions[(sortIndex + 1) % sortOptions.length].value)}>
          <span className="console-pill__label">{t("console.sort")}</span>
          <span>{t(sortOptions[sortIndex].key)}</span>
          <ChevronDown aria-hidden="true" />
        </button>
        <label className="console-search">
          <Search aria-hidden="true" />
          <input ref={searchInput} type="search" data-console-focus value={query} placeholder={t("console.searchPlaceholder")}
            aria-label={t("console.search")} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {catalogue.isPending
        ? <div className="console-empty">{t("console.loading")}</div>
        : <ConsoleGrid games={games} onOpen={onOpen} empty={t("console.noResults")}
            onNearEnd={canLoadMore ? () => setLimit((current) => current + PAGE_SIZE) : undefined} />}
    </div>
  );
}

export function ConsoleCollection({ kind, onOpen }: ViewProps & { kind: "library" | "favourites" }) {
  const appData = useAppData();
  const { t } = useSettings();
  const games = kind === "library" ? appData.addedLibraryGames : appData.favoriteGames;
  return (
    <div className="console-page">
      <ConsolePageTitle title={t(`console.${kind}`)} meta={t("console.games", { count: games.length.toLocaleString() })} />
      <ConsoleGrid games={games} onOpen={onOpen} empty={t(kind === "library" ? "console.emptyLibrary" : "console.emptyFavourites")} />
    </div>
  );
}
