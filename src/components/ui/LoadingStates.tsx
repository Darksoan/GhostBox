import { Info } from "lucide-react";
import { cataloguePageSize } from "../../constants/catalogue";
import { useSettings } from "../../context/settings";
import type { Page } from "../../types";
import type { Ref } from "react";

export function EmptyState({
  query = "",
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  query?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const { t } = useSettings();
  const term = query.trim();
  const resolvedTitle =
    title ?? (term ? t("loading.emptyQuery", { term }) : t("loading.emptyTitle"));

  return (
    <section className={["empty-state", className].filter(Boolean).join(" ")}>
      <div className="empty-state__body">
        {description ? <Info className="empty-state__icon" size={20} aria-hidden="true" /> : null}
        <h3>{resolvedTitle}</h3>
        {description ? <p>{description}</p> : null}
        {actionLabel && onAction ? (
          <button type="button" className="button button--outline" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function GameGridLoadingState({
  dense = false,
  count = dense ? 8 : 9,
  portrait = false,
  showAchievements = false,
  libraryCoverFade = false,
}: {
  dense?: boolean;
  count?: number;
  portrait?: boolean;
  showAchievements?: boolean;
  libraryCoverFade?: boolean;
}) {
  const gridClass = [
    "game-grid",
    dense ? "game-grid--dense" : "",
    portrait ? "game-grid--portrait" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={gridClass}>
      {Array.from({ length: count }, (_, index) => (
        <article
          className={`game-card game-card--placeholder ${portrait ? "game-card--placeholder-portrait" : ""} ${libraryCoverFade ? "game-card--library-cover-fade" : ""}`}
          key={`game-card-loading-${index}`}
        >
          <div className="game-card__cover game-card__cover--loaded skeleton">
            {showAchievements && (
              <div className="game-card__placeholder-achievements">
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            )}
          </div>
          <div className="game-card__backdrop">
            <div className="game-card__content">
              <div className="game-card__title-container">
                <div className="game-card__title-placeholder skeleton" />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Skeleton chapado: só as duas massas do item real (capa + corpo). Nada de
 * barras de título ou chips — a lista carregada preenche esse espaço sozinha.
 */
export function CatalogueListLoadingState({ count }: { count?: number }) {
  const placeholderCount = count ?? cataloguePageSize;

  return (
    <div className="catalogue-list catalogue-list--skeleton" aria-hidden="true">
      {Array.from({ length: placeholderCount }, (_, index) => (
        <article className="catalogue-list__item catalogue-list__item--skeleton" key={`catalogue-loading-${index}`}>
          <div className="catalogue-list__cover catalogue-list__cover--skeleton skeleton" />
        </article>
      ))}
    </div>
  );
}

export function CatalogueFilterSectionsLoadingState({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <section className="catalogue-filter-section catalogue-filter-section--skeleton" key={`filter-loading-${index}`} aria-hidden="true" />
      ))}
    </>
  );
}

export function CatalogueLoadingState() {
  const { t } = useSettings();

  return (
    <section className="catalogue-page" aria-label={t("loading.catalogue")}>
      <div className="catalogue-page__content">
        <div className="catalogue-page__results">
          <CatalogueListLoadingState />
        </div>

        <aside className="catalogue-filters catalogue-filters--placeholder" aria-label={t("loading.filters")}>
          <div className="catalogue-filters__sections">
            <CatalogueFilterSectionsLoadingState />
          </div>
        </aside>
      </div>
    </section>
  );
}

export function PageSpinnerLoadingState({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={["page-spinner-loading", className].filter(Boolean).join(" ")} role="status">
      <span className="page-spinner-loading__spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function AchievementsListLoadingState({ count = 8 }: { count?: number }) {
  return (
    <ul className="game-achievements-page__list" role="status" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li
          className="game-achievements-page__item game-achievements-page__item--skeleton"
          key={`achievement-skeleton-${index}`}
        >
          <span className="game-achievements-page__icon-wrap">
            <span className="game-achievements-page__icon game-achievements-page__icon--skeleton skeleton" />
          </span>
          <div className="game-achievements-page__item-content">
            <strong className="game-achievements-page__skeleton-title skeleton" />
            <p className="game-achievements-page__skeleton-desc skeleton" />
          </div>
          <div className="game-achievements-page__item-meta">
            <span className="game-achievements-page__skeleton-status skeleton" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsFeedLoadingState({ count: _count = 3 }: { count?: number }) {
  const { t } = useSettings();

  return <PageSpinnerLoadingState label={t("notifications.loading")} />;
}

export function SearchSuggestionsLoadingState({ count: _count = 3 }: { count?: number }) {
  const { t } = useSettings();

  return (
    <div className="header__search-spinner-state">
      <span className="sr-only">{t("header.searching")}</span>
    </div>
  );
}

export function HomeCategoryCardSkeleton({
  variant = "tile",
  showTitle = false,
  showSummary = false,
}: {
  variant?: "tile" | "portrait";
  showTitle?: boolean;
  showSummary?: boolean;
}) {
  // Mesma composição do card real: `showSummary` liga nome + descrição
  // (Recomendados), `showTitle` liga só o nome (Top rated). Qualquer um dos
  // dois precisa fechar na mesma altura do card carregado, senão a grade pula
  // quando os dados chegam.
  const showTitleBlock = showTitle || showSummary;

  return (
    <button
      type="button"
      className={`home-category-card home-category-card--${variant} home-category-card--placeholder${
        showTitleBlock ? " home-category-card--with-title" : ""
      }`}
      disabled
      aria-hidden="true"
    >
      <span className="home-category-card__cover home-category-card__cover--skeleton" />
      {showTitleBlock ? (
        <span className="home-category-card__metadata">
          <span className="home-category-card__summary">
            <span className="home-category-card__title home-category-card__text-skeleton home-category-card__text-skeleton--title skeleton" />
            {showSummary ? (
              <span className="home-category-card__description home-category-card__text-skeleton home-category-card__text-skeleton--description skeleton" />
            ) : null}
          </span>
        </span>
      ) : null}
    </button>
  );
}

export function HomeWishlistCardSkeleton() {
  return (
    <div className="home-wishlist-card home-wishlist-card--skeleton">
      <span className="home-wishlist-card__content">
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--title" />
      </span>
      <span className="home-wishlist-card__media home-wishlist-card__media--single">
        <span className="home-wishlist-card__cover home-wishlist-card__cover--skeleton" />
        <span className="home-wishlist-card__details">
          <HomeWishlistReviewSkeleton />
          <span className="home-wishlist-card__tag-skeleton-row">
            <span className="home-wishlist-card__tag-skeleton" />
            <span className="home-wishlist-card__tag-skeleton" />
            <span className="home-wishlist-card__tag-skeleton" />
          </span>
        </span>
      </span>
    </div>
  );
}

export function HomeWishlistReviewSkeleton({
  rootRef,
  ariaHidden = false,
}: {
  rootRef?: Ref<HTMLSpanElement>;
  ariaHidden?: boolean;
} = {}) {
  return (
    <span
      ref={rootRef}
      className="home-wishlist-card__player-review home-wishlist-card__player-review--skeleton"
      aria-hidden={ariaHidden || undefined}
    >
      <span className="home-wishlist-card__player-review-quote-skeleton">
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review" />
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review" />
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--review-short" />
      </span>
      <span className="home-wishlist-card__player-review-author">
        <span className="home-wishlist-card__player-review-avatar home-wishlist-card__player-review-avatar--skeleton" />
        <span className="home-wishlist-card__player-review-author-skeleton">
          <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--author-name" />
          <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--author-meta" />
        </span>
      </span>
    </span>
  );
}

/** Mirrors the markup of `SectionHeader` so the skeleton keeps the same layout. */
function SectionHeaderSkeleton({ withSubtitle = false }: { withSubtitle?: boolean }) {
  return (
    <div className="section-header">
      <div className="section-header__copy">
        <span className="section-header__title home-section-title-placeholder skeleton" />
        {withSubtitle ? (
          <span className="section-header__subtitle home-section-title-placeholder skeleton" />
        ) : null}
      </div>
    </div>
  );
}

export function HomePageLoadingState() {
  return (
    <section className="home-page" aria-hidden="true">
      <section className="home-recommended">
        <SectionHeaderSkeleton />
        <div className="home-recommended__rail">
          <div className="home-recommended__carousel">
            <div className="home-recommended__track">
              {Array.from({ length: 3 }, (_, index) => (
                <HomeCategoryCardSkeleton
                  variant="tile"
                  showSummary
                  key={`home-recommended-${index}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-category home-category--featured">
        <SectionHeaderSkeleton />
        <div className="home-category__games">
          {Array.from({ length: 6 }, (_, index) => (
            <HomeCategoryCardSkeleton variant="tile" showTitle key={`home-featured-${index}`} />
          ))}
        </div>
      </section>

      <section className="home-explore">
        <SectionHeaderSkeleton />
        <div className="home-explore__rail">
          <div className="home-explore__carousel">
            <div className="home-explore__track">
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  className="home-explore-card home-explore-card--skeleton skeleton"
                  key={`home-explore-${index}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-calendar">
        <SectionHeaderSkeleton />
        <div className="home-calendar__rail">
          <div className="home-calendar__carousel">
            <div className="home-calendar__track">
              {Array.from({ length: 3 }, (_, dayIndex) => (
                <div className="home-calendar-day" key={`cal-day-${dayIndex}`}>
                  <span className="home-calendar-day__title-placeholder skeleton" />
                  <div className="home-calendar-day__games">
                    <span className="home-calendar-card home-calendar-card--skeleton" />
                    <span className="home-calendar-card home-calendar-card--skeleton" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-wishlist">
        <SectionHeaderSkeleton withSubtitle />
        <div className="home-wishlist__list">
          {Array.from({ length: 4 }, (_, index) => (
            <HomeWishlistCardSkeleton key={`wishlist-${index}`} />
          ))}
        </div>
      </section>
    </section>
  );
}

/** Also used by ProfilePage itself while the overview data is still resolving. */
export function ProfileActivityListSkeleton() {
  return (
    <div
      className="profile-page__activity-list profile-page__activity-list--skeleton"
      aria-hidden="true"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="profile-page__activity-card profile-page__activity-card--skeleton"
        >
          <span className="profile-page__activity-cover-button" aria-hidden="true">
            <span className="profile-page__activity-game-cover profile-page__skeleton-block" />
          </span>
          <span className="profile-page__activity-main" aria-hidden="true">
            <span className="profile-page__activity-meta">
              <span className="profile-page__skeleton-line profile-page__skeleton-line--title" />
            </span>
            <span className="profile-page__activity-side">
              <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProfilePageLoadingState() {
  return (
    <section className="profile-page" aria-hidden="true">
      <header className="profile-page__content-box profile-page__content-box--placeholder">
        <div className="profile-page__banner-viewport">
          <span className="profile-page__banner-image profile-page__banner-image--placeholder" />
        </div>
        <div className="profile-page__background-overlay">
          <span className="profile-page__hero-action profile-page__hero-action--banner profile-page__hero-action--skeleton skeleton" />
          <div className="profile-page__identity">
            <div className="profile-page__avatar-button">
              <span className="profile-page__avatar-skeleton" />
            </div>
            <div className="profile-page__identity-content">
              <div className="profile-page__display-name-row">
                <span className="profile-page__name-placeholder skeleton" />
                <span className="profile-page__level profile-page__level--skeleton skeleton" />
                <span className="profile-page__hero-action profile-page__hero-action--skeleton skeleton" />
              </div>
              <div className="profile-page__steam-id-row">
                <div className="profile-page__steam-id-box profile-page__steam-id-box--skeleton">
                  <span className="profile-page__steam-id-icon profile-page__skeleton-block" />
                  <span className="profile-page__meta-placeholder skeleton" />
                  <span className="profile-page__steam-id-toggle profile-page__steam-id-toggle--skeleton skeleton" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="profile-page__content-section">
        <main className="profile-page__main">
          <div className="profile-page__tabs">
            <div className="profile-page__collection-tabs">
              <span className="profile-page__tab-indicator profile-page__tab-indicator--skeleton" />
              {Array.from({ length: 4 }, (_, index) => (
                <span
                  className="profile-page__tab profile-page__tab-skeleton skeleton"
                  key={`profile-tab-${index}`}
                />
              ))}
            </div>
            <span className="profile-page__sign-out-skeleton skeleton" />
          </div>

          <div className="profile-page__collection-content">
            <div className="profile-page__overview">
              <section className="profile-page__overview-console">
                <div className="profile-page__activity-console">
                  <div className="profile-page__activity-toolbar profile-page__activity-toolbar--skeleton">
                    <div className="profile-page__activity-metrics">
                      {Array.from({ length: 4 }, (_, index) => (
                        <span className="profile-page__activity-metric" key={`metric-${index}`}>
                          <strong className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                          <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                        </span>
                      ))}
                    </div>
                    <div className="settings-dropdown profile-page__activity-sort">
                      <button type="button" className="settings-dropdown__trigger" disabled>
                        <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                      </button>
                    </div>
                  </div>
                  <ProfileActivityListSkeleton />
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

export function SettingsPageLoadingState() {
  return (
    <section className="settings-page settings-page--tabs" aria-hidden="true">
      <article className="settings-panel settings-panel--skeleton">
        <div className="settings-panel__body">
          <div className="settings-options">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="settings-option settings-option--skeleton" key={`setting-row-${index}`}>
                <div className="settings-option__copy">
                  <div className="settings-option__label">
                    <strong className="settings-page__row-label-placeholder skeleton" />
                  </div>
                  <span className="settings-page__row-description-placeholder skeleton" />
                </div>
                <div className="settings-option__control">
                  <span className="settings-page__row-control-placeholder skeleton" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
}

export function LibraryPageLoadingState() {
  return (
    <section className="content-section content-section--full content-section--library" aria-hidden="true">
      <div className="library-toolbar">
        <div className="library-toolbar__row">
          <div className="library-toolbar__sort-placeholder skeleton" />
          <div className="library-toolbar__chips">
            <span className="library-chip-placeholder skeleton" />
            <span className="library-chip-placeholder skeleton" />
          </div>
        </div>
      </div>
      <GameGridLoadingState dense portrait count={8} showAchievements libraryCoverFade />
    </section>
  );
}

export function FavoritesPageLoadingState() {
  return (
    <section className="favorites-page content-section content-section--full" aria-hidden="true">
      <div className="favorites-grid">
        {Array.from({ length: 10 }, (_, index) => (
          <article className="favorites-grid__item favorites-grid__item--skeleton" key={`favorite-skeleton-${index}`}>
            <div className="favorites-grid__cover favorites-grid__cover--skeleton skeleton">
              <div className="game-card__achievement-progress game-card__achievement-progress--skeleton">
                <div className="game-card__achievement-progress-count">
                  <span className="favorites-grid__metric-skeleton skeleton" />
                  <span className="favorites-grid__metric-skeleton favorites-grid__metric-skeleton--short skeleton" />
                </div>
                <div className="game-card__achievement-progress-track">
                  <span className="favorites-grid__progress-skeleton skeleton" />
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function NotificationsPageLoadingState() {
  return (
    <section className="notifications-page content-section content-section--full" aria-hidden="true">
      <NotificationsFeedLoadingState count={3} />
    </section>
  );
}

export function PagePlaceholder({ page }: { page: Page | string }) {
  switch (page) {
    case "home":
      return <HomePageLoadingState />;
    case "catalogue":
      return <CatalogueLoadingState />;
    case "library":
      return <LibraryPageLoadingState />;
    case "favorites":
      return <FavoritesPageLoadingState />;
    case "profile":
      return <ProfilePageLoadingState />;
    case "notifications":
      return <NotificationsPageLoadingState />;
    case "settings":
      return <SettingsPageLoadingState />;
    default:
      return (
        <section aria-hidden="true" className="deferred-page-placeholder">
          <span className="deferred-page-placeholder__spinner" />
        </section>
      );
  }
}
