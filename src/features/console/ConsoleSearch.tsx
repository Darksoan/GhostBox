import { ChevronRight, Delete, Search, SearchX, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useSettings } from "../../context/settings";
import type { GhostBoxGame } from "../../data";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useGamesQuery } from "../../queries/games";
import { emptyCatalogueFilters } from "../../constants/catalogue";
import { filterOutSteamDemos } from "../../utils/steamAppType";
import { normalizeGameSearchText } from "../../utils/gameSearch";
import { ConsoleCard, ConsoleGlyph, type ConsoleGlyphName } from "./ConsoleParts";
import { useConsoleGameFlags } from "./ConsoleViews";
import { requestConsoleFocus } from "./useConsoleInput";

const HISTORY_KEY = "ghostbox:console-search-history:v1";
const HISTORY_LIMIT = 8;
const MAX_QUERY = 40;
const CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

function readHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((term): term is string => typeof term === "string").slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeHistory(terms: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(terms.slice(0, HISTORY_LIMIT))); } catch { /* histórico só da sessão */ }
}

export function editConsoleQuery(query: string, key: string): string {
  if (key === "delete") return query.slice(0, -1);
  if (key === "clear") return "";
  if (query.length >= MAX_QUERY) return query;
  if (key === " " && (!query || query.endsWith(" "))) return query;
  return query + key;
}

const Key = memo(function Key({ label, value, wide, glyph, icon, onKey }: {
  label: string;
  value: string;
  wide?: boolean;
  glyph?: ConsoleGlyphName;
  icon?: React.ReactNode;
  onKey: (value: string) => void;
}) {
  return (
    <button type="button" data-console-focus className={`console-key${wide ? " console-key--wide" : ""}`} onClick={() => onKey(value)}>
      {icon}<span>{label}</span>
      {glyph && <span className="console-key__glyph"><ConsoleGlyph name={glyph} /></span>}
    </button>
  );
});

export function ConsoleSearch({ onOpen, onBrowseGenre }: { onOpen: (game: GhostBoxGame) => void; onBrowseGenre: (genre: string) => void }) {
  const { t } = useSettings();
  const flags = useConsoleGameFlags();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState(readHistory);
  const debounced = useDebouncedValue(query, 250);
  const normalized = normalizeGameSearchText(debounced);

  const results = useGamesQuery({ query: normalized, limit: 40, offset: 0, filters: emptyCatalogueFilters, sort: "popular" }, { enabled: Boolean(normalized) });
  const popular = useGamesQuery({ query: "", limit: 8, offset: 0, filters: emptyCatalogueFilters, sort: "popular" });
  const facets = useGamesQuery({ query: "", limit: 1, offset: 0, filters: emptyCatalogueFilters, sort: "popular", includeFacets: true, facetsOnly: true });
  const resultGames = useMemo(() => filterOutSteamDemos(results.data?.games ?? []), [results.data]);
  const popularGames = useMemo(() => filterOutSteamDemos(popular.data?.games ?? []).slice(0, 8), [popular.data]);
  const genres = (facets.data?.facets?.genres ?? []).slice(0, 6);

  const remember = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setHistory((current) => {
      const next = [clean, ...current.filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, HISTORY_LIMIT);
      writeHistory(next);
      return next;
    });
  };
  const forget = (term: string) => setHistory((current) => {
    const next = current.filter((entry) => entry !== term);
    writeHistory(next);
    return next;
  });
  const focusResults = () => requestAnimationFrame(() =>
    requestConsoleFocus(document.querySelector<HTMLElement>(".console-search-screen__results [data-console-focus]")));
  const onKey = (value: string) => {
    if (value === "done") { remember(query); focusResults(); return; }
    setQuery((current) => editConsoleQuery(current, value));
  };
  const open = (game: GhostBoxGame) => { remember(query); onOpen(game); };

  // Teclado físico: letras, números, espaço e Backspace editam a busca direto, sem precisar do teclado na tela.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Backspace") { event.preventDefault(); setQuery((current) => editConsoleQuery(current, "delete")); return; }
      if (event.key === "Enter" && query && !(document.activeElement as HTMLElement | null)?.closest("[data-console-focus]")) { remember(query); focusResults(); return; }
      if (event.key.length === 1 && /[\p{L}\p{N} :'&.-]/u.test(event.key)) {
        event.preventDefault();
        setQuery((current) => editConsoleQuery(current, event.key.toLowerCase()));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <div className="console-search-screen">
      <div className="console-search-screen__input">
        <div className="console-query" role="search" aria-label={t("console.search")}>
          <Search aria-hidden="true" />
          {query ? <span className="console-query__text">{query}</span> : null}
          <span className="console-query__caret" aria-hidden="true" />
          {!query && <span className="console-query__placeholder">{t("console.searchPrompt")}</span>}
        </div>
        <div className="console-keyboard">
          {CHARACTERS.map((character) => <Key key={character} label={character} value={character.toLowerCase()} onKey={onKey} />)}
          <Key wide label={t("console.keyboardSpace")} value=" " onKey={onKey} />
          <Key wide label={t("console.keyboardDelete")} value="delete" icon={<Delete aria-hidden="true" />} onKey={onKey} />
          <Key wide label={t("console.keyboardClear")} value="clear" icon={<X aria-hidden="true" />} onKey={onKey} />
          <Key wide label={t("console.keyboardDone")} value="done" onKey={onKey} />
        </div>
      </div>

      <div className="console-search-screen__results">
        {normalized ? (
          resultGames.length > 0 ? <>
            <h2 className="console-section-title">{t("console.resultsFor", { query: debounced.trim() })}<span className="console-section-title__meta">{t("console.games", { count: resultGames.length })}</span></h2>
            <div className="console-grid console-grid--search">
              {resultGames.map((game) => <ConsoleCard key={game.id} game={game} onOpen={open} favourite={flags.isFavourite(game)} badge={flags.badge(game)} />)}
            </div>
          </> : results.isFetching ? <div className="console-empty">{t("console.loading")}</div> : (
            <div className="console-no-results">
              <SearchX aria-hidden="true" />
              <h2>{t("console.noMatch", { query: debounced.trim() })}</h2>
              {genres.length > 0 && <>
                <p>{t("console.tryGenre")}</p>
                <div className="console-chips console-chips--center">
                  {genres.map((genre) => (
                    <button key={genre} type="button" className="console-pill" data-console-focus onClick={() => onBrowseGenre(genre)}>
                      {genre}<ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>}
            </div>
          )
        ) : <>
          {history.length > 0 && (
            <section className="console-search-screen__recent" aria-label={t("console.recentSearches")}>
              <h2 className="console-section-title">{t("console.recentSearches")}</h2>
              <div className="console-chips">
                {history.map((term) => (
                  <span key={term} className="console-recent">
                    <button type="button" className="console-pill" data-console-focus onClick={() => setQuery(term)}>
                      <Search aria-hidden="true" />{term}
                    </button>
                    <button type="button" className="console-recent__remove" tabIndex={-1} aria-label={`${t("console.removeRecent")}: ${term}`} onClick={() => forget(term)}>
                      <X aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}
          <h2 className="console-section-title">{t("console.popularSearches")}</h2>
          <div className="console-grid console-grid--search">
            {popularGames.map((game) => <ConsoleCard key={game.id} game={game} onOpen={open} favourite={flags.isFavourite(game)} badge={flags.badge(game)} />)}
          </div>
        </>}
      </div>
    </div>
  );
}
