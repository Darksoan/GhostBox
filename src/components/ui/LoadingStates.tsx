import { Info } from "lucide-react";
import { cataloguePageSize } from "../../constants/catalogue";
import { useSettings } from "../../context/settings";
import type { Page } from "../../types";

function placeholderClassName(blockClassName: string, animate = true, pulse = false) {
  if (!animate) return `${blockClassName} loading-plate`;
  return `${blockClassName} ${pulse ? "loading-pulse-skeleton" : "loading-wave"}`;
}

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
  showBackupStatus = false,
  libraryCoverFade = false,
}: {
  dense?: boolean;
  count?: number;
  portrait?: boolean;
  showAchievements?: boolean;
  showBackupStatus?: boolean;
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
          <div className="game-card__cover game-card__cover--loaded loading-wave">
            {showBackupStatus && (
              <div className="game-card__placeholder-badge loading-wave" />
            )}
            {showAchievements && (
              <div className="game-card__placeholder-achievements">
                <span className="loading-wave" />
                <span className="loading-wave" />
              </div>
            )}
          </div>
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
  count,
}: {
  animateListText?: boolean;
  pulseLoading?: boolean;
  count?: number;
}) {
  const loadingClassName = pulseLoading ? "loading-pulse-skeleton" : "loading-wave";
  const placeholderCount = count ?? cataloguePageSize;

  return (
    <div className="catalogue-list">
      {Array.from({ length: placeholderCount }, (_, index) => (
        <article className="catalogue-list__item catalogue-list__item--skeleton" key={`catalogue-loading-${index}`}>
          <div className={`catalogue-list__cover catalogue-list__cover--skeleton ${loadingClassName}`} />
          <div className="catalogue-list__content">
            <div className={placeholderClassName("catalogue-list__placeholder-title", animateListText, pulseLoading)} />
            <div className="catalogue-list__genres" aria-hidden="true">
              <span className={`catalogue-list__placeholder-chip ${loadingClassName}`} />
              <span className={`catalogue-list__placeholder-chip ${loadingClassName}`} />
              <span className={`catalogue-list__placeholder-chip catalogue-list__placeholder-chip--short ${loadingClassName}`} />
            </div>
          </div>
          <div className="catalogue-list__actions" aria-hidden="true">
            <span className="catalogue-list__placeholder-action-slot" />
          </div>
        </article>
      ))}
    </div>
  );
}

export function CatalogueSortLoadingState({
  pulseLoading = false,
}: {
  pulseLoading?: boolean;
}) {
  const loadingClassName = pulseLoading ? "loading-pulse-skeleton" : "loading-wave";

  return (
    <section className="catalogue-filter-section catalogue-filter-section--sort" aria-hidden="true">
      <div className="catalogue-filter-section__sort-header">
        <span className={`catalogue-filter-section__orb catalogue-filter-section__orb--sort ${loadingClassName}`} />
        <span className={`catalogue-filter-section__sort-title-placeholder ${loadingClassName}`} />
      </div>
      <div className="catalogue-filter-section__sort-options catalogue-filter-section__sort-options--skeleton">
        {Array.from({ length: 2 }, (_, index) => (
          <button type="button" disabled key={`sort-loading-${index}`}>
            <span className={`catalogue-filter-section__sort-icon-placeholder ${loadingClassName}`} />
            <span className={`catalogue-filter-section__sort-label-placeholder ${loadingClassName}`} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function CatalogueFilterSectionsLoadingState({
  count = 5,
  animateFilters = true,
  pulseLoading = false,
}: {
  count?: number;
  animateFilters?: boolean;
  pulseLoading?: boolean;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <section className="catalogue-filter-section catalogue-filter-section--skeleton" key={`filter-loading-${index}`} aria-hidden="true">
          <button type="button" className="catalogue-filter-section__header" disabled aria-expanded="false">
            <span className={placeholderClassName("catalogue-filter-section__chevron-placeholder", animateFilters, pulseLoading)} />
            <span className={placeholderClassName("catalogue-filter-section__orb", animateFilters, pulseLoading)} />
            <span className={placeholderClassName("catalogue-filter-section__header-title-placeholder", animateFilters, pulseLoading)} />
            <span className={placeholderClassName("catalogue-filter-section__header-count-placeholder", animateFilters, pulseLoading)} />
          </button>
          <div className="catalogue-filter-section__content" data-collapsed="true" style={{ height: 0 }} />
        </section>
      ))}
    </>
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

  return (
    <section className="catalogue-page" aria-label={t("loading.catalogue")}>
      <div className="catalogue-page__content">
        <div className="catalogue-page__results">
          <CatalogueListLoadingState animateListText={animateListText} pulseLoading={pulseLoading} />
        </div>

        <aside className="catalogue-filters catalogue-filters--placeholder" aria-label={t("loading.filters")}>
          <div className="catalogue-filters__sections">
            <CatalogueSortLoadingState pulseLoading={pulseLoading} />
            <CatalogueFilterSectionsLoadingState animateFilters={animateFilters} pulseLoading={pulseLoading} />
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

export function BackupListLoadingState({ count: _count = 5 }: { count?: number }) {
  const { t } = useSettings();

  return <PageSpinnerLoadingState label={t("backup.loading")} />;
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
            <span className="game-achievements-page__icon game-achievements-page__icon--skeleton loading-wave" />
          </span>
          <div className="game-achievements-page__item-content">
            <strong className="game-achievements-page__skeleton-title loading-wave" />
            <p className="game-achievements-page__skeleton-desc loading-wave" />
          </div>
          <div className="game-achievements-page__item-meta">
            <span className="game-achievements-page__skeleton-status loading-wave" />
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
  heroCapsule = false,
}: {
  heroCapsule?: boolean;
}) {
  return (
    <button
      type="button"
      className={`home-category-card ${heroCapsule ? "home-category-card--hero-capsule" : ""} home-category-card--placeholder`}
      disabled
      aria-hidden="true"
    >
      <span className="home-category-card__cover home-category-card__cover--skeleton" />
      <span className="home-category-card__content" aria-hidden="true">
        <strong>
          <span className="home-category-card__title-skeleton loading-wave" />
        </strong>
      </span>
    </button>
  );
}

export function HomeWishlistCardSkeleton() {
  return (
    <div className="home-wishlist-card home-wishlist-card--skeleton">
      <span className="home-wishlist-card__content">
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--title" />
        <span className="home-wishlist-card__text-skeleton home-wishlist-card__text-skeleton--reason" />
      </span>
      <span className="home-wishlist-card__media home-wishlist-card__media--single">
        <span className="home-wishlist-card__cover home-wishlist-card__cover--skeleton" />
        <span className="home-wishlist-card__details">
          <span className="home-wishlist-card__player-review home-wishlist-card__player-review--skeleton">
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
          <span className="home-wishlist-card__tag-skeleton-row">
            <span className="home-wishlist-card__tag-skeleton" />
            <span className="home-wishlist-card__tag-skeleton" />
            <span className="home-wishlist-card__tag-skeleton" />
            <span className="home-wishlist-card__tag-skeleton" />
          </span>
        </span>
      </span>
    </div>
  );
}

export function HomeRecentBannerSkeleton({ title }: { title?: string }) {
  return (
    <section className="home-recent-banner" aria-label={title}>
      {title ? (
        <h3 className="home-recent-banner__heading">{title}</h3>
      ) : (
        <span className="home-recent-banner__heading home-section-title-placeholder loading-plate" />
      )}
      <div className="home-recent-banner__card home-recent-banner__card--skeleton" aria-hidden="true">
        <span className="home-recent-banner__cover home-recent-banner__cover--skeleton" />
        <span className="home-recent-banner__content home-recent-banner__content--skeleton">
          <span className="home-recent-banner__title-row home-recent-banner__title-row--skeleton">
            <span className="home-recent-banner__game-icon home-recent-banner__game-icon--skeleton" />
            <strong className="home-recent-banner__title home-recent-banner__title--skeleton">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--title" />
            </strong>
          </span>
          <span className="home-recent-banner__meta" aria-hidden="true">
            <small className="home-recent-banner__meta-item">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--playtime">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
              </span>
            </small>
            <small className="home-recent-banner__meta-item home-recent-banner__meta-item--achievements">
              <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--icon" />
              <span className="home-recent-banner__meta-copy">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--label" />
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--value" />
              </span>
            </small>
          </span>
        </span>
      </div>
    </section>
  );
}

export function HomePageLoadingState() {
  return (
    <section className="home-page" aria-hidden="true">
      <section className="home-recommended">
        <div className="home-recommended__header">
          <span className="home-section-title-placeholder loading-wave" />
        </div>
        <div className="home-recommended__grid">
          {Array.from({ length: 4 }, (_, index) => (
              <HomeCategoryCardSkeleton heroCapsule key={`home-recommended-${index}`} />
            ))}
          </div>
      </section>

      <div className="home-categories">
        <div className="home-category home-category--featured">
          <span className="home-section-title-placeholder loading-wave" />
          <div className="home-category__games">
            {Array.from({ length: 6 }, (_, index) => (
              <HomeCategoryCardSkeleton key={`home-featured-${index}`} />
            ))}
          </div>
        </div>
      </div>

      <section className="home-explore">
        <div className="home-explore__header">
          <span className="home-section-title-placeholder loading-wave" />
        </div>
        <div className="home-explore__rail">
          <span className="home-explore__arrow-placeholder loading-wave" />
          <div className="home-explore__carousel">
            <div className="home-explore__track">
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  className="home-explore-card home-explore-card--skeleton loading-wave"
                  key={`home-explore-${index}`}
                />
              ))}
            </div>
          </div>
          <span className="home-explore__arrow-placeholder loading-wave" />
        </div>
      </section>

      <section className="home-calendar">
        <div className="home-calendar__header">
          <span className="home-section-title-placeholder loading-wave" />
        </div>
        <div className="home-calendar__rail">
          <span className="home-calendar__arrow-placeholder loading-wave" />
          <div className="home-calendar__carousel">
            <div className="home-calendar__track">
              {Array.from({ length: 3 }, (_, dayIndex) => (
                <div className="home-calendar-day" key={`cal-day-${dayIndex}`}>
                  <span className="home-calendar-day__title-placeholder loading-wave" />
                  <div className="home-calendar-day__games">
                    <span className="home-calendar-card home-calendar-card--skeleton" />
                    <span className="home-calendar-card home-calendar-card--skeleton" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <span className="home-calendar__arrow-placeholder loading-wave" />
        </div>
      </section>

      <section className="home-wishlist">
        <div className="home-wishlist__header">
          <span className="home-section-title-placeholder loading-wave" />
        </div>
        <div className="home-wishlist__list">
          {Array.from({ length: 3 }, (_, index) => (
            <HomeWishlistCardSkeleton key={`wishlist-${index}`} />
          ))}
        </div>
      </section>

      <HomeRecentBannerSkeleton />
    </section>
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
          <span className="profile-page__hero-action profile-page__hero-action--banner profile-page__hero-action--skeleton loading-wave" />
          <div className="profile-page__identity">
            <div className="profile-page__avatar-button">
              <span className="profile-page__avatar-skeleton" />
            </div>
            <div className="profile-page__identity-content">
              <div className="profile-page__display-name-row">
                <span className="profile-page__name-placeholder loading-wave" />
                <span className="profile-page__level profile-page__level--skeleton loading-wave" />
                <span className="profile-page__hero-action profile-page__hero-action--skeleton loading-wave" />
              </div>
              <div className="profile-page__steam-id-row">
                <div className="profile-page__steam-id-box profile-page__steam-id-box--skeleton">
                  <span className="profile-page__steam-id-icon profile-page__skeleton-block" />
                  <span className="profile-page__meta-placeholder loading-wave" />
                  <span className="profile-page__steam-id-toggle profile-page__steam-id-toggle--skeleton loading-wave" />
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
                  className="profile-page__tab profile-page__tab-skeleton loading-wave"
                  key={`profile-tab-${index}`}
                />
              ))}
            </div>
            <span className="profile-page__sign-out-skeleton loading-wave" />
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
                  <div className="profile-page__activity-list profile-page__activity-list--skeleton">
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
                    <strong className="settings-page__row-label-placeholder loading-wave" />
                  </div>
                  <span className="settings-page__row-description-placeholder loading-wave" />
                </div>
                <div className="settings-option__control">
                  <span className="settings-page__row-control-placeholder loading-wave" />
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
          <div className="library-toolbar__sort-placeholder loading-wave" />
          <div className="library-toolbar__chips">
            <span className="library-chip-placeholder loading-wave" />
            <span className="library-chip-placeholder loading-wave" />
          </div>
        </div>
      </div>
      <GameGridLoadingState dense portrait count={8} showAchievements showBackupStatus libraryCoverFade />
    </section>
  );
}

export function FavoritesPageLoadingState() {
  return (
    <section className="favorites-page content-section content-section--full" aria-hidden="true">
      <div className="favorites-grid">
        {Array.from({ length: 10 }, (_, index) => (
          <article className="favorites-grid__item favorites-grid__item--skeleton" key={`favorite-skeleton-${index}`}>
            <div className="favorites-grid__cover favorites-grid__cover--skeleton loading-wave">
              <div className="game-card__achievement-progress game-card__achievement-progress--skeleton">
                <div className="game-card__achievement-progress-count">
                  <span className="favorites-grid__metric-skeleton loading-wave" />
                  <span className="favorites-grid__metric-skeleton favorites-grid__metric-skeleton--short loading-wave" />
                </div>
                <div className="game-card__achievement-progress-track">
                  <span className="favorites-grid__progress-skeleton loading-wave" />
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function BackupPageLoadingState() {
  return (
    <section className="backup-page" aria-hidden="true">
      <BackupListLoadingState count={4} />
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
    case "backup":
      return <BackupPageLoadingState />;
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
