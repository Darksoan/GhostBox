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
  actionLabel,
  onAction,
  className,
}: {
  query?: string;
  title?: string;
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
        <h3>{resolvedTitle}</h3>
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
          <div className="game-card__cover loading-wave">
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
  showActions = false,
  count,
}: {
  animateListText?: boolean;
  pulseLoading?: boolean;
  showActions?: boolean;
  count?: number;
}) {
  const loadingClassName = pulseLoading ? "loading-pulse-skeleton" : "loading-wave";
  const placeholderCount = count ?? Math.min(cataloguePageSize, 10);
  const listClassName = showActions
    ? "catalogue-list catalogue-list--with-actions"
    : "catalogue-list";

  return (
    <div className={listClassName}>
      {Array.from({ length: placeholderCount }, (_, index) => (
        <div className="catalogue-list__placeholder" key={`catalogue-loading-${index}`}>
          <div className={`catalogue-list__placeholder-cover ${loadingClassName}`} />
          <div className="catalogue-list__placeholder-content">
            <div className={placeholderClassName("catalogue-list__placeholder-title", animateListText, pulseLoading)} />
            <div className="catalogue-list__placeholder-genres">
              <span className={`catalogue-list__placeholder-chip ${loadingClassName}`} />
              <span className={`catalogue-list__placeholder-chip ${loadingClassName}`} />
              <span className={`catalogue-list__placeholder-chip catalogue-list__placeholder-chip--short ${loadingClassName}`} />
            </div>
          </div>
          {showActions && (
            <div className="catalogue-list__placeholder-actions">
              <span className={`catalogue-list__placeholder-action-icon ${loadingClassName}`} />
            </div>
          )}
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

  return (
    <section className="catalogue-page" aria-label={t("loading.catalogue")}>
      <div className="catalogue-page__content">
        <div className="catalogue-page__results">
          <CatalogueListLoadingState animateListText={animateListText} pulseLoading={pulseLoading} showActions />
        </div>

        <aside className="catalogue-filters catalogue-filters--placeholder" aria-label={t("loading.filters")}>
          <div className="catalogue-filters__sections">
            <div className="catalogue-filter-section catalogue-filter-section--sort catalogue-filter-section--placeholder">
              <div className="catalogue-filter-section__sort-header catalogue-filter-section__sort-header--placeholder">
                <span className="catalogue-filter-section__sort-orb-placeholder loading-wave" />
                <span className="catalogue-filter-section__sort-title-placeholder loading-wave" />
              </div>
              <div className="catalogue-filter-section__sort-options catalogue-filter-section__sort-options--placeholder">
                <span className="catalogue-filter-section__sort-chip-placeholder loading-wave" />
                <span className="catalogue-filter-section__sort-chip-placeholder loading-wave" />
              </div>
            </div>

            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="catalogue-filter-section catalogue-filter-section--placeholder"
                key={`filter-loading-${index}`}
              >
                <div className={placeholderClassName("catalogue-filter-section__header-placeholder", animateFilters, pulseLoading)}>
                  <span className="catalogue-filter-section__chevron-placeholder loading-wave" />
                  <span className="catalogue-filter-section__header-title-placeholder loading-wave" />
                  <span className="catalogue-filter-section__header-count-placeholder loading-wave" />
                </div>
                <div className={placeholderClassName("catalogue-filter-section__search-placeholder", animateFilters, pulseLoading)} />
                <div className="catalogue-filter-section__options-placeholder">
                  <label className="catalogue-filter-option catalogue-filter-option--placeholder">
                    <span className="catalogue-filter-option__box placeholder loading-wave" />
                    <span className="catalogue-filter-option__text-placeholder loading-wave" />
                  </label>
                  <label className="catalogue-filter-option catalogue-filter-option--placeholder">
                    <span className="catalogue-filter-option__box placeholder loading-wave" />
                    <span className="catalogue-filter-option__text-placeholder loading-wave" />
                  </label>
                  <label className="catalogue-filter-option catalogue-filter-option--placeholder">
                    <span className="catalogue-filter-option__box placeholder loading-wave" />
                    <span className="catalogue-filter-option__text-placeholder catalogue-filter-option__text-placeholder--short loading-wave" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function BackupListLoadingState({ count = 5 }: { count?: number }) {
  return (
    <div className="backup-list">
      {Array.from({ length: count }, (_, index) => (
        <div className="backup-list__placeholder" key={`backup-loading-${index}`}>
          <div className="backup-list__placeholder-content">
            <div className="backup-list__placeholder-header loading-wave" />
            <div className="backup-list__placeholder-copy">
              <span className="backup-list__placeholder-title loading-wave" />
              <span className="backup-list__placeholder-meta loading-wave" />
            </div>
            <div className="backup-list__placeholder-chevron loading-wave" />
          </div>
        </div>
      ))}
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
            <span className="game-achievements-page__icon game-achievements-page__icon--skeleton loading-wave" />
          </span>
          <div className="game-achievements-page__item-content">
            <span className="game-achievements-page__skeleton-title loading-wave" />
            <span className="game-achievements-page__skeleton-desc loading-wave" />
          </div>
          <div className="game-achievements-page__item-meta">
            <span className="game-achievements-page__skeleton-status loading-wave" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsFeedLoadingState({ count = 3 }: { count?: number }) {
  return (
    <div className="notifications-feed" role="status" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <section className="notification-group notification-group--skeleton" key={`notification-group-${index}`}>
          <div className="notification-group__trigger notification-group__trigger--skeleton">
            <span className="notification-group__copy">
              <span className="notifications-feed__skeleton-title loading-wave" />
              <span className="notifications-feed__skeleton-meta loading-wave" />
            </span>
            <span className="notification-group__count notification-group__count--skeleton loading-wave" />
          </div>
        </section>
      ))}
    </div>
  );
}

export function SearchSuggestionsLoadingState({ count = 3 }: { count?: number }) {
  return (
    <ul className="header__search-dropdown-list" role="listbox">
      {Array.from({ length: count }, (_, index) => (
        <li key={`search-suggestion-${index}`}>
          <div className="header__search-suggestion-skeleton">
            <span className="header__search-skeleton-text loading-wave" />
            <span className="header__search-skeleton-icon loading-wave" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HomeWishlistCardSkeleton() {
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
          </span>
        </span>
      </span>
    </div>
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
            <span
              className="home-category-card home-category-card--hero-capsule home-category-card--placeholder loading-wave"
              key={`home-recommended-${index}`}
            />
          ))}
        </div>
      </section>

      <div className="home-categories">
        <div className="home-category home-category--featured">
          <span className="home-section-title-placeholder loading-wave" />
          <div className="home-category__games">
            {Array.from({ length: 6 }, (_, index) => (
              <span
                className="home-category-card home-category-card--placeholder loading-wave"
                key={`home-featured-${index}`}
              />
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

      <section className="home-recent-banner">
        <span className="home-recent-banner__heading home-section-title-placeholder loading-wave" />
        <div className="home-recent-banner__card home-recent-banner__card--skeleton">
          <span className="home-recent-banner__cover home-recent-banner__cover--skeleton" />
          <span className="home-recent-banner__content home-recent-banner__content--skeleton">
            <span className="home-recent-banner__title-row home-recent-banner__title-row--skeleton">
              <span className="home-recent-banner__game-icon home-recent-banner__game-icon--skeleton" />
              <strong className="home-recent-banner__title home-recent-banner__title--skeleton">
                <span className="home-recent-banner__skeleton-line home-recent-banner__skeleton-line--title" />
              </strong>
            </span>
            <span className="home-recent-banner__meta">
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
    </section>
  );
}

export function ProfilePageLoadingState() {
  return (
    <section className="profile-page" aria-hidden="true">
      <header className="profile-page__content-box profile-page__content-box--placeholder">
        <div className="profile-page__background-overlay">
          <div className="profile-page__identity">
            <div className="profile-page__avatar-button">
              <span className="profile-page__avatar-skeleton" />
            </div>
            <div className="profile-page__identity-content">
              <span className="profile-page__name-placeholder loading-wave" />
              <span className="profile-page__meta-placeholder loading-wave" />
              <span className="profile-page__meta-placeholder profile-page__meta-placeholder--wide loading-wave" />
            </div>
          </div>
        </div>
      </header>

      <div className="profile-page__content-section">
        <main className="profile-page__main">
          <div className="profile-page__tabs">
            <div className="profile-page__collection-tabs">
              {Array.from({ length: 4 }, (_, index) => (
                <span
                  className="profile-page__tab-skeleton loading-wave"
                  key={`profile-tab-${index}`}
                />
              ))}
            </div>
            <span className="profile-page__sign-out-skeleton loading-wave" />
          </div>

          <div className="profile-page__overview-console">
            <div className="profile-page__achievement-rail">
              <div className="profile-page__overview-panel profile-page__overview-panel--showcase">
                <div className="profile-page__achievement-showcase">
                  {Array.from({ length: 10 }, (_, index) => (
                    <span
                      className="profile-page__showcase-achievement profile-page__showcase-achievement--empty"
                      key={`showcase-${index}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="profile-page__top-games-console">
              <div className="profile-page__overview-panel profile-page__overview-panel--top-games">
                <div className="profile-page__top-games-list profile-page__top-games-list--skeleton">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="profile-page__top-game-console-row profile-page__top-game-console-row--skeleton"
                    >
                      <span className="profile-page__top-game-cover profile-page__skeleton-block" />
                      <span className="profile-page__top-game-content profile-page__top-game-content--skeleton">
                        <span className="profile-page__skeleton-line profile-page__skeleton-line--title" />
                        <span className="profile-page__top-game-stats profile-page__top-game-stats--skeleton">
                          <span className="profile-page__top-game-stat">
                            <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                            <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                          </span>
                          <span className="profile-page__top-game-stat">
                            <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                            <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                          </span>
                          <span className="profile-page__top-game-stat profile-page__top-game-stat--achievements">
                            <span className="profile-page__top-game-stat-heading">
                              <span className="profile-page__skeleton-line profile-page__skeleton-line--label" />
                              <span className="profile-page__skeleton-line profile-page__skeleton-line--value" />
                            </span>
                            <span className="profile-page__skeleton-line profile-page__skeleton-line--progress" />
                          </span>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
      <div className="settings-page__tabs-skeleton">
        {Array.from({ length: 5 }, (_, index) => (
          <span className="settings-page__tab-placeholder loading-wave" key={`settings-tab-${index}`} />
        ))}
      </div>
      <div className="settings-panel settings-panel--skeleton">
        <div className="settings-page__content-skeleton">
          {Array.from({ length: 2 }, (_, sectionIndex) => (
            <div className="settings-page__section-skeleton" key={`settings-section-${sectionIndex}`}>
              <span className="settings-page__section-title-placeholder loading-wave" />
              {Array.from({ length: 3 }, (_, index) => (
                <div className="settings-page__row-skeleton" key={`setting-row-${sectionIndex}-${index}`}>
                  <span className="settings-page__row-label-placeholder loading-wave" />
                  <span className="settings-page__row-control-placeholder loading-wave" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
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
      <div className="backup-page__header-skeleton">
        <span className="backup-page__title-placeholder loading-wave" />
      </div>
      <BackupListLoadingState count={5} />
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
