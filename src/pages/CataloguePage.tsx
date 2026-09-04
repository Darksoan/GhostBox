import { Check, ChevronDown } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { GhostBoxGame } from "../data";
import type {
  CatalogueFilters,
  CatalogueFilterKey,
  CatalogueSort,
} from "../types";
import {
  emptyCatalogueFilters,
  cataloguePageSize,
} from "../constants/catalogue";
import {
  getYearRangeIndices,
  getYearsInRange,
  hasSelectedCatalogueFilters,
  uniqueSorted,
  limitFilterValues,
  getReleaseYear,
  sortYearValues,
} from "../utils/filters";
import { CatalogueList } from "../components/ui/CatalogueList";
import { CatalogueHoverPreview } from "../components/ui/CatalogueHoverPreview";
import { PaginationControls } from "../components/ui/PaginationControls";
import {
  CatalogueFilterSectionsLoadingState,
  CatalogueLoadingState,
  CatalogueListLoadingState,
  EmptyState,
} from "../components/ui/LoadingStates";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useGameContextMenu } from "../hooks/useGameContextMenu";
import { useSettings } from "../context/settings";
import { preloadGameListAssets, withoutHeaderImageSources } from "../utils/image";
import { getLoadedImageSource } from "../utils/imageCache";
import {
  CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS,
  CATALOGUE_SCROLL_IDLE_DELAY_MS,
  createCatalogueHoverPreviewIntent,
  createCatalogueHoverPreviewRetention,
  type CataloguePreviewPointer,
} from "../utils/cataloguePreview";
const maxVisibleFilterOptions = 160;

function normalizeFilterText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getFilterDisplayValue(
  _key: CatalogueFilterKey,
  value: string,
  language: "pt" | "en" = "pt"
) {
  if (language === "pt") {
    const labels: Record<string, string> = {
      Action: "Ação",
      Adventure: "Aventura",
      Atmospheric: "Atmosférico",
      Exploration: "Exploração",
      Fantasy: "Fantasia",
      Horror: "Terror",
      Racing: "Corrida",
      Simulation: "Simulação",
      Sports: "Esportes",
      Strategy: "Estratégia",
      "Story Rich": "Boa trama",
      Survival: "Sobrevivência",
    };

    return labels[value] ?? value;
  }

  return value;
}

const yearRangeCommitKeys = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

interface CatalogueYearRangeProps {
  title: string;
  values: string[];
  selectedValues: string[];
  startLabel: string;
  endLabel: string;
  onChange: (values: string[]) => void;
}

const CatalogueYearRange = memo(function CatalogueYearRange({
  title,
  values,
  selectedValues,
  startLabel,
  endLabel,
  onChange,
}: CatalogueYearRangeProps) {
  const selectedRange = useMemo(
    () => getYearRangeIndices(values, selectedValues),
    [selectedValues, values]
  );
  const [range, setRange] = useState(selectedRange);
  const rangeRef = useRef(range);

  useEffect(() => {
    rangeRef.current = selectedRange;
    setRange(selectedRange);
  }, [selectedRange]);

  const lastIndex = values.length - 1;
  const setDraftRange = useCallback((nextRange: { start: number; end: number }) => {
    rangeRef.current = nextRange;
    setRange(nextRange);
  }, []);
  const commitRange = useCallback(() => {
    const { start, end } = rangeRef.current;
    const nextValues =
      start === 0 && end === lastIndex
        ? []
        : getYearsInRange(values, start, end);

    onChange(nextValues);
  }, [lastIndex, onChange, values]);

  if (!values.length) return null;

  const startYear = values[range.start];
  const endYear = values[range.end];
  const rangeStyle = {
    "--catalogue-year-range-start": `${lastIndex > 0 ? (range.start / lastIndex) * 100 : 0}%`,
    "--catalogue-year-range-end": `${lastIndex > 0 ? (range.end / lastIndex) * 100 : 0}%`,
  } as CSSProperties;
  const handleKeyUp = (key: string) => {
    if (yearRangeCommitKeys.has(key)) commitRange();
  };

  return (
    <div className="catalogue-filter-section__year-range" role="group" aria-label={title}>
      <output className="catalogue-filter-section__year-range-value" aria-live="polite">
        {startYear === endYear ? startYear : `${startYear} - ${endYear}`}
      </output>
      <div className="catalogue-filter-section__year-range-track" style={rangeStyle}>
        <input
          type="range"
          className="catalogue-filter-section__year-range-input catalogue-filter-section__year-range-input--start"
          min={0}
          max={lastIndex}
          step={1}
          value={range.start}
          disabled={lastIndex === 0}
          aria-label={startLabel}
          aria-valuetext={startYear}
          onChange={(event) => {
            const start = Math.min(
              Number(event.currentTarget.value),
              rangeRef.current.end
            );
            setDraftRange({ start, end: rangeRef.current.end });
          }}
          onPointerUp={commitRange}
          onBlur={commitRange}
          onKeyUp={(event) => handleKeyUp(event.key)}
        />
        <input
          type="range"
          className="catalogue-filter-section__year-range-input catalogue-filter-section__year-range-input--end"
          min={0}
          max={lastIndex}
          step={1}
          value={range.end}
          disabled={lastIndex === 0}
          aria-label={endLabel}
          aria-valuetext={endYear}
          onChange={(event) => {
            const end = Math.max(
              Number(event.currentTarget.value),
              rangeRef.current.start
            );
            setDraftRange({ start: rangeRef.current.start, end });
          }}
          onPointerUp={commitRange}
          onBlur={commitRange}
          onKeyUp={(event) => handleKeyUp(event.key)}
        />
      </div>
      <div className="catalogue-filter-section__year-range-bounds" aria-hidden="true">
        <span>{values[0]}</span>
        <span>{values[lastIndex]}</span>
      </div>
    </div>
  );
});

interface CatalogueFilterSectionProps {
  title: string;
  filterKey: CatalogueFilterKey;
  values: string[];
  selectedValues: string[];
  onToggle: (key: CatalogueFilterKey, value: string) => void;
  onYearRangeChange?: (values: string[]) => void;
}

const CatalogueFilterSection = memo(function CatalogueFilterSection({
  title,
  filterKey,
  values,
  selectedValues,
  onToggle,
  onYearRangeChange,
}: CatalogueFilterSectionProps) {
  const { appearance, t } = useSettings();
  // Dropdown, não acordeão: a barra é horizontal e não tem altura para expandir
  // no fluxo — o painel abre por cima. Fechado por padrão mesmo com seleção
  // ativa; a contagem no gatilho já sinaliza que o filtro está valendo.
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentId = useId();
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearchTerm = useMemo(
    () => normalizeFilterText(searchTerm.trim()),
    [searchTerm]
  );
  const selectedValueSet = useMemo(
    () => new Set(selectedValues),
    [selectedValues]
  );
  const visibleValues = useMemo(() => {
    if (!normalizedSearchTerm) return values;
    return values.filter((value) => {
      if (normalizeFilterText(value).includes(normalizedSearchTerm))
        return true;
      const displayValue = getFilterDisplayValue(
        filterKey,
        value,
        appearance.language
      );
      return normalizeFilterText(displayValue).includes(normalizedSearchTerm);
    });
  }, [appearance.language, filterKey, normalizedSearchTerm, values]);
  const renderedValues = useMemo(
    () => visibleValues.slice(0, maxVisibleFilterOptions),
    [visibleValues]
  );
  const yearValues = useMemo(
    () => (filterKey === "years" ? sortYearValues(values) : []),
    [filterKey, values]
  );
  const selectedCount = filterKey === "years" ? Number(selectedValues.length > 0) : selectedValues.length;

  // Clique fora e Escape fecham. Escape devolve o foco ao gatilho — sem isso o
  // foco fica no painel que acabou de sair do DOM e o Tab seguinte recomeça do
  // topo da página.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={`catalogue-filter-section${
        isOpen ? " catalogue-filter-section--open" : ""
      }`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="catalogue-filter-section__header"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <strong>{title}</strong>
        {selectedCount > 0 && <span>{selectedCount}</span>}
        <ChevronDown
          className={
            isOpen
              ? "catalogue-filter-section__chevron catalogue-filter-section__chevron--open"
              : "catalogue-filter-section__chevron"
          }
          size={14}
          aria-hidden="true"
        />
      </button>

      {/* Painel some do DOM ao fechar, em vez de colapsar com `grid-template-rows`
          como fazia na barra lateral: flutuando por cima da listagem, um painel
          de altura zero ainda intercepta ponteiro e Tab. */}
      {isOpen && (
        <div className="catalogue-filter-section__content" id={contentId}>
          <div className="catalogue-filter-section__content-inner">
          {filterKey === "years" && onYearRangeChange ? (
            <CatalogueYearRange
              title={title}
              values={yearValues}
              selectedValues={selectedValues}
              startLabel={t("catalogue.filters.yearStart")}
              endLabel={t("catalogue.filters.yearEnd")}
              onChange={onYearRangeChange}
            />
          ) : (
            <>
              <input
                type="search"
                className="catalogue-filter-section__search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t("catalogue.filters.search", {
                  title: title.toLowerCase(),
                })}
                aria-label={t("catalogue.filters.search", {
                  title: title.toLowerCase(),
                })}
              />

              <div className="catalogue-filter-section__options">
                {visibleValues.length > 0 ? (
                  <>
                    {renderedValues.map((value) => {
                      const checked = selectedValueSet.has(value);
                      return (
                        <label className="catalogue-filter-option" key={value}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(filterKey, value)}
                          />
                          <span className="catalogue-filter-option__box">
                            {checked && <Check size={12} strokeWidth={2.0} />}
                          </span>
                          <span>{getFilterDisplayValue(filterKey, value, appearance.language)}</span>
                        </label>
                      );
                    })}
                  </>
                ) : (
                  <span className="catalogue-filter-section__empty">
                    {t("catalogue.filters.empty")}
                  </span>
                )}
              </div>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
});
interface CataloguePageProps {
  games: GhostBoxGame[];
  facets?: {
    genres?: string[];
    tags?: string[];
    developers?: string[];
    publishers?: string[];
    years?: string[];
  };
  filtersLoading: boolean;
  refreshing: boolean;
  loading: boolean;
  initialLoading: boolean;
  query: string;
  page: number;
  /** Página do chunk atualmente na tela — pode ficar atrás de `page` durante um refetch. */
  displayedPage: number;
  chunkOffset: number;
  matched: number;
  hasError?: boolean;
  hasRefreshError?: boolean;
  hasFacetsError?: boolean;
  onRetry?: () => void;
  filters: CatalogueFilters;
  onFiltersChange: (filters: CatalogueFilters) => void;
  onPageChange: (page: number) => void;
  sort: CatalogueSort;
  onSortChange: (sort: CatalogueSort) => void;
  onOpenGame: (game: GhostBoxGame) => void;
  addedGameAppIds: Set<string>;
  addingGameId: string | null;
  removingGameId: string | null;
  onRemoveGame: (game: GhostBoxGame) => void;
  scrollElementRef?: RefObject<HTMLElement | null>;
}

export function CataloguePage({
  games,
  facets,
  filtersLoading,
  refreshing,
  loading,
  initialLoading,
  query,
  page,
  displayedPage,
  chunkOffset,
  matched,
  hasError = false,
  hasRefreshError = false,
  hasFacetsError = false,
  onRetry,
  filters,
  onFiltersChange,
  onPageChange,
  sort,
  onSortChange,
  onOpenGame,
  addedGameAppIds,
  addingGameId,
  removingGameId,
  onRemoveGame,
  scrollElementRef,
}: CataloguePageProps) {
  const { t } = useSettings();
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  // Método de visualização da listagem (lista / grade). Estado local, no mesmo
  // padrão do sort do catálogo (não persistido entre sessões).
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
    mode: "game" | "collection";
  } | null>(null);
  // Só o jogo: o preview mora numa coluna fixa, então não precisa mais saber
  // de qual cartão veio nem onde o cursor estava.
  const [hoveredPreview, setHoveredPreview] = useState<GhostBoxGame | null>(
    null
  );
  const [isCatalogueScrolling, setIsCatalogueScrolling] = useState(false);
  const isCatalogueScrollingRef = useRef(false);
  const scrollIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPointerRef = useRef<CataloguePreviewPointer | null>(null);
  const lastPreviewGameRef = useRef<GhostBoxGame | null>(null);
  const clearHoveredGame = useCallback(() => setHoveredPreview(null), []);
  const commitHoveredPreview = useCallback((game: GhostBoxGame) => {
    if (
      isCatalogueScrollingRef.current ||
      document.visibilityState === "hidden" ||
      !document.hasFocus() ||
      lastPreviewGameRef.current?.id === game.id
    )
      return;
    lastPreviewGameRef.current = game;
    setHoveredPreview(game);
  }, []);
  const hoverPreviewRetention = useMemo(
    () => createCatalogueHoverPreviewRetention(clearHoveredGame),
    [clearHoveredGame]
  );
  const hoverPreviewIntent = useMemo(
    () => createCatalogueHoverPreviewIntent<GhostBoxGame>(commitHoveredPreview),
    [commitHoveredPreview]
  );
  const sortOptions = useMemo(
    () =>
      [
        { value: "popular", label: t("catalogue.sort.popular") },
        { value: "recentlyAdded", label: t("catalogue.sort.recentlyAdded") },
        { value: "playingNow", label: t("catalogue.sort.playingNow") },
      ] as { value: CatalogueSort; label: string }[],
    [t]
  );
  const sortLabel =
    sortOptions.find((option) => option.value === sort)?.label ?? "";

  const viewOptions = useMemo(
    () => [
      { value: "list", label: t("catalogue.view.list") },
      { value: "grid", label: t("catalogue.view.grid") },
    ] as { value: "list" | "grid"; label: string }[],
    [t]
  );
  const viewLabel =
    viewOptions.find((option) => option.value === viewMode)?.label ?? "";

  useEffect(() => {
    if (!sortDropdownOpen && !viewDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        sortDropdownOpen &&
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setSortDropdownOpen(false);
      }
      if (
        viewDropdownOpen &&
        viewDropdownRef.current &&
        !viewDropdownRef.current.contains(event.target as Node)
      ) {
        setViewDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortDropdownOpen(false);
        setViewDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortDropdownOpen, viewDropdownOpen]);

  const hasActiveFilters = hasSelectedCatalogueFilters(filters);
  const hasSearchQuery = Boolean(query.trim());

  const filterSections = useMemo(() => {
    if (filtersLoading && !facets) return [];
    if (hasFacetsError && !facets) return [];

    const genres = limitFilterValues(
      facets?.genres?.length
        ? facets.genres
        : uniqueSorted(games.flatMap((game) => game.genres)),
      filters.genres
    );
    const tags = limitFilterValues(
      facets?.tags?.length
        ? facets.tags
        : uniqueSorted(games.flatMap((game) => game.tags)),
      filters.tags
    );
    const yearValues = (
      facets?.years?.length
        ? facets.years
        : uniqueSorted(games.map(getReleaseYear)).sort(
            (left, right) => Number(right) - Number(left)
          )
    ).filter((year) => year !== "Data indisponivel");
    const years = limitFilterValues(
      yearValues,
      filters.years.filter((year) => year !== "Data indisponivel")
    );
    const developers = limitFilterValues(
      facets?.developers?.length
        ? facets.developers
        : uniqueSorted(games.flatMap((game) => game.developers ?? [])),
      filters.developers
    );
    const publishers = limitFilterValues(
      facets?.publishers?.length
        ? facets.publishers
        : uniqueSorted(games.flatMap((game) => game.publishers ?? [])),
      filters.publishers
    );

    return [
      { key: "genres" as const, title: t("catalogue.filters.genres"), values: genres },
      { key: "tags" as const, title: t("catalogue.filters.tags"), values: tags },
      {
        key: "developers" as const,
        title: t("catalogue.filters.developers"),
        values: developers,
      },
      {
        key: "publishers" as const,
        title: t("catalogue.filters.publishers"),
        values: publishers,
      },
      { key: "years" as const, title: t("catalogue.filters.years"), values: years },
    ].filter((section) => section.values.length > 0);
  }, [facets, filters, filtersLoading, games, hasFacetsError, t]);

  const totalPages = Math.max(1, Math.ceil(matched / cataloguePageSize));
  // Só limita a página pedida quando já existe uma contagem real. Durante um
  // refetch `matched` pode zerar e o clamp jogaria a página para 1 e de volta,
  // disparando dois scrolls suaves.
  const isPageTransitioning = page !== displayedPage;
  const currentPage = isPageTransitioning
    ? displayedPage
    : matched > 0
      ? Math.min(page, totalPages)
      : page;

  useEffect(() => {
    scrollElementRef?.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage, scrollElementRef]);

  // O slice acompanha a página *exibida* (a do chunk que está na tela), não a
  // pedida — com `keepPreviousData` as duas divergem enquanto o chunk novo
  // carrega, e fatiar o array velho no offset novo pintava um vazio de um frame.
  const startIndex = Math.max(
    0,
    (displayedPage - 1) * cataloguePageSize - chunkOffset
  );
  const visibleGames = useMemo(
    () => games.slice(startIndex, startIndex + cataloguePageSize),
    [games, startIndex]
  );
  const nextPageGames = useMemo(
    () =>
      games.slice(
        startIndex + cataloguePageSize,
        startIndex + cataloguePageSize * 2
      ),
    [games, startIndex]
  );
  const visibleGamesCacheKey = useMemo(
    () => `${displayedPage}-${chunkOffset}-${visibleGames.map((game) => game.id).join("|")}`,
    [chunkOffset, displayedPage, visibleGames]
  );

  // Reserva inicial do preview. Depois do primeiro hover confirmado, o último
  // jogo visto passa a ser mantido quando o cursor sai do card.
  const fallbackPreviewGame = useMemo(() => {
    if (!visibleGames.length) return null;
    return visibleGames[Math.floor(Math.random() * visibleGames.length)];
  }, [visibleGamesCacheKey, visibleGames]);

  const previewGame =
    hoveredPreview ?? lastPreviewGameRef.current ?? fallbackPreviewGame;

  useEffect(() => {
    hoverPreviewRetention.cancelClear();
    hoverPreviewIntent.cancel();
    lastPreviewGameRef.current = null;
    setHoveredPreview(null);
    setContextMenu(null);
  }, [displayedPage, hoverPreviewIntent, hoverPreviewRetention, visibleGamesCacheKey]);

  useEffect(
    () => () => {
      hoverPreviewRetention.dispose();
      hoverPreviewIntent.dispose();
    },
    [hoverPreviewRetention, hoverPreviewIntent]
  );

  const handleHoverGame = useCallback(
    (
      game: GhostBoxGame | null,
      options?: {
        immediate?: boolean;
        /* `anchor` e `pointer` continuam no contrato porque `CatalogueList` os
           envia, mas a coluna fixa não usa nenhum dos dois. */
        anchor?: HTMLElement | null;
        pointer?: CataloguePreviewPointer | null;
        settled?: boolean;
      }
    ) => {
      if (game) {
        if (options?.pointer) hoverPointerRef.current = options.pointer;
        if (isCatalogueScrollingRef.current) {
          hoverPreviewIntent.cancel();
          return;
        }
        hoverPreviewRetention.cancelClear();
        const loadedScreenshot = getLoadedImageSource(
          withoutHeaderImageSources(game.screenshots ?? []).slice(0, 1)
        );
        if (options?.immediate || loadedScreenshot) {
          hoverPreviewIntent.showImmediately(game);
        } else {
          // Hover que veio do conteúdo se mexendo espera bem mais: assim a
          // enxurrada de cartões passando sob o cursor comita um preview só,
          // no fim, em vez de um por cartão.
          hoverPreviewIntent.scheduleShow(
            game,
            options?.settled === false
              ? CATALOGUE_HOVER_PREVIEW_SETTLE_DELAY_MS
              : undefined
          );
        }
        return;
      }

      if (isCatalogueScrollingRef.current) return;
      hoverPreviewIntent.cancel();
      hoverPreviewRetention.scheduleClear();
    },
    [hoverPreviewIntent, hoverPreviewRetention]
  );

  useEffect(() => {
    const scrollElement = scrollElementRef?.current;
    if (!scrollElement) return;

    const finishScroll = () => {
      if (scrollIdleTimeoutRef.current !== null) {
        clearTimeout(scrollIdleTimeoutRef.current);
        scrollIdleTimeoutRef.current = null;
      }
      isCatalogueScrollingRef.current = false;
      setIsCatalogueScrolling((current) => (current ? false : current));
    };

    const resumeHoverAtPointer = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      finishScroll();
      const pointer = hoverPointerRef.current;
      const hoveredElement =
        pointer && typeof document !== "undefined"
          ? document
              .elementFromPoint(pointer.x, pointer.y)
              ?.closest<HTMLElement>("[data-catalogue-game-id]")
          : null;
      const gameId = hoveredElement?.dataset.catalogueGameId;
      const game = gameId
        ? visibleGames.find((candidate) => candidate.id === gameId)
        : undefined;

      if (game) {
        handleHoverGame(game, { pointer });
      } else {
        hoverPreviewRetention.scheduleClear();
      }
    };

    const handleScroll = () => {
      isCatalogueScrollingRef.current = true;
      setIsCatalogueScrolling(true);
      hoverPreviewIntent.cancel();
      hoverPreviewRetention.cancelClear();

      if (scrollIdleTimeoutRef.current !== null) {
        clearTimeout(scrollIdleTimeoutRef.current);
      }

      scrollIdleTimeoutRef.current = setTimeout(resumeHoverAtPointer, CATALOGUE_SCROLL_IDLE_DELAY_MS);
    };

    const handleWindowBlur = () => {
      hoverPreviewIntent.cancel();
      hoverPreviewRetention.cancelClear();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleWindowBlur();
        finishScroll();
        return;
      }
      resumeHoverAtPointer();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("focus", resumeHoverAtPointer);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      window.removeEventListener("focus", resumeHoverAtPointer);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      finishScroll();
    };
  }, [scrollElementRef, visibleGames, hoverPreviewIntent, hoverPreviewRetention, handleHoverGame]);

  const handlePreviewPointerEnter = useCallback(() => {
    hoverPreviewRetention.cancelClear();
  }, [hoverPreviewRetention]);

  const handlePreviewPointerLeave = useCallback(() => {
    hoverPreviewRetention.scheduleClear();
  }, [hoverPreviewRetention]);

  useEffect(() => {
    if (loading || isCatalogueScrolling || !visibleGames.length) return;

    const cancelVisiblePreload = preloadGameListAssets(visibleGames, {
      variant: "catalogueHeader",
      limit: 6,
      idle: false,
    });
    const cancelNextPagePreload = preloadGameListAssets(nextPageGames, {
      variant: "catalogueHeader",
      limit: 6,
      idle: true,
    });

    return () => {
      cancelVisiblePreload();
      cancelNextPagePreload();
    };
  }, [
    isCatalogueScrolling,
    loading,
    nextPageGames,
    visibleGames,
    visibleGamesCacheKey,
  ]);

  // Estáveis de propósito: `CatalogueFilterSection` e `CatalogueListItem` são
  // `memo` e qualquer callback recriado por render anula a memoização — cada
  // clique repintava todas as seções de filtro (até 160 checkboxes cada).
  const updateFilter = useCallback(
    (key: CatalogueFilterKey, value: string) => {
      const currentValues = filters[key];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];
      onFiltersChange({ ...filters, [key]: nextValues });
    },
    [filters, onFiltersChange]
  );

  const updateYearRange = useCallback(
    (values: string[]) => {
      onFiltersChange({ ...filters, years: values });
    },
    [filters, onFiltersChange]
  );

  const clearAllFilters = useCallback(() => {
    onFiltersChange(emptyCatalogueFilters);
  }, [onFiltersChange]);

  const handleGameContextMenu = useCallback(
    (game: GhostBoxGame, x: number, y: number) => {
      setContextMenu({ game, x, y, mode: "game" });
    },
    []
  );

  const contextMenuItems = useGameContextMenu({
    game: contextMenu?.game ?? null,
    onOpenGame,
    includeFavorites: contextMenu?.mode !== "collection",
    directFavoriteAction: contextMenu?.mode !== "collection",
    onlyCollectionActions: contextMenu?.mode === "collection",
  });
  const emptyStateTitle = hasSearchQuery
    ? t("header.searchNoResultsTitle")
    : hasActiveFilters
      ? t("catalogue.noResultsTitle")
      : undefined;
  const emptyStateDescription = hasSearchQuery
    ? t("header.searchNoResultsAppIdHint")
    : hasActiveFilters
      ? t("catalogue.noResultsDescription")
      : undefined;

  if (initialLoading) {
    return <CatalogueLoadingState />;
  }

  return (
    <section className="catalogue-page">
      <div className="catalogue-page__toolbar">
            {/* Filtros e ordenação na mesma linha: os dois são controles da
                listagem, e separá-los em duas faixas gastava uma linha inteira
                só para a ordenação. */}
            <div
              className="catalogue-filterbar"
              role="group"
              aria-label={t("catalogue.filters.label")}
            >
              {/* Skeleton enquanto não houver seção alguma, independente de
                  `filtersLoading`: entre o fim do carregamento inicial e a
                  chegada das facets a flag já é `false` e a barra ficava vazia,
                  empurrando a listagem quando as pílulas apareciam. */}
              {!hasFacetsError && !filterSections.length && (filtersLoading || loading || !facets) && (
                <CatalogueFilterSectionsLoadingState />
              )}
              {hasFacetsError && !filterSections.length && (
                <span className="catalogue-filterbar__error">
                  {t("catalogue.facetsError")}
                </span>
              )}
              {filterSections.map((section) => (
                <CatalogueFilterSection
                  key={section.key}
                  title={section.title}
                  filterKey={section.key}
                  values={section.values}
                  selectedValues={filters[section.key]}
                  onToggle={updateFilter}
                  onYearRangeChange={
                    section.key === "years" ? updateYearRange : undefined
                  }
                />
              ))}
            </div>
            <div className="catalogue-page__toolbar-actions">
              <div
                className={`settings-dropdown catalogue-page__sort ${sortDropdownOpen ? "settings-dropdown--open" : ""}`}
                ref={sortDropdownRef}
              >
                <button
                  type="button"
                  className="settings-dropdown__trigger"
                  aria-haspopup="listbox"
                  aria-expanded={sortDropdownOpen}
                  aria-label={t("catalogue.sort.label")}
                  onClick={() => setSortDropdownOpen((open) => !open)}
                >
                  <span>{sortLabel}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {sortDropdownOpen && (
                  <div
                    className="settings-dropdown__menu"
                    role="listbox"
                    aria-label={t("catalogue.sort.label")}
                  >
                    {sortOptions
                      .filter((option) => option.value !== sort)
                      .map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="settings-dropdown__option"
                          onClick={() => {
                            onSortChange(option.value);
                            setSortDropdownOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {/* Dropdown de visualização: alterna a listagem entre lista
                  (horizontal) e grade de cards estilo "Bem avaliados". Mesmo
                  padrão do dropdown de ordenação ao lado. */}
              <div
                className={`settings-dropdown catalogue-page__view ${viewDropdownOpen ? "settings-dropdown--open" : ""}`}
                ref={viewDropdownRef}
              >
                <button
                  type="button"
                  className="settings-dropdown__trigger"
                  aria-haspopup="listbox"
                  aria-expanded={viewDropdownOpen}
                  aria-label={t("catalogue.view.label")}
                  onClick={() => setViewDropdownOpen((open) => !open)}
                >
                  <span>{viewLabel}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {viewDropdownOpen && (
                  <div
                    className="settings-dropdown__menu"
                    role="listbox"
                    aria-label={t("catalogue.view.label")}
                  >
                    {viewOptions
                      .filter((option) => option.value !== viewMode)
                      .map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="settings-dropdown__option"
                          onClick={() => {
                            setViewMode(option.value);
                            setViewDropdownOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="catalogue-page__clear-filters"
                  onClick={clearAllFilters}
                >
                  {t("catalogue.filters.clearAll")}
                </button>
              )}
            </div>
      </div>

      <div
        className={`catalogue-page__content${
          viewMode === "grid" ? " catalogue-page__content--grid" : ""
        }`}
      >
        <div
          className={`catalogue-page__results${
            refreshing ? " catalogue-page__results--refreshing" : ""
          }`}
        >
          {hasRefreshError && (
            <div className="catalogue-page__notice" role="alert">
              <span>{t("catalogue.refreshError")}</span>
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  {t("catalogue.errorRetry")}
                </button>
              )}
            </div>
          )}
          {hasError ? (
            <EmptyState
              title={t("catalogue.errorTitle")}
              description={t("catalogue.errorDescription")}
              actionLabel={onRetry ? t("catalogue.errorRetry") : undefined}
              onAction={onRetry}
            />
          ) : loading ? (
            <CatalogueListLoadingState />
          ) : visibleGames.length > 0 ? (
            <div className="catalogue-page__list-container">
              <CatalogueList
                games={visibleGames}
                viewMode={viewMode}
                onOpenGame={onOpenGame}
                onHoverGame={handleHoverGame}
                addedGameAppIds={addedGameAppIds}
                addingGameId={addingGameId}
                removingGameId={removingGameId}
                onRemoveGame={onRemoveGame}
                onGameContextMenu={handleGameContextMenu}
              />
            </div>
          ) : (
            <EmptyState
              query={query}
              title={emptyStateTitle}
              description={emptyStateDescription}
              actionLabel={
                hasActiveFilters ? t("catalogue.filters.clearAll") : undefined
              }
              onAction={hasActiveFilters ? clearAllFilters : undefined}
            />
          )}

          {/* Indicador de recarga: os cards permanecem na tela, escurecidos, em
              vez de trocar por skeleton e fazer a página pular de altura. O
              spinner é `sticky` (ver SCSS), então fica centrado no que está
              visível mesmo numa lista longa. */}
          {refreshing && (
            <div className="catalogue-page__refreshing" role="status">
              <span
                className="page-spinner-loading__spinner"
                aria-hidden="true"
              />
              <span className="sr-only">{t("loading.catalogue")}</span>
            </div>
          )}

          {!refreshing && !loading && !hasError && totalPages > 1 && (
            <div className="catalogue-page__footer">
              <PaginationControls
                page={currentPage}
                totalPages={totalPages}
                onPageChange={onPageChange}
              />
            </div>
          )}
        </div>

        {/* Coluna do preview: ocupa a faixa onde antes ficavam os filtros. Fica
            montada mesmo sem hover para a listagem não mudar de largura toda vez
            que o cursor entra e sai de um card. */}
        {viewMode === "list" && (
          <aside
            className="catalogue-preview-column"
            aria-label={t("catalogue.preview.columnLabel")}
          >
            <CatalogueHoverPreview
              game={previewGame}
              paused={isCatalogueScrolling}
              onOpenGame={onOpenGame}
              onPointerEnter={handlePreviewPointerEnter}
              onPointerLeave={handlePreviewPointerLeave}
            />
          </aside>
        )}
      </div>

      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}
