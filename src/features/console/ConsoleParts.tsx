import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { memo, useMemo, useRef, type ReactNode } from "react";
import type { GhostBoxGame } from "../../data";
import { useCachedImageSources, useLoadableImageCover } from "../../hooks/useCachedImageSources";
import { gamePortraitPreviewSources, layeredImageStyle } from "../../utils/image";

/** Elemento focável → jogo, para □/△ agirem sobre o card focado sem prop drilling. */
export const consoleGameByElement = new WeakMap<HTMLElement, GhostBoxGame>();

export function consoleGameFromElement(element: HTMLElement | null): GhostBoxGame | undefined {
  const target = element?.closest<HTMLElement>("[data-console-focus]");
  return target ? consoleGameByElement.get(target) : undefined;
}

export function useConsoleArt(sources: string[]) {
  const cached = useCachedImageSources(sources);
  return useLoadableImageCover(cached, { decodeBeforeCommit: true });
}

export function ConsoleArt({ sources, className }: { sources: string[]; className: string }) {
  const { source, loaded } = useConsoleArt(sources);
  return (
    <span className={`${className}${source && loaded ? " is-loaded" : ""}`}
      style={layeredImageStyle(source && loaded ? [source] : [], "")} aria-hidden="true" />
  );
}

export function formatConsoleSize(size: string | undefined) {
  return size && size !== "—" && !/^0\b/.test(size) ? size : undefined;
}

/**
 * Card vertical 3:4 com gênero e título em até duas linhas.
 * No foco a capa sobe, ganha a borda com brilho e um reflexo atravessa a arte uma vez.
 */
export const ConsoleCard = memo(function ConsoleCard({ game, favourite, badge, onOpen, onFocusGame }: {
  game: GhostBoxGame;
  favourite?: boolean;
  badge?: string;
  onOpen: (game: GhostBoxGame) => void;
  onFocusGame?: (game: GhostBoxGame) => void;
}) {
  const sources = useMemo(() => gamePortraitPreviewSources(game), [game]);
  const genre = game.genres?.[0] ?? game.tags?.[0];
  return (
    <button type="button" className="console-card" data-console-focus aria-label={game.title}
      ref={(element) => { if (element) consoleGameByElement.set(element, game); }}
      onClick={() => onOpen(game)}
      onFocus={() => onFocusGame?.(game)}
      onMouseEnter={() => onFocusGame?.(game)}>
      <span className="console-card__cover">
        <ConsoleArt sources={sources} className="console-card__art" />
        <span className="console-card__glare" aria-hidden="true" />
        {favourite && <span className="console-card__wish" aria-hidden="true"><Heart fill="currentColor" /></span>}
        {badge && <span className="console-card__badge">{badge}</span>}
      </span>
      <span className="console-card__genre">{genre ?? " "}</span>
      <span className="console-card__title">{game.title}</span>
    </button>
  );
});

export type ConsoleGlyphName = "cross" | "circle" | "square" | "triangle" | "l1" | "r1";

const FACES: Record<"cross" | "circle" | "square" | "triangle", string[]> = {
  cross: ["M7.5 7.5l9 9", "M16.5 7.5l-9 9"],
  circle: ["M17.5 12a5.5 5.5 0 1 1-11 0a5.5 5.5 0 1 1 11 0"],
  triangle: ["M12 6.5l6 10.5H6z"],
  square: ["M7 7h10v10H7z"],
};

export function ConsoleGlyph({ name }: { name: ConsoleGlyphName }) {
  if (name === "l1" || name === "r1") {
    return <span className="console-cap" aria-hidden="true">{name.toUpperCase()}</span>;
  }
  return (
    <svg className="console-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="console-glyph__face" cx="12" cy="12" r="11" />
      {FACES[name].map((d) => <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

export type ConsoleHint = { glyphs: ConsoleGlyphName[]; label: string };

export function ConsoleHints({ hints }: { hints: ConsoleHint[] }) {
  return (
    <footer className="console-hints" aria-hidden="true">
      {hints.map((hint) => (
        <span className="console-hints__item" key={hint.label}>
          <span className="console-hints__glyphs">{hint.glyphs.map((glyph) => <ConsoleGlyph key={glyph} name={glyph} />)}</span>
          <span>{hint.label}</span>
        </span>
      ))}
    </footer>
  );
}

export function ConsolePageTitle({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="console-page-title">
      <h1>{title}{meta && <span>{meta}</span>}</h1>
      {children}
    </div>
  );
}

/** Trilho horizontal: título de seção, setas para o mouse e a faixa rolável de cards. */
export function ConsoleRail({ title, onSeeAll, seeAllLabel, previousLabel, nextLabel, children }: {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel: string;
  previousLabel: string;
  nextLabel: string;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const page = (direction: 1 | -1) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <section className="console-rail" aria-label={title}>
      <div className="console-rail__header">
        {onSeeAll
          ? <button type="button" className="console-rail__title console-rail__title--link" data-console-focus aria-label={`${title}: ${seeAllLabel}`} onClick={onSeeAll}>
              {title}<ChevronRight aria-hidden="true" />
            </button>
          : <h2 className="console-rail__title">{title}</h2>}
        <div className="console-rail__arrows">
          <button type="button" tabIndex={-1} aria-label={previousLabel} onClick={() => page(-1)}><ChevronLeft aria-hidden="true" /></button>
          <button type="button" tabIndex={-1} aria-label={nextLabel} onClick={() => page(1)}><ChevronRight aria-hidden="true" /></button>
        </div>
      </div>
      <div ref={track} className="console-rail__track">{children}</div>
    </section>
  );
}
