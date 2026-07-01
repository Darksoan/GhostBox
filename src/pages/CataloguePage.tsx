import { ChevronRight, Check, X } from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { GhostBoxGame } from "../data";
import { Clock, ThumbsUp } from "lucide-react";
import type {
  CatalogueFilters,
  CatalogueFilterKey,
  CatalogueSort,
  UserCollection,
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
import { PaginationControls } from "../components/ui/PaginationControls";
import {
  CatalogueLoadingState,
  CatalogueListLoadingState,
  EmptyState,
} from "../components/ui/LoadingStates";
import { ContextMenu } from "../components/ui/ContextMenu";
import { useCollectionContextMenu } from "../hooks/useCollectionContextMenu";
import { useSettings } from "../context/settings";
import { preloadGameListAssets } from "../utils/image";

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
  const activeFilters = (
    Object.entries(filters) as [CatalogueFilterKey, string[]][]
  ).flatMap(([key, values]) => values.map((value) => ({ key, value })));

  if (!activeFilters.length) return null;

  return (
    <div className="catalogue-page__active-filters">
      <ul>
        {activeFilters.map(({ key, value }) => (
          <li key={`${key}-${value}`}>
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
  const hiddenOptionCount = Math.max(
    0,
    visibleValues.length - renderedValues.length
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
          style={{ backgroundColor: filterCategoryColors[filterKey] }}
        />
        <strong>{title}</strong>
        <span>{selectedValues.length || values.length}</span>
      </button>

      {isOpen && (
        <div className="catalogue-filter-section__content">
          {selectedValues.length > 0 ? (
            <button
              type="button"
              className="catalogue-filter-section__clear"
              onClick={() => onClear(filterKey)}
            >
              {t("catalogue.filters.clear", { count: selectedValues.length })}
            </button>
          ) : (
            <span className="catalogue-filter-section__count">
              {t("catalogue.filters.options", { count: values.length })}
            </span>
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
                {hiddenOptionCount > 0 && (
                  <span className="catalogue-filter-section__hint">
                    {t("catalogue.filters.showing", {
                      visible: renderedValues.length,
                      total: visibleValues.length,
                    })}
                  </span>
                )}
              </>
            ) : (
              <span className="catalogue-filter-section__empty">
                {t("catalogue.filters.empty")}
              </span>
            )}
          </div>
        </div>
      )}
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
  chunkOffset: number;
  matched: number;
  filters: CatalogueFilters;
  sort: CatalogueSort;
  animateFilterPlaceholders: boolean;
  onFiltersChange: (filters: CatalogueFilters) => void;
  onSortChange: (sort: CatalogueSort) => void;
  onPageChange: (page: number) => void;
  onOpenGame: (game: GhostBoxGame) => void;
  favoriteGameIds: Set<string>;
  addedGameAppIds: Set<string>;
  libraryGameAppIds: Set<string>;
  playableGameAppIds: Set<string>;
  addingGameId: string | null;
  launchingGameId: string | null;
  removingGameId: string | null;
  onToggleFavorite: (game: GhostBoxGame) => void;
  onAddGame: (game: GhostBoxGame) => void;
  onPlayGame: (game: GhostBoxGame) => void;
  onRemoveGame: (game: GhostBoxGame) => void;
  userCollections: UserCollection[];
  onAddGameToCollection: (game: GhostBoxGame, collectionId: string) => void;
  onRemoveGameFromCollection: (game: GhostBoxGame, collectionId: string) => void;
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
  chunkOffset,
  matched,
  filters,
  sort,
  animateFilterPlaceholders,
  onFiltersChange,
  onSortChange,
  onPageChange,
  onOpenGame,
  favoriteGameIds,
  addedGameAppIds,
  libraryGameAppIds,
  playableGameAppIds,
  addingGameId,
  launchingGameId,
  removingGameId,
  onToggleFavorite,
  onAddGame,
  onPlayGame,
  onRemoveGame,
  userCollections,
  onAddGameToCollection,
  onRemoveGameFromCollection,
  pulseLoading,
  scrollElementRef,
}: CataloguePageProps) {
  const { t } = useSettings();
  const contentRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [virtualListHeight, setVirtualListHeight] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    game: GhostBoxGame;
    x: number;
    y: number;
    mode: "game" | "collection";
  } | null>(null);
  const selectedFilterCount = getSelectedFilterCount(filters);
  const hasActiveFilters = hasSelectedCatalogueFilters(filters);

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
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    const el = resultsRef.current ?? scrollElementRef?.current;
    el?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage, scrollElementRef]);

  const startIndex = Math.max(
    0,
    (currentPage - 1) * cataloguePageSize - chunkOffset
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
    () => `${currentPage}-${chunkOffset}-${visibleGames.map((game) => game.id).join("|")}`,
    [chunkOffset, currentPage, visibleGames]
  );

  useEffect(() => {
    if (visibleGames.length <= 30) {
      setVirtualListHeight(null);
    }
  }, [visibleGames.length]);

  useEffect(() => {
    if (loading || !visibleGames.length) return;

    preloadGameListAssets(visibleGames, {
      variant: "header",
      limit: 6,
    });
    preloadGameListAssets(nextPageGames, {
      variant: "header",
      limit: 6,
      idle: true,
    });
  }, [loading, nextPageGames, visibleGames, visibleGamesCacheKey]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const results = resultsRef.current;
    if (!content || !results) return;

    const updateFilterHeight = () => {
      const height = virtualListHeight ?? results.scrollHeight;
      content.style.setProperty(
        "--catalogue-results-height",
        `${height}px`
      );
    };

    updateFilterHeight();

    const resizeObserver = new ResizeObserver(updateFilterHeight);
    resizeObserver.observe(results);

    return () => resizeObserver.disconnect();
  }, [loading, visibleGamesCacheKey, selectedFilterCount, totalPages, virtualListHeight]);

  function updateFilter(key: CatalogueFilterKey, value: string) {
    const currentValues = filters[key];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    onFiltersChange({ ...filters, [key]: nextValues });
  }

  function clearFilter(key: CatalogueFilterKey, value?: string) {
    onFiltersChange({
      ...filters,
      [key]: value ? filters[key].filter((item) => item !== value) : [],
    });
  }

  const contextMenuItems = useCollectionContextMenu({
    game: contextMenu?.game ?? null,
    favoriteGameIds,
    libraryGameAppIds,
    removableGameAppIds: addedGameAppIds,
    playableGameAppIds,
    addingGameId,
    launchingGameId,
    userCollections,
    onOpenGame,
    onAddGame,
    onPlayGame,
    onRemoveGame,
    onToggleFavorite,
    includeFavorites: contextMenu?.mode !== "collection",
    directFavoriteAction: contextMenu?.mode !== "collection",
    onlyCollectionActions: contextMenu?.mode === "collection",
    onAddGameToCollection,
    onRemoveGameFromCollection,
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
        onClearAll={() => onFiltersChange(emptyCatalogueFilters)}
        onRemove={clearFilter}
      />

      <div className="catalogue-page__content" ref={contentRef}>
        <div className="catalogue-page__results" ref={resultsRef}>
          {loading ? (
            <CatalogueListLoadingState
              animateListText={pulseLoading}
              pulseLoading={pulseLoading}
            />
          ) : visibleGames.length > 0 ? (
            <div className="catalogue-page__list-container">
              <CatalogueList
                games={visibleGames}
                onOpenGame={onOpenGame}
                addedGameAppIds={addedGameAppIds}
                addingGameId={addingGameId}
                removingGameId={removingGameId}
                onRemoveGame={onRemoveGame}
                scrollElementRef={resultsRef}
                onVirtualHeightChange={setVirtualListHeight}
                onGameContextMenu={(game, x, y) =>
                  setContextMenu({ game, x, y, mode: "game" })
                }
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
              actionLabel={
                hasActiveFilters ? t("catalogue.filters.clearAll") : undefined
              }
              onAction={hasActiveFilters ? () => onFiltersChange(emptyCatalogueFilters) : undefined}
            />
          )}

          {!loading && totalPages > 1 && (
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
          <div className="catalogue-filters__header">
            <div>
              <span className="eyebrow">{t("catalogue.filters.label")}</span>
            </div>
            {selectedFilterCount > 0 && (
              <button
                type="button"
                onClick={() => onFiltersChange(emptyCatalogueFilters)}
              >
                {t("catalogue.filters.clearShort")}
              </button>
            )}
          </div>

          <div className="catalogue-filters__sections">
            <section className="catalogue-filter-section catalogue-filter-section--sort">
              <div className="catalogue-filter-section__sort-header">
                <span className="catalogue-filter-section__orb catalogue-filter-section__orb--sort" />
                <strong>{t("catalogue.sort.title")}</strong>
              </div>
              <div className="catalogue-filter-section__sort-options">
                <button
                  type="button"
                  className={sort === "popular" ? "is-active" : undefined}
                  onClick={() => onSortChange("popular")}
                >
                  <ThumbsUp size={15} strokeWidth={2.0} />
                  <span>{t("catalogue.sort.featured")}</span>
                </button>
                <button
                  type="button"
                  className={sort === "recentlyAdded" ? "is-active" : undefined}
                  onClick={() => onSortChange("recentlyAdded")}
                >
                  <Clock size={15} strokeWidth={2.0} />
                  <span>{t("catalogue.sort.recentlyAdded")}</span>
                </button>
              </div>
            </section>
            {filtersLoading && (
              <div className="catalogue-filters__loading" role="status">
                <span
                  className="deferred-page-placeholder__spinner"
                  aria-hidden="true"
                />
                <span>Carregando filtros...</span>
              </div>
            )}
            {filterSections.map((section) => (
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
