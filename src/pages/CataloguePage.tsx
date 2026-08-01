import { ChevronRight, Check, X } from "lucide-react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { GhostBoxGame } from "../data";
import type {
  CatalogueFilters,
  CatalogueFilterKey,
} from "../types";
import {
  filterCategoryColors,
  emptyCatalogueFilters,
  cataloguePageSize,
} from "../constants/catalogue";
import {
  getSelectedFilterCount,
  hasSelectedCatalogueFilters,
  uniqueSorted,
  limitFilterValues,
  getReleaseYear,
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
import { preloadGameListAssets } from "../utils/image";
import { useFlipLayout } from "../hooks/useFlipLayout";
import { createCatalogueHoverPreviewRetention } from "../utils/cataloguePreview";

const maxVisibleFilterOptions = 160;

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

function getFilterCategoryLabel(
  key: CatalogueFilterKey,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  return t(`catalogue.filters.${key}`);
}

interface CatalogueActiveFiltersProps {
  filters: CatalogueFilters;
  onRemove: (key: CatalogueFilterKey, value?: string) => void;
  onClearAll: () => void;
}

const CatalogueActiveFilters = memo(function CatalogueActiveFilters({
  filters,
  onRemove,
  onClearAll: _onClearAll,
}: CatalogueActiveFiltersProps) {
  const { appearance, t } = useSettings();
  const isEnglish = appearance.language === "en";
  const activeFilters = useMemo(
    () =>
      (Object.entries(filters) as [CatalogueFilterKey, string[]][]).flatMap(
        ([key, values]) => values.map((value) => ({ key, value }))
      ),
    [filters]
  );
  const layoutKey = useMemo(
    () => activeFilters.map(({ key, value }) => `${key}:${value}`).join("|"),
    [activeFilters]
  );
  const filtersRef = useFlipLayout<HTMLUListElement>(layoutKey);

  if (!activeFilters.length) return null;

  return (
    <div className="catalogue-page__active-filters">
      <ul ref={filtersRef}>
        {activeFilters.map(({ key, value }) => (
          <li key={`${key}-${value}`} data-layout-id={`${key}:${value}`}>
            <button
              type="button"
              className="catalogue-filter-chip"
              style={
                {
                  "--filter-color": filterCategoryColors[key],
                } as CSSProperties
              }
              onClick={() => onRemove(key, value)}
              aria-label={
                isEnglish
                  ? `Remove filter ${getFilterDisplayValue(key, value, appearance.language)}`
                  : `Remover filtro ${getFilterDisplayValue(key, value, appearance.language)}`
              }
            >
              <span className="catalogue-filter-chip__orb" />
              <span>
                {getFilterCategoryLabel(key, t)}: {getFilterDisplayValue(key, value, appearance.language)}
              </span>
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

interface CatalogueFilterSectionProps {
  title: string;
  filterKey: CatalogueFilterKey;
  values: string[];
  selectedValues: string[];
  onToggle: (key: CatalogueFilterKey, value: string) => void;
  onClear: (key: CatalogueFilterKey, value?: string) => void;
}

const CatalogueFilterSection = memo(function CatalogueFilterSection({
  title,
  filterKey,
  values,
  selectedValues,
  onToggle,
  onClear,
}: CatalogueFilterSectionProps) {
  const { appearance, t } = useSettings();
  const [isOpen, setIsOpen] = useState(() => selectedValues.length > 0);
  const contentId = useId();
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase();
  const selectedValueSet = useMemo(
    () => new Set(selectedValues),
    [selectedValues]
  );
  const visibleValues = useMemo(
    () =>
      normalizedSearchTerm
        ? values.filter((value) =>
            value.toLowerCase().includes(normalizedSearchTerm)
          )
        : values,
    [normalizedSearchTerm, values]
  );
  const renderedValues = useMemo(
    () => visibleValues.slice(0, maxVisibleFilterOptions),
    [visibleValues]
  );
  useEffect(() => {
    if (selectedValues.length > 0) setIsOpen(true);
  }, [selectedValues.length]);

  return (
    <section className="catalogue-filter-section">
      <button
        type="button"
        className="catalogue-filter-section__header"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <ChevronRight
          className={
            isOpen
              ? "catalogue-filter-section__chevron catalogue-filter-section__chevron--open"
              : "catalogue-filter-section__chevron"
          }
          size={16}
        />
        <span
          className="catalogue-filter-section__orb"
          style={{ ["--filter-orb-color" as string]: filterCategoryColors[filterKey] }}
        />
        <strong>{title}</strong>
        <span>{selectedValues.length || values.length}</span>
      </button>

      <div
        className="catalogue-filter-section__content"
        id={contentId}
        aria-hidden={!isOpen}
        data-collapsed={isOpen ? "false" : "true"}
      >
        <div className="catalogue-filter-section__content-inner">
          {selectedValues.length > 0 && (
            <button
              type="button"
              className="catalogue-filter-section__clear"
              onClick={() => onClear(filterKey)}
            >
              {t("catalogue.filters.clear", { count: selectedValues.length })}
            </button>
          )}

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
        </div>
      </div>
    </section>
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
  loading: boolean;
  initialLoading: boolean;
  query: string;
  page: number;
  /** Página do chunk atualmente na tela — pode ficar atrás de `page` durante um refetch. */
  displayedPage: number;
  chunkOffset: number;
  matched: number;
  hasError?: boolean;
  onRetry?: () => void;
  filters: CatalogueFilters;
  animateFilterPlaceholders: boolean;
  onFiltersChange: (filters: CatalogueFilters) => void;
  onPageChange: (page: number) => void;
  onOpenGame: (game: GhostBoxGame) => void;
  addedGameAppIds: Set<string>;
  addingGameId: string | null;
  removingGameId: string | null;
  onRemoveGame: (game: GhostBoxGame) => void;
  pulseLoading: boolean;
  scrollElementRef?: RefObject<HTMLElement | null>;
}

export function CataloguePage({
  games,
  facets,
  filtersLoading,
  loading,
  initialLoading,
  query,
  page,
  displayedPage,
  chunkOffset,
  matched,
  hasError = false,
  onRetry,
  filters,
  animateFilterPlaceholders,
  onFiltersChange,
  onPageChange,
  onOpenGame,
  addedGameAppIds,
  addingGameId,
  removingGameId,
  onRemoveGame,
  pulseLoading,
  scrollElementRef,
}: CataloguePageProps) {
  const { t } = useSettings();
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
    mode: "game" | "collection";
  } | null>(null);
  const [hoveredGame, setHoveredGame] = useState<GhostBoxGame | null>(null);
  const clearHoveredGame = useCallback(() => setHoveredGame(null), []);
  const hoverPreviewRetention = useMemo(
    () => createCatalogueHoverPreviewRetention(clearHoveredGame),
    [clearHoveredGame]
  );
  const selectedFilterCount = getSelectedFilterCount(filters);
  const hasActiveFilters = hasSelectedCatalogueFilters(filters);
  const hasSearchQuery = Boolean(query.trim());

  const filterSections = useMemo(() => {
    if (filtersLoading && !facets) return [];

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
  }, [facets, filters, filtersLoading, games, t]);

  const totalPages = Math.max(1, Math.ceil(matched / cataloguePageSize));
  // Só limita a página pedida quando já existe uma contagem real. Durante um
  // refetch `matched` pode zerar e o clamp jogaria a página para 1 e de volta,
  // disparando dois scrolls suaves.
  const currentPage = matched > 0 ? Math.min(page, totalPages) : page;

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

  useEffect(() => {
    hoverPreviewRetention.cancelClear();
    setHoveredGame(null);
  }, [displayedPage, hoverPreviewRetention, visibleGamesCacheKey]);

  useEffect(
    () => () => hoverPreviewRetention.dispose(),
    [hoverPreviewRetention]
  );

  const handleHoverGame = useCallback(
    (game: GhostBoxGame | null) => {
      if (game) {
        hoverPreviewRetention.cancelClear();
        setHoveredGame(game);
        return;
      }

      hoverPreviewRetention.scheduleClear();
    },
    [hoverPreviewRetention]
  );

  const handlePreviewPointerEnter = useCallback(() => {
    hoverPreviewRetention.cancelClear();
  }, [hoverPreviewRetention]);

  const handlePreviewPointerLeave = useCallback(() => {
    hoverPreviewRetention.scheduleClear();
  }, [hoverPreviewRetention]);

  useEffect(() => {
    if (loading || !visibleGames.length) return;

    preloadGameListAssets(visibleGames, {
      variant: "catalogueHeader",
      limit: 6,
    });
    preloadGameListAssets(nextPageGames, {
      variant: "catalogueHeader",
      limit: 6,
      idle: true,
    });
  }, [loading, nextPageGames, visibleGames, visibleGamesCacheKey]);

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

  const clearFilter = useCallback(
    (key: CatalogueFilterKey, value?: string) => {
      onFiltersChange({
        ...filters,
        [key]: value ? filters[key].filter((item) => item !== value) : [],
      });
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

  if (initialLoading) {
    return (
      <CatalogueLoadingState
        animateFilters={animateFilterPlaceholders}
        pulseLoading={pulseLoading}
      />
    );
  }

  return (
    <section className="catalogue-page">
      <CatalogueActiveFilters
        filters={filters}
        onClearAll={clearAllFilters}
        onRemove={clearFilter}
      />

      <div className="catalogue-page__content">
        <div className="catalogue-page__results">
          {hasError ? (
            <EmptyState
              title={t("catalogue.errorTitle")}
              description={t("catalogue.errorDescription")}
              actionLabel={onRetry ? t("catalogue.errorRetry") : undefined}
              onAction={onRetry}
            />
          ) : loading ? (
            <CatalogueListLoadingState
              animateListText={pulseLoading}
              pulseLoading={pulseLoading}
            />
          ) : visibleGames.length > 0 ? (
            <div className="catalogue-page__list-container">
              <CatalogueList
                games={visibleGames}
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
              query={
                query ||
                (selectedFilterCount
                  ? t("catalogue.filters.selected", {
                      count: selectedFilterCount,
                    })
                  : "")
              }
              title={hasSearchQuery ? t("header.searchNoResultsTitle") : undefined}
              description={
                hasSearchQuery ? t("header.searchNoResultsAppIdHint") : undefined
              }
              actionLabel={
                hasActiveFilters ? t("catalogue.filters.clearAll") : undefined
              }
              onAction={hasActiveFilters ? clearAllFilters : undefined}
            />
          )}

          {!loading && !hasError && totalPages > 1 && (
            <div className="catalogue-page__footer">
              <PaginationControls
                page={currentPage}
                totalPages={totalPages}
                onPageChange={onPageChange}
              />
            </div>
          )}
        </div>

        <aside className="catalogue-filters" aria-label={t("catalogue.filters.label")}>
          <div className="catalogue-filters__sections">
            {filtersLoading && <CatalogueFilterSectionsLoadingState />}
            {!filtersLoading && filterSections.map((section) => (
              <CatalogueFilterSection
                key={section.key}
                title={section.title}
                filterKey={section.key}
                values={section.values}
                selectedValues={filters[section.key]}
                onToggle={updateFilter}
                onClear={clearFilter}
              />
            ))}
            <CatalogueHoverPreview
              game={hoveredGame}
              onPointerEnter={handlePreviewPointerEnter}
              onPointerLeave={handlePreviewPointerLeave}
            />
          </div>
        </aside>
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
