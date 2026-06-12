import { cataloguePageSize } from "../../constants/catalogue";
import { useSettings } from "../../context/settings";

function placeholderClassName(blockClassName: string, animate = true, pulse = false) {
  if (!animate) return `${blockClassName} loading-plate`;
  return `${blockClassName} ${pulse ? "loading-pulse-skeleton" : "loading-wave"}`;
}

export function EmptyState({
  query,
  actionLabel,
  onAction,
}: {
  query: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { t } = useSettings();
  const term = query.trim();
  const message = term ? t("loading.emptyQuery", { term }) : t("loading.emptyMessage");

  return (
    <section className="empty-state">
      <div>
        <h3>{t("loading.emptyTitle")}</h3>
        <p>{message}</p>
        {actionLabel && onAction && (
          <button type="button" className="button button--outline" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export function GameGridLoadingState({
  dense = false,
  count = dense ? 8 : 9,
}: {
  dense?: boolean;
  count?: number;
}) {
  return (
    <div className={`game-grid ${dense ? "game-grid--dense" : ""}`}>
      {Array.from({ length: count }, (_, index) => (
        <article className="game-card game-card--placeholder" key={`game-card-loading-${index}`}>
          <div className="game-card__cover loading-wave" />
          <div className="game-card__backdrop">
            <div className="game-card__content">
              <div className="game-card__title-container">
                <div className="game-card__title-placeholder loading-wave" />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CatalogueListLoadingState({
  animateListText = true,
  pulseLoading = false,
}: {
  animateListText?: boolean;
  pulseLoading?: boolean;
}) {
  const loadingClassName = pulseLoading ? "loading-pulse-skeleton" : "loading-wave";
  const placeholderCount = Math.min(cataloguePageSize, 6);

  return (
    <div className="catalogue-list">
      {Array.from({ length: placeholderCount }, (_, index) => (
        <div className="catalogue-list__placeholder" key={`catalogue-loading-${index}`}>
          <div className={`catalogue-list__placeholder-cover ${loadingClassName}`} />
          <div className="catalogue-list__placeholder-content">
            <div className={placeholderClassName("catalogue-list__placeholder-title", animateListText, pulseLoading)} />
            <div className={placeholderClassName("catalogue-list__placeholder-genres", animateListText, pulseLoading)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CatalogueLoadingState({
  animateFilters = true,
  animateListText = true,
  pulseLoading = false,
}: {
  animateFilters?: boolean;
  animateListText?: boolean;
  pulseLoading?: boolean;
}) {
  const { t } = useSettings();
  const loadingClassName = pulseLoading ? "loading-pulse-skeleton" : "loading-wave";

  return (
    <section className="catalogue-page" aria-label={t("loading.catalogue")}>
      <div className="catalogue-page__content">
        <div className="catalogue-page__results">
          <CatalogueListLoadingState animateListText={animateListText} pulseLoading={pulseLoading} />
          <div className="catalogue-page__footer">
            <div className="pagination-controls pagination-controls--placeholder">
              <div className={`pagination-controls__arrow ${loadingClassName}`} />
              <div className="pagination-controls__numbers">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    className={`pagination-controls__page ${loadingClassName}`}
                    key={`catalogue-page-loading-${index}`}
                  />
                ))}
              </div>
              <div className={`pagination-controls__arrow ${loadingClassName}`} />
            </div>
          </div>
        </div>

        <aside
          className={`catalogue-filters catalogue-filters--placeholder ${animateFilters ? loadingClassName : ""}`}
          aria-label={t("loading.filters")}
        >
          <div className="catalogue-filters__header">
            <div>
              <div className={placeholderClassName("catalogue-filters__eyebrow-placeholder", animateFilters, pulseLoading)} />
              <div className={placeholderClassName("catalogue-filters__title-placeholder", animateFilters, pulseLoading)} />
            </div>
          </div>
          <div className="catalogue-filters__sections">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="catalogue-filter-section catalogue-filter-section--placeholder"
                key={`filter-loading-${index}`}
              >
                <div className={placeholderClassName("catalogue-filter-section__header", animateFilters, pulseLoading)} />
                <div className={placeholderClassName("catalogue-filter-section__placeholder-line", animateFilters, pulseLoading)} />
                <div className={placeholderClassName("catalogue-filter-section__placeholder-line catalogue-filter-section__placeholder-line--short", animateFilters, pulseLoading)} />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
